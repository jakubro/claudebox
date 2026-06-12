"""Session facade - SDK client, pipeline, persistence coordination."""

import asyncio
import base64
import os
import re
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import cast

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
from ..session import make_agent_session
from ...config import Config
from ...constants import (
    MAX_ATTACHMENT_BYTES,
    SDK_PROCESS_BUFFER_SIZE,
    SESSION_ATTACHMENTS_DIR,
    SESSION_METADATA_FILE,
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
        self._system_prompt = system_prompt
        self._permission_mode = permission_mode
        self._on_start = on_start
        self._on_stop = on_stop
        self._last_known_model: str | None = None
        self._last_known_permission_mode: str | None = None
        self._last_known_effort_level: str | None = None
        self._pending_session_prompt: str | None = None
        self._pending_compact_trigger: str | None = None

        self._base_session: BaseSession | None = None
        self._repo = SessionRepository(self._workspace)

        # Cast to non-Optional; start() populates them.
        #
        # TODO: type-honest refactor (sweep 11) - Builder + Started container
        # so post-start access is genuinely non-Optional without the cast lie.
        # 80+ internal access sites to migrate. Out of scope for this batch.
        self._sdk_client: AgentSession = cast(AgentSession, None)
        self._event_pipeline: EventPipeline = cast(EventPipeline, None)
        self._broadcaster: Broadcaster = cast(Broadcaster, None)
        self._tool_output: ToolOutput = cast(ToolOutput, None)
        self._attachment_service: AttachmentService = cast(AttachmentService, None)
        self._summary_cache: FileCache = cast(FileCache, None)
        self._projection: Projection = cast(Projection, None)

        self._client_task: asyncio.Task | None = None
        self._pipeline_task: asyncio.Task | None = None
        self._context_refresh_timer: asyncio.TimerHandle | None = None

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
            }
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
            # set_model / set_permission_mode / set_effort_level are unsupported
            # under LangGraph v1 (graph-construction-time bind); the corresponding
            # change-callbacks are intentionally not registered.
            raw_model = workspace_config.langgraph_model or ""
            provider = raw_model.partition(":")[0]
            provider_kwargs = dict(workspace_config.langgraph_provider_kwargs.get(provider, {}))

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

        self._logger.info("Session started", session_id=session_id, **self._log_context)

        return session_id

    async def stop(self) -> None:
        """Stop session components."""

        self._logger.info("Stopping session...", **self._log_context)

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
            except Exception as exc:
                self._logger.error("Error disposing component", attr=attr, error=str(exc))
            finally:
                setattr(self, attr, None)
        else:
            try:
                await getattr(obj, cleanup_method)()
            except Exception as exc:
                self._logger.error("Error disposing component", attr=attr, error=str(exc))
            finally:
                setattr(self, attr, None)

    # Session Manager API
    # ----------------------------------------------------------------------------------------------

    def list_sessions(self) -> list[SessionSummary]:
        """List all sessions, newest first.

        Delegates raw iteration and sorting to SessionRepository, then enriches
        each result with Projection (cached by FileCache for performance).
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

        if not session_id:
            return self._projection
        elif self._projection and session_id == self._projection.session_id:
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

    async def send(self, prompt: str, attachments: list[dict] | None = None) -> None:
        """Send user prompt to SDK, injecting synthetic events where needed.

        Three paths: (1) attachments - validates, builds content blocks, injects
        synthetic user event with display metadata; (2) internal commands
        (/compact, /context) - injects synthetic user event since SDK won't echo;
        (3) normal - sets prompt on pipeline for result-only turn injection,
        then queries SDK.

        Raises AttachmentInvalid if any attachment fails base64 decode or
        exceeds MAX_ATTACHMENT_BYTES.
        """

        self._logger.info("Sending query", prompt=prompt[:100], **self._log_context)

        if attachments:
            # Only this branch dereferences _base_session.path.
            assert self._base_session is not None, "no active session"
            self._validate_attachments(attachments)

            # Write attachment files to session directory
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
                    }
                )

            # Inject synthetic user event with display metadata (no base64)
            await self._event_pipeline.inject_event(
                event_type=EventType.USER,
                subtype=EventSubtype.MESSAGE,
                content=prompt,
                is_human=True,
                primary=True,
                attachments=attachment_meta,
            )

            # Signal pipeline to suppress the SDK echo - synthetic injection is canonical
            # One suppression suffices: all attachments are sent in a single SDK
            # query, so the SDK emits exactly one user message echo to suppress.
            self._event_pipeline.suppress_next_user_echo()

            # Build content blocks for SDK (with full base64 data)
            content_blocks = self._build_content_blocks(prompt, attachments)
            await self._sdk_client.query(content_blocks)

            return

        # For internal commands (like /compact), SDK doesn't emit user message events.
        # Inject one so frontend can reconcile pending messages.
        if INTERNAL_COMMAND_PATTERN.match(prompt):
            await self._event_pipeline.inject_event(
                event_type=EventType.USER,
                subtype=EventSubtype.MESSAGE,
                content=prompt,
                is_human=True,
                primary=True,
            )

        self._event_pipeline.set_prompt(prompt)
        await self._sdk_client.query(prompt)

    @staticmethod
    def _validate_attachments(attachments: list[dict]) -> None:
        """Validate base64 decodability and per-attachment size budget; raise on first failure."""

        for a in attachments:
            try:
                decoded = base64.b64decode(a["data"])
            except Exception:
                raise AttachmentInvalid("invalid_base64", name=a.get("name", "?"))

            if len(decoded) > MAX_ATTACHMENT_BYTES:
                raise AttachmentInvalid(
                    "attachment_too_large",
                    name=a["name"],
                    size_mb=f"{len(decoded) / 1024 / 1024:.1f}",
                )

    async def send_and_wait(self, prompt: str) -> str:
        """Send prompt and wait for the assistant's complete response.

        Subscribes to the broadcaster, sends the prompt, then collects
        assistant text events until a result event signals turn completion.
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
                except Exception:
                    blocks.append(
                        {
                            "type": "text",
                            "text": f"[Attachment: {attachment['name']} ({mime})]",
                        },
                    )

        return blocks

    # Outgoing Events
    # ----------------------------------------------------------------------------------------------

    async def subscribe(self) -> tuple[str, asyncio.Queue]:
        """Subscribe to SSE events, replaying history to the new subscriber."""

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
        self._projection = Projection(
            session_id=session_id,
            workspace=self._workspace,
            runtime=self._sdk_client,
        )

        # Replay events into projection when session.json was not found on disk
        # (fork copies events.jsonl but not session.json; also self-heals corruption)
        if not self._projection.loaded_from_disk:
            for event in self._event_pipeline.get_historical_events():
                self._projection.update(event)

            self._projection.save()
            self._logger.info("Replayed projection from events", **self._log_context)

        summary = self._projection.value

        if summary.model:
            await self._sdk_client.set_model(summary.model)
            self._last_known_model = summary.model

        if summary.permission_mode:
            await self._sdk_client.set_permission_mode(summary.permission_mode)
            self._last_known_permission_mode = summary.permission_mode

        if summary.effort_level:
            await self._sdk_client.set_effort_level(summary.effort_level)
            self._last_known_effort_level = summary.effort_level

        await self._emit_container_restarted_if_resumed()

        # Refresh context usage after init/replay so the context bar is accurate
        self._schedule_context_refresh()

    async def _emit_container_restarted_if_resumed(self) -> None:
        """Mark the chat transcript with an amber divider when the session resumes with prior messages.

        Fires only when historical events exist on disk (pristine session starts emit nothing).
        First boot of a forked session carries the parent's id in `message_data` so the frontend
        can render `Forked from <parent>`; subsequent restarts of that forked session emit without
        the payload (rendered as plain `Restarted`).
        """

        historical = self._event_pipeline.get_historical_events()

        if not historical:
            return

        parent_id = self._projection.value.parent_session_id
        already_announced_fork = any(
            e.subtype == "container_restarted"
            and (e.message_data or {}).get("fork_parent_session_id")
            for e in historical
        )

        message_data = (
            {"fork_parent_session_id": parent_id}
            if parent_id and not already_announced_fork
            else None
        )

        await self._event_pipeline.inject_event(
            event_type=EventType.SYSTEM,
            subtype=EventSubtype.CONTAINER_RESTARTED,
            message_data=message_data,
        )

    async def _handle_event(self, event: PublishedEvent) -> None:
        """Broadcast event to all SSE subscribers."""

        await self._broadcaster.broadcast(event)
        self._projection.update(event)
        self._projection.schedule_save()

        # Schedule debounced context usage refresh on result events
        if event.type == "result":
            self._schedule_context_refresh()

        # Send session prompt to Claude after compaction boundary
        if event.subtype == "compact_boundary":
            self._pending_compact_trigger = None

            if self._pending_session_prompt:
                prompt = self._pending_session_prompt
                self._pending_session_prompt = None
                await self._sdk_client.query(f"<system-reminder>\n{prompt}\n</system-reminder>")

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
        except Exception as exc:
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
    # Registered via HookCallbacks; runtime fires with typed payloads after
    # its own delta detection, so handlers emit pipeline events unconditionally.

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
