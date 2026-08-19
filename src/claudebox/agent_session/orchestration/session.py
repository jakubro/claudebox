"""Session facade - SDK client, pipeline, persistence coordination."""

import asyncio
import base64
import os
import re
import time
import uuid
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import cast
from xml.sax.saxutils import escape, quoteattr

from .attachments import AttachmentInfo, AttachmentService
from .broadcaster import Broadcaster
from .conversion import serialize_event
from .errors import AttachmentInvalid, SessionNotReady
from .models import EventSubtype, EventType, PublishedEvent, SessionSummary
from .pipeline import EventPipeline
from .projection import Projection
from .tool_output import ToolOutput, ToolOutputContent
from ..config import (
    AgentSessionConfig,
    ClaudeAgentSessionConfig,
    LangGraphAgentSessionConfig,
    RuntimeCapabilities,
)
from ..errors import UnknownRuntime
from ..hooks import CompactStartPayload, HookCallbacks
from ..protocol import AgentSession
from ..rate_limits import RateLimitStore
from ..session import make_agent_session
from ...config import Config
from ...constants import (
    MAX_ATTACHMENT_BYTES,
    SDK_PROCESS_BUFFER_SIZE,
    SESSION_ATTACHMENTS_DIR,
    SESSION_METADATA_FILE,
    SESSION_STALL_CHECK_INTERVAL,
    SESSION_STALL_TIMEOUT,
)
from ...core.file_cache import FileCache
from ...core.logging import get_logger
from ...env import is_dev_mode
from ...session.repository import SessionRepository
from ...session.session import Session as BaseSession
from ...temp import ensure_tmp
from ...workspace import Workspace


# Commands that SDK handles internally without emitting user message events
INTERNAL_COMMAND_PATTERN = re.compile(r"^/(compact|context)(?:\s|$)")


class SessionService:
    """Chat session: SDK client + event pipeline + persistence + SSE broadcast."""

    def __init__(
        self,
        workspace: Path,
        system_prompt: str | None = None,
        permission_mode: str | None = None,
        on_start: Callable[[BaseSession], None] | None = None,
        on_stop: Callable[[], None] | None = None,
    ):
        """Initialize session state. Components attach in start(); lifecycle hooks fire from start()/stop()."""

        self._logger = get_logger(__name__)

        self._workspace = Workspace(workspace)
        self._rate_limit_store = RateLimitStore(self._workspace.path)
        # Windows announced at the last session start, not yet re-announced or ruled normal here.
        self._rate_limit_pending_reconcile: set[str] = set()
        self._system_prompt = system_prompt
        self._permission_mode = permission_mode
        self._on_start = on_start
        self._on_stop = on_stop
        self._last_known_model: str | None = None
        self._last_known_permission_mode: str | None = None
        self._last_known_effort_level: str | None = None
        self._pending_session_prompt: str | None = None
        self._pending_compact_trigger: str | None = None

        # Set in start() from the workspace's current `agent` setting; compared against the
        # session's persisted runtime on resume (see _emit_container_restarted_if_resumed).
        self._expected_runtime_name: str | None = None
        self._session_provider: str | None = None

        self._base_session: BaseSession | None = None
        self._repo = SessionRepository(self._workspace)

        # Cast to non-Optional; start() populates them.
        # TODO: a Builder + Started container would drop this cast lie, type-honestly.
        self._sdk_client: AgentSession = cast(AgentSession, None)
        self._event_pipeline: EventPipeline = cast(EventPipeline, None)
        self._broadcaster: Broadcaster = cast(Broadcaster, None)
        self._tool_output: ToolOutput = cast(ToolOutput, None)
        self._attachment_service: AttachmentService = cast(AttachmentService, None)
        self._summary_cache: FileCache = cast(FileCache, None)
        self._projection: Projection = cast(Projection, None)

        self._client_task: asyncio.Task | None = None
        self._pipeline_task: asyncio.Task | None = None
        self._stall_watchdog_task: asyncio.Task | None = None
        self._context_refresh_timer: asyncio.TimerHandle | None = None
        self._pipeline_repair_lock = asyncio.Lock()
        self._suppress_restart_divider = False

        # `time.monotonic()` when a query was dispatched, cleared by the turn's result.
        # Arms the stall watchdog: silence only means a fault while an answer is owed.
        self._turn_dispatched_at: float | None = None

        # Tool calls started but not finished - a long one emits nothing meanwhile; that's work, not a stall.
        self._tools_outstanding = 0

        # One stall report per turn - the watchdog samples continuously, the fault is one event.
        self._stall_reported = False

    @property
    def base_session(self) -> BaseSession | None:
        """The currently active base session instance (None before start)."""

        return self._base_session

    @property
    def workspace(self) -> Workspace:
        """The workspace containing session data and configuration."""

        return self._workspace

    @property
    def current_session_id(self) -> str | None:
        """The currently active session ID, if any."""

        return self._projection.session_id if self._projection else None

    def get_capabilities(self) -> RuntimeCapabilities:
        """Return the runtime's capability matrix."""

        if self._sdk_client is None:
            raise SessionNotReady()

        return self._sdk_client.capabilities

    @property
    def runtime_name(self) -> str:
        """Display name of the active runtime adapter."""

        if self._sdk_client is None:
            raise SessionNotReady()

        return self._sdk_client.runtime_name

    @property
    def _log_context(self) -> dict:
        return {
            "session": {
                "id": self._base_session and self._base_session.id,
                "workspace": str(self._workspace.path),
            },
        }

    # Session API
    # ----------------------------------------------------------------------------------------------

    async def start(self, resume_session_id: str | None = None) -> str:
        """Start session components. Optionally resume an existing session.

        Returns the session ID (pre-generated for new sessions, or the resume ID).
        """

        self._logger.info("Starting session...", resume_id=resume_session_id, **self._log_context)

        self._last_known_model = None
        self._last_known_permission_mode = None
        self._last_known_effort_level = None

        session_id = resume_session_id or str(uuid.uuid4())
        session = BaseSession(session_id=session_id, workspace=self._workspace)

        if self._on_start is not None:
            self._on_start(session)

        workspace_config = Config.load(workspace_path=self._workspace.path)

        # Provider is LangGraph-only; None under Claude. See _emit_container_restarted_if_resumed.
        self._expected_runtime_name = {"claude": "Claude", "langgraph": "LangGraph"}.get(
            workspace_config.agent,
        )
        self._session_provider = None

        config: AgentSessionConfig  # tightened below to the right subclass

        if workspace_config.agent == "claude":
            config = ClaudeAgentSessionConfig(
                runtime="claude",
                model=self._last_known_model,
                permission_mode=self._permission_mode,
                effort_level=self._last_known_effort_level,
                cwd=os.getcwd(),
                env=os.environ.copy(),
                session_id=session_id,
                resume_session_id=resume_session_id,
                session_dir=session.path,
                hooks=HookCallbacks(
                    on_session_start=self._on_session_start,
                    on_pre_compact=self._on_compact_start,
                    on_permission_mode_changed=self._on_permission_mode_changed,
                    on_model_changed=self._on_model_changed,
                    on_effort_level_changed=self._on_effort_level_changed,
                ),
                system_prompt=self._system_prompt,
                setting_sources=["user", "project"],
                sdk_passthrough={},
                max_buffer_size=SDK_PROCESS_BUFFER_SIZE,
                debug_mode=is_dev_mode(),
            )
        elif workspace_config.agent == "langgraph":
            # set_model/set_permission_mode/set_effort_level are unsupported under LangGraph
            # (a graph-construction-time bind), so the change-callbacks below are not registered.
            raw_model = workspace_config.langgraph_model or ""
            provider = raw_model.partition(":")[0]
            provider_kwargs = dict(workspace_config.langgraph_provider_kwargs.get(provider, {}))
            self._session_provider = provider or None

            config = LangGraphAgentSessionConfig(
                runtime="langgraph",
                model=raw_model,
                permission_mode=None,
                effort_level=None,
                cwd=os.getcwd(),
                env=os.environ.copy(),
                session_id=session_id,
                resume_session_id=resume_session_id,
                session_dir=session.path,
                hooks=HookCallbacks(
                    on_session_start=self._on_session_start,
                    on_pre_compact=self._on_compact_start,
                ),
                max_tokens_override=workspace_config.langgraph_max_tokens_override,
                web_search_provider=workspace_config.langgraph_web_search_provider,
                web_search_api_key_env=workspace_config.langgraph_web_search_api_key_env,
                mcp_servers=workspace_config.langgraph_mcp_servers or {},
                provider_kwargs=provider_kwargs,
                cost_overrides=workspace_config.langgraph_cost_overrides,
                profile_hooks=workspace_config.langgraph_hooks,
                system_prompt=self._system_prompt,
            )
        else:
            raise UnknownRuntime(workspace_config.agent)

        self._sdk_client = make_agent_session(config)

        self._event_pipeline = EventPipeline(
            sdk_client=self._sdk_client,
            workspace=self._workspace,
            on_init=self._handle_init,
            on_event=self._handle_event,
            resume_session_id=resume_session_id,
        )

        self._broadcaster = Broadcaster()
        self._tool_output = ToolOutput(self._workspace)
        self._attachment_service = AttachmentService(self._workspace)
        self._summary_cache = FileCache()

        self._client_task = asyncio.create_task(self._sdk_client.connect())
        self._pipeline_task = asyncio.create_task(self._event_pipeline.start())
        self._stall_watchdog_task = asyncio.create_task(self._watch_for_stalls())

        self._client_task.add_done_callback(partial(self._log_task_exit, "client"))
        self._pipeline_task.add_done_callback(partial(self._log_task_exit, "pipeline"))
        self._stall_watchdog_task.add_done_callback(partial(self._log_task_exit, "stall watchdog"))

        self._logger.info("Session started", session_id=session_id, **self._log_context)

        return session_id

    async def stop(self) -> None:
        """Stop session components."""

        self._logger.info("Stopping session...", **self._log_context)

        await self._dispose("_stall_watchdog_task", "cancel")
        await self._dispose("_pipeline_task", "cancel")
        await self._dispose("_client_task", "cancel")
        await self._dispose("_event_pipeline", "stop")
        await self._dispose("_sdk_client", "disconnect")

        if self._context_refresh_timer is not None:
            self._context_refresh_timer.cancel()
            self._context_refresh_timer = None

        if self._projection:
            await self._projection.flush()

        self._projection = cast(Projection, None)
        self._summary_cache = cast(FileCache, None)
        self._tool_output = cast(ToolOutput, None)
        self._attachment_service = cast(AttachmentService, None)
        self._broadcaster = cast(Broadcaster, None)

        self._last_known_permission_mode = None
        self._last_known_effort_level = None
        self._last_known_model = None
        self._pending_session_prompt = None
        self._pending_compact_trigger = None

        # Disarms the watchdog across a restart: nothing is owed until the next send,
        # so a reconnect that didn't help can't loop.
        self._turn_dispatched_at = None
        self._tools_outstanding = 0

        if self._on_stop is not None:
            self._on_stop()

        self._logger.info("Session stopped", **self._log_context)

    async def restart(self, resume_session_id: str | None = None) -> str:
        """Stop current session and start new one resuming given session.

        Returns the session ID (pre-generated for new sessions, or the resume ID).
        """

        self._logger.info("Restarting session...", resume_id=resume_session_id, **self._log_context)

        await self.stop()

        return await self.start(resume_session_id)

    async def _dispose(self, attr: str, cleanup_method: str):
        """Dispose of a component by calling its cleanup method."""

        obj = getattr(self, attr, None)

        if not obj:
            return

        if isinstance(obj, asyncio.Task):
            getattr(obj, cleanup_method)()

            try:
                await obj
            except asyncio.CancelledError:
                pass
            except Exception as exc:  # noqa: BLE001 - a dispose failure must not block the rest
                self._logger.error("Error disposing component", attr=attr, error=str(exc))
            finally:
                setattr(self, attr, None)
        else:
            try:
                await getattr(obj, cleanup_method)()
            except Exception as exc:  # noqa: BLE001
                self._logger.error("Error disposing component", attr=attr, error=str(exc))
            finally:
                setattr(self, attr, None)

    def _log_task_exit(self, name: str, task: asyncio.Task) -> None:
        """Report a background task's exit, so a task that dies alone is not invisible.

        Calling .exception() is what makes it observable: asyncio only reports an unretrieved
        one from the task destructor, which a permanently-referenced task never reaches. Silent
        on success by design - connect() and pipeline start() both return promptly.
        """

        if task.cancelled():
            self._logger.info("Background task cancelled", task=name, **self._log_context)

            return

        exc = task.exception()

        if exc is not None:
            self._logger.error(
                "Background task died",
                task=name,
                error=str(exc),
                exc_info=exc,
                **self._log_context,
            )

    # Session Manager API
    # ----------------------------------------------------------------------------------------------

    def list_sessions(self) -> list[SessionSummary]:
        """List all sessions, newest first.

        Delegates iteration and sorting to SessionRepository, then enriches each result
        with Projection (cached by FileCache for performance).
        """

        summaries = []

        for metadata in self._repo.list_all():
            session = self._workspace.find_session(metadata.session_id)

            if session is None:
                continue

            path = session.path / SESSION_METADATA_FILE
            sid = metadata.session_id

            summary = self._summary_cache.get(
                path,
                lambda _sid=sid: Projection(_sid, self._workspace).value,
            )
            summaries.append(summary)

        return summaries

    def get(self, session_id: str | None = None) -> SessionSummary | None:
        """Get session summary for active or specified session."""

        projection = self._resolve_projection(session_id)

        return projection.value if projection else None

    def get_rate_limits(self) -> list[dict]:
        """Live plan-limit entries for the footer, read fresh from the workspace store."""

        return self._rate_limit_store.get()

    def update(self, session_id: str, **data) -> SessionSummary:
        """Update session fields and persist to disk."""

        projection = self._resolve_projection(session_id)
        projection.update_fields(**data)

        return projection.value

    def get_tool_output(self, session_id: str, tool_use_id: str) -> ToolOutputContent:
        """Read persisted tool output content."""

        return self._tool_output.get_content(session_id, tool_use_id)

    def get_tool_output_path(self, session_id: str, tool_use_id: str) -> Path:
        """Resolve path to persisted tool output file."""

        return self._tool_output.get_path(session_id, tool_use_id)

    def get_attachment(self, session_id: str, filename: str) -> AttachmentInfo:
        """Resolve attachment path and media type."""

        return self._attachment_service.resolve(session_id, filename)

    def _resolve_projection(self, session_id: str | None) -> Projection:
        """Return active projection if matching, otherwise create a throwaway one."""

        if not session_id or self._projection and session_id == self._projection.session_id:
            return self._projection
        else:
            return Projection(session_id=session_id, workspace=self._workspace)

    # Model
    # ----------------------------------------------------------------------------------------------

    async def set_model(self, model: str) -> None:
        """Change the model for subsequent runtime queries."""

        self._logger.info("Setting model", model=model, **self._log_context)
        await self._sdk_client.set_model(model)

    # Permission Mode
    # ----------------------------------------------------------------------------------------------

    async def set_permission_mode(self, mode: str) -> None:
        """Change the active permission mode via runtime control protocol."""

        self._logger.info("Setting permission mode", mode=mode, **self._log_context)
        await self._sdk_client.set_permission_mode(mode)

    # Effort Level
    # ----------------------------------------------------------------------------------------------

    async def set_effort_level(self, level: str) -> None:
        """Change the effort level via runtime control protocol."""

        self._logger.info("Setting effort level", level=level, **self._log_context)
        await self._sdk_client.set_effort_level(level)

    # MCP Server Management
    # ----------------------------------------------------------------------------------------------

    async def reconnect_mcp_server(self, server_name: str) -> dict:
        """Reconnect an MCP server and return fresh status."""

        self._logger.info("Reconnecting MCP server", server_name=server_name, **self._log_context)
        await self._sdk_client.reconnect_mcp_server(server_name)

        return await self._sdk_client.get_mcp_status()

    async def toggle_mcp_server(self, server_name: str, *, enabled: bool) -> dict:
        """Toggle an MCP server enabled/disabled and return fresh status."""

        self._logger.info(
            "Toggling MCP server",
            server_name=server_name,
            enabled=enabled,
            **self._log_context,
        )
        await self._sdk_client.toggle_mcp_server(server_name, enabled)

        return await self._sdk_client.get_mcp_status()

    async def get_mcp_status(self) -> dict:
        """Return current MCP server status."""

        return await self._sdk_client.get_mcp_status()

    # Incoming Events
    # ----------------------------------------------------------------------------------------------

    async def send(
        self,
        prompt: str,
        attachments: list[dict] | None = None,
        inline_replies: list[dict] | None = None,
        note: str | None = None,
    ) -> None:
        """Send user prompt to SDK, injecting synthetic events where needed.

        Attachments/inline replies/a note and internal commands (/compact, /context) inject a
        synthetic user event since the SDK won't echo them; a plain prompt just sets it on the
        pipeline for result-only turn injection.

        `note` carries text typed alongside an AskUserQuestion/ExitPlanMode answer (`prompt` is
        the answer markup then) - a sibling field, not concatenated into `prompt`, because the
        transcript matches answers with an anchored pattern that any prefix/suffix would break.

        Raises AttachmentInvalid if an attachment fails base64 decode or exceeds MAX_ATTACHMENT_BYTES.
        """

        self._logger.info("Sending query", prompt=prompt[:100], **self._log_context)

        await self._ensure_pipeline_alive()
        await self._ensure_stream_healthy()

        note = note.strip() if note else None

        if inline_replies or attachments or note:
            # Drop comments with a blank reply - they are never sent.
            replies = [r for r in (inline_replies or []) if (r.get("response") or "").strip()]

            attachment_meta = self._store_attachments(attachments) if attachments else []

            # Nothing left once blank replies are dropped.
            if not prompt.strip() and not replies and not attachment_meta and not note:
                return

            # Display-only event - content=prompt (never serialized XML) so the optimistic
            # pending turn reconciles by content.
            await self._event_pipeline.inject_event(
                event_type=EventType.USER,
                subtype=EventSubtype.MESSAGE,
                content=prompt,
                is_human=True,
                primary=True,
                attachments=attachment_meta or None,
                inline_replies=replies or None,
                note=note,
            )

            # Suppress the SDK echo - the injected event is canonical (one query, one echo).
            self._event_pipeline.suppress_next_user_echo()

            extra_parts = []

            if note:
                extra_parts.append(note)

            if replies:
                extra_parts.append(self._serialize_inline_replies(replies))

            text = prompt

            if extra_parts:
                text = (prompt + "\n\n" if prompt else "") + "\n\n".join(extra_parts)

            content_blocks = self._build_content_blocks(text, attachments or [])
            self._arm_stall_watchdog()
            await self._sdk_client.query(content_blocks)

            return

        # SDK doesn't emit user message events for internal commands like /compact.
        if INTERNAL_COMMAND_PATTERN.match(prompt):
            await self._event_pipeline.inject_event(
                event_type=EventType.USER,
                subtype=EventSubtype.MESSAGE,
                content=prompt,
                is_human=True,
                primary=True,
            )

        self._event_pipeline.set_prompt(prompt)
        self._arm_stall_watchdog()
        await self._sdk_client.query(prompt)

    async def _ensure_pipeline_alive(self) -> None:
        """Replace a dead event consumer before querying into it.

        A dead pipeline still accepts prompts and runs tools, but produces nothing persisted or
        broadcast - the reply never appears and the message is gone on reload. Only the consumer
        is rebuilt; the runtime connection stays up, so an in-flight turn and its subagents survive.
        """

        if self._event_pipeline is None or self._event_pipeline.is_alive:
            return

        async with self._pipeline_repair_lock:
            # Re-checked under the lock: a replacement reports not-alive for the whole duration
            # of its own start(), so an unguarded check lets two concurrent sends build two consumers.
            if self._event_pipeline is None or self._event_pipeline.is_alive:
                return

            previous = self._event_pipeline

            # The pipeline's own id survives a projection that was never built (a consumer that
            # died before init); rebuilding without it would skip _initialize and buffer forever.
            session_id = previous.session_id or self.current_session_id

            # A replacement consumer can't fix a runtime whose stream has ended - it would just
            # park on the same dead stream, so reconnect instead. Safe to tear down: the sentinel
            # is only delivered after the runtime process has already exited, with no live turn left.
            if previous.stream_lost:
                self._logger.error(
                    "Runtime stream was lost - reconnecting the runtime",
                    resume_id=session_id,
                    **self._log_context,
                )
                await self.restart(session_id)

                return

            if session_id is None:
                self._logger.error(
                    "Event pipeline is not alive and has no session to resume",
                    **self._log_context,
                )

                return

            self._logger.warning(
                "Event pipeline is not alive - rebuilding the consumer",
                resume_id=session_id,
                **self._log_context,
            )

            # Awaiting a task that died of an exception re-raises it, so stopping the corpse can
            # throw - the session-stop path guards this with _dispose; this one does not.
            try:
                await previous.stop()
            except Exception:
                self._logger.exception("Previous event consumer did not stop cleanly")

            # Assign before starting: _initialize calls back into _handle_init, which injects
            # through self._event_pipeline and must reach the replacement.
            self._event_pipeline = EventPipeline(
                sdk_client=self._sdk_client,
                workspace=self._workspace,
                on_init=self._handle_init,
                on_event=self._handle_event,
                resume_session_id=session_id,
            )

            self._suppress_restart_divider = True

            try:
                await self._event_pipeline.start()
            finally:
                self._suppress_restart_divider = False

    async def _ensure_stream_healthy(self) -> None:
        """Act on the runtime's own reader state before adding another prompt to it.

        Catches stalls the consumer can't see from outside, since a parked stream looks like an
        idle one. A finished reader is terminal and triggers a reconnect; a full buffer is only
        reported, since a momentary burst is possible and reconnecting could kill a running turn.
        Reads another package's private state - a complement to the stall watchdog, not something
        the session relies on; an unavailable probe means no verdict.
        """

        if self._sdk_client is None:
            return

        health = self._sdk_client.stream_health()

        if health is None:
            return

        if health.reader_finished:
            self._logger.error(
                "Runtime stopped reading its transport - reconnecting",
                buffered=health.buffered,
                **self._log_context,
            )
            await self.restart(self.current_session_id)

            return

        if health.buffer_full:
            self._logger.error(
                "Runtime message buffer is full - events are no longer being consumed",
                buffered=health.buffered,
                consumers_waiting=health.consumers_waiting,
                **self._log_context,
            )

    async def _watch_for_stalls(self) -> None:
        """Report a runtime that goes silent while a turn is still owed an answer.

        The consumer can't tell a parked stream from an idle one, so silence alone is never a
        fault - silence with an unanswered query is. Diagnosis only, deliberately: the runtime is
        read a whole message at a time, so an uninterrupted think is silent on the wire too, and
        reconnecting on that would kill a turn that was never in trouble. Reported once per turn;
        the next send re-arms it.
        """

        while True:
            await asyncio.sleep(SESSION_STALL_CHECK_INTERVAL.total_seconds())

            if self._stall_reported or self._tools_outstanding:
                continue

            silent_for = self._turn_silence_seconds()

            if silent_for is None or silent_for < SESSION_STALL_TIMEOUT.total_seconds():
                continue

            self._stall_reported = True
            self._logger.error(
                "Runtime went silent mid-turn - no events are reaching the session",
                silent_for_s=round(silent_for, 1),
                **self._log_context,
            )

    def _arm_stall_watchdog(self) -> None:
        """Mark a turn dispatched, so runtime silence from here on counts against it.

        Also clears the outstanding-tool count - a turn that died mid-tool would otherwise leave
        the watchdog disarmed for the rest of the session.
        """

        self._turn_dispatched_at = time.monotonic()
        self._tools_outstanding = 0
        self._stall_reported = False

    def _turn_silence_seconds(self) -> float | None:
        """Seconds since the runtime last spoke on a dispatched turn; None when none is in flight."""

        if self._turn_dispatched_at is None or self._event_pipeline is None:
            return None

        last_heard = self._event_pipeline.last_message_at or self._turn_dispatched_at

        return time.monotonic() - max(last_heard, self._turn_dispatched_at)

    @staticmethod
    def _validate_attachments(attachments: list[dict]) -> None:
        """Validate base64 decodability and per-attachment size budget; raise on first failure."""

        for a in attachments:
            try:
                decoded = base64.b64decode(a["data"])
            except Exception:  # noqa: BLE001 - any decode failure means invalid_base64
                raise AttachmentInvalid("invalid_base64", name=a.get("name", "?"))

            if len(decoded) > MAX_ATTACHMENT_BYTES:
                raise AttachmentInvalid(
                    "attachment_too_large",
                    name=a["name"],
                    size_mb=f"{len(decoded) / 1024 / 1024:.1f}",
                )

    def _store_attachments(self, attachments: list[dict]) -> list[dict]:
        """Validate, persist attachment files to the session dir, and return display metadata."""

        assert self._base_session is not None, "no active session"
        self._validate_attachments(attachments)

        attachments_dir = self._base_session.path / SESSION_ATTACHMENTS_DIR
        attachments_dir.mkdir(exist_ok=True)

        attachment_meta = []

        for a in attachments:
            decoded = base64.b64decode(a["data"])
            stored_name = f"{uuid.uuid4().hex[:8]}_{a['name']}"
            (attachments_dir / stored_name).write_bytes(decoded)
            attachment_meta.append(
                {
                    "name": a["name"],
                    "type": a["type"],
                    "size": len(decoded),
                    "filename": stored_name,
                },
            )

        return attachment_meta

    async def send_and_wait(self, prompt: str) -> str:
        """Send prompt and wait for the assistant's complete response.

        Used by MCP tool calls that need a synchronous response.
        """

        subscriber_id, queue = self._broadcaster.subscribe()

        try:
            await self.send(prompt)

            chunks: list[str] = []

            while True:
                event = await queue.get()

                if not isinstance(event, dict):
                    continue

                event_type = event.get("type", "")

                if event_type == "assistant" and event.get("content"):
                    chunks.append(event["content"])
                elif event_type == "result":
                    break

            return "".join(chunks) or "No response"
        finally:
            self._broadcaster.unsubscribe(subscriber_id)

    async def interrupt(self) -> None:
        """Interrupt current response. Emits interrupt_sent event for frontend visualization."""

        self._logger.info("Interrupting", **self._log_context)

        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.INTERRUPT_SENT,
        )

        await self._emit_compact_boundary_fallback(status="interrupted")
        await self._sdk_client.interrupt()

    @classmethod
    def _build_content_blocks(cls, prompt: str, attachments: list[dict]) -> list[dict]:
        """Build Anthropic API content blocks from prompt text and attachments."""

        blocks: list[dict] = []

        if prompt.strip():
            blocks.append({"type": "text", "text": prompt})

        for attachment in attachments:
            mime = attachment["type"]
            data = attachment["data"]

            if mime.startswith("image/"):
                blocks.append(
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime, "data": data},
                    },
                )
            elif mime == "application/pdf":
                blocks.append(
                    {
                        "type": "document",
                        "source": {"type": "base64", "media_type": mime, "data": data},
                    },
                )
            else:
                # Best-effort: treat as text
                try:
                    text = base64.b64decode(data).decode("utf-8", errors="replace")
                    blocks.append(
                        {
                            "type": "text",
                            "text": f"[File: {attachment['name']}]\n{text}",
                        },
                    )
                except Exception:  # noqa: BLE001 - decode failure falls back to the placeholder
                    blocks.append(
                        {
                            "type": "text",
                            "text": f"[Attachment: {attachment['name']} ({mime})]",
                        },
                    )

        return blocks

    @staticmethod
    def _serialize_inline_replies(replies: list[dict]) -> str:
        """Serialize inline-reply pairs into the <inline-replies> wire envelope.

        XML-escapes only the inner quote/response text and the `from` attribution;
        the surrounding free-text prompt is never wrapped or escaped.
        """

        lines = ["<inline-replies>"]

        for r in replies:
            frm = quoteattr(r.get("from") or "")
            quote = escape(r.get("quote") or "")
            response = escape(r.get("response") or "")
            lines.append(
                f"  <reply><quote from={frm}>{quote}</quote><response>{response}</response></reply>",
            )

        lines.append("</inline-replies>")

        return "\n".join(lines)

    # Outgoing Events
    # ----------------------------------------------------------------------------------------------

    def ensure_ready(self) -> None:
        """Raise SessionNotReady unless the event surface is live.

        Broadcaster and pipeline are absent before start() and after stop(). The SSE surface -
        subscribe() and the /api/stream route - gates here rather than repeating the null-check
        at each site. The container advertises as running for the whole window between
        construction and the daemon's first session request, so this is routine, not exceptional.
        """

        if self._broadcaster is None or self._event_pipeline is None:
            raise SessionNotReady()

    async def subscribe(self) -> tuple[str, asyncio.Queue]:
        """Subscribe to SSE events, replaying history to the new subscriber.

        Raises SessionNotReady before start() and after stop().
        """

        self.ensure_ready()

        subscriber_id, queue = self._broadcaster.subscribe()

        events = (serialize_event(event) for event in self._event_pipeline.get_events())
        await self._broadcaster.replay_to(queue, events)

        return subscriber_id, queue

    async def unsubscribe(self, subscriber_id: str) -> None:
        """Remove SSE subscriber; no-op if the session has been stopped."""

        if self._broadcaster is None:
            return

        self._broadcaster.unsubscribe(subscriber_id)

    # Pipeline callbacks
    # ----------------------------------------------------------------------------------------------

    async def _handle_init(self, session_id: str) -> None:
        """Create and initialize projection when pipeline discovers session_id."""

        self._base_session = BaseSession(session_id=session_id, workspace=self._workspace)

        # Mark every currently-stored window unannounced until this session re-announces it.
        self._rate_limit_pending_reconcile = {
            entry["rate_limit_type"] for entry in self._rate_limit_store.get()
        }

        self._projection = Projection(
            session_id=session_id,
            workspace=self._workspace,
            runtime=self._sdk_client,
            provider=self._session_provider,
        )

        # Replay events into projection when session.json is missing on disk (fork copies
        # events.jsonl but not session.json; this also self-heals corruption).
        if not self._projection.loaded_from_disk:
            for event in self._event_pipeline.get_historical_events():
                self._projection.update(event)

            self._projection.save()
            self._logger.info("Replayed projection from events", **self._log_context)

        summary = self._projection.value

        # Gated on runtime support: a runtime that pins its model at construction raises on
        # set_model, which would kill the consumer before init and drop every later event.
        capabilities = self._sdk_client.capabilities

        if summary.model and capabilities.supports_set_model_mid_session:
            await self._sdk_client.set_model(summary.model)
            self._last_known_model = summary.model

        if summary.permission_mode and capabilities.supports_set_permission_mode:
            await self._sdk_client.set_permission_mode(summary.permission_mode)
            self._last_known_permission_mode = summary.permission_mode

        if summary.effort_level and capabilities.supports_set_effort_level:
            await self._sdk_client.set_effort_level(summary.effort_level)
            self._last_known_effort_level = summary.effort_level

        await self._emit_container_restarted_if_resumed()

        # Refresh context usage after init/replay so the context bar is accurate
        self._schedule_context_refresh()

    async def _emit_container_restarted_if_resumed(self) -> None:
        """Amber transcript divider when a session resumes with prior messages on disk.
        A fork's first boot carries the parent id, so the frontend renders `Forked from <parent>`.
        Later restarts omit it (`Restarted`); a runtime/agent mismatch adds `runtime_mismatch`.
        """

        # A consumer rebuild re-runs init though nothing restarted, and the divider would
        # wrongly claim otherwise - permanently, since it's persisted.
        if self._suppress_restart_divider:
            return

        historical = self._event_pipeline.get_historical_events()

        if not historical:
            return

        summary = self._projection.value
        parent_id = summary.parent_session_id
        already_announced_fork = any(
            e.subtype == "container_restarted"
            and (e.message_data or {}).get("fork_parent_session_id")
            for e in historical
        )

        message_data: dict = {}

        if parent_id and not already_announced_fork:
            message_data["fork_parent_session_id"] = parent_id

        if summary.runtime and summary.runtime != self._expected_runtime_name:
            message_data["runtime_mismatch"] = {
                "persisted": summary.runtime,
                "expected": self._expected_runtime_name,
            }

        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.CONTAINER_RESTARTED,
            message_data=message_data or None,
        )

    async def _handle_event(self, event: PublishedEvent) -> None:
        """Broadcast event to all SSE subscribers."""

        await self._broadcaster.broadcast(event)
        self._projection.update(event)
        self._projection.schedule_save()

        # A tool between start and output is working, not stalling - the runtime emits nothing for a long one.
        if event.subtype == "tool_use":
            self._tools_outstanding += 1
        elif event.subtype == "tool_result":
            self._tools_outstanding = max(0, self._tools_outstanding - 1)

        if event.subtype == "rate_limit" and event.message_data:
            self._fold_rate_limit(event.message_data)

        # Turn answered: disarm the stall watchdog, refresh context usage (debounced).
        if event.type == "result":
            self._turn_dispatched_at = None
            self._tools_outstanding = 0
            self._schedule_context_refresh()
            self._drop_unannounced_rate_limits()

        # Send session prompt to Claude after compaction boundary
        if event.subtype == "compact_boundary":
            self._pending_compact_trigger = None

            if self._pending_session_prompt:
                prompt = self._pending_session_prompt
                self._pending_session_prompt = None
                await self._sdk_client.query(f"<system-reminder>\n{prompt}\n</system-reminder>")

    # Rate Limits
    # ----------------------------------------------------------------------------------------------
    # Best-effort throughout - a slow or contended store write must never break the pipeline.

    def _fold_rate_limit(self, message_data: dict) -> None:
        """Upsert or clear one window from a live `rate_limit` event; marks it re-announced."""

        rate_limit_type = message_data.get("rate_limit_type")

        if not rate_limit_type:
            return

        self._rate_limit_pending_reconcile.discard(rate_limit_type)

        try:
            if message_data.get("status") == "allowed":
                self._rate_limit_store.remove(rate_limit_type)
            else:
                self._rate_limit_store.set(
                    rate_limit_type,
                    status=message_data.get("status"),
                    resets_at=message_data.get("resets_at"),
                    utilization=message_data.get("utilization"),
                )
        except Exception as exc:  # noqa: BLE001 - best-effort persistence, never fatal
            self._logger.warning("Rate-limit store update failed", error=str(exc))

    def _drop_unannounced_rate_limits(self) -> None:
        """At the first exchange's end, drop windows this session never re-announced."""

        if not self._rate_limit_pending_reconcile:
            return

        try:
            for rate_limit_type in self._rate_limit_pending_reconcile:
                self._rate_limit_store.remove(rate_limit_type)
        except Exception as exc:  # noqa: BLE001 - best-effort persistence, never fatal
            self._logger.warning("Rate-limit store reconcile failed", error=str(exc))
        finally:
            self._rate_limit_pending_reconcile.clear()

    # Context Usage
    # ----------------------------------------------------------------------------------------------

    def _schedule_context_refresh(self) -> None:
        """Schedule a debounced SDK context usage refresh."""

        if self._context_refresh_timer is not None:
            self._context_refresh_timer.cancel()

        loop = asyncio.get_event_loop()
        self._context_refresh_timer = loop.call_later(0.5, self._fire_context_refresh)

    def _fire_context_refresh(self) -> None:
        """Timer callback - kicks off async context usage fetch."""

        self._context_refresh_timer = None
        asyncio.ensure_future(self._refresh_context_usage())

    async def _refresh_context_usage(self) -> None:
        """Fetch context usage from the runtime and update projection."""

        try:
            usage = await self._sdk_client.get_context_usage()
        except Exception as exc:  # noqa: BLE001 - best-effort refresh, never fatal
            self._logger.warning("Context usage fetch failed", error=str(exc))

            return

        if usage is None:
            return

        self._projection.update_fields(
            last_context_tokens=usage.used_tokens,
            context_window=usage.max_tokens,
        )

    # Hook callbacks
    # ----------------------------------------------------------------------------------------------
    # Registered via HookCallbacks; runtime fires with typed payloads after its own delta
    # detection, so handlers emit pipeline events unconditionally.

    async def _on_session_start(self) -> None:
        """Callback: mount /tmp to current session's temp directory."""

        if self._base_session:
            ensure_tmp(self._base_session)

    async def _on_compact_start(self, payload: CompactStartPayload) -> None:
        """Callback: emit compact_start event and capture session prompt for post-compaction sending."""

        # Capture session prompt to send after compaction boundary
        if self._projection and self._projection.value:
            self._pending_session_prompt = self._projection.value.session_prompt
        else:
            self._pending_session_prompt = None

        self._pending_compact_trigger = payload.trigger

        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.COMPACT_START,
            message_data={"compact_metadata": {"trigger": payload.trigger}},
        )

    async def _emit_compact_boundary_fallback(self, status: str) -> None:
        """Emit a synthetic compact_boundary if a compaction is in flight."""

        if not (self._event_pipeline and self._event_pipeline.turn_tracker.is_compacting):
            return

        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.COMPACT_BOUNDARY,
            message_data={
                "compact_metadata": {
                    "trigger": self._pending_compact_trigger or "unknown",
                    "status": status,
                },
            },
        )

        self._pending_session_prompt = None
        self._pending_compact_trigger = None

    async def _on_model_changed(self, model: str) -> None:
        """Emit a model_changed pipeline event."""

        previous = self._last_known_model
        self._last_known_model = model
        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.MODEL_CHANGED,
            model=model,
            previous_model=previous,
        )

    async def _on_permission_mode_changed(self, mode: str) -> None:
        """Emit a permission_mode_changed pipeline event."""

        previous = self._last_known_permission_mode
        self._last_known_permission_mode = mode
        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.PERMISSION_MODE_CHANGED,
            permission_mode=mode,
            previous_permission_mode=previous,
        )

    async def _on_effort_level_changed(self, level: str) -> None:
        """Emit an effort_level_changed pipeline event."""

        previous = self._last_known_effort_level
        self._last_known_effort_level = level
        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.EFFORT_LEVEL_CHANGED,
            content=level,
            previous_effort_level=previous,
        )
