"""Session lifecycle orchestration - list, create, resume, fork from workspace disk."""

import asyncio
import json
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from claudebox import (
    Broadcaster,
    SessionRepository,
    SingleFlight,
    Workspace,
    get_logger,
    read_json,
    resolve_runtime_class,
    write_json,
)
from claudebox import SessionNotFound as SharedSessionNotFound
from claudebox.constants import SESSION_EVENTS_FILE, SESSION_METADATA_FILE
from .errors import SessionNotFound
from .models import SessionInfo, SessionProgressEvent, SessionsChangedEvent
from ..errors import ListingTimeout
from ..executors import Admission, ObservedPool, tracked
from ...constants import (
    CONTAINER_HEALTH_STARTUP_INTERVAL,
    CONTAINER_HEALTH_STARTUP_MAX_RETRIES,
    CONTAINER_HEALTH_STARTUP_TIMEOUT,
    CONTAINER_SESSION_REQUEST_TIMEOUT,
    DISK_LISTING_TIMEOUT,
)


if TYPE_CHECKING:
    from ..containers import ContainerService
    from ..workspaces import RegisteredWorkspace


# Fields a fork inherits verbatim from its parent. Counters/snapshots instead derive from the
# child's events.jsonl, since a truncated child's events differ from the parent's transcript.
INHERITED_CONFIG_FIELDS = frozenset(
    {
        "name",
        "model",
        "permission_mode",
        "effort_level",
        "session_prompt",
        "first_message",
        "context_window",
        "commands",
    },
)


def _jsonl_lines(text: str) -> list[str]:
    """Split JSONL on newlines only, keeping each line's terminator.

    `str.splitlines()` also breaks on U+2028/U+2029/NEL, which JSON allows raw inside an
    unescaped string, so using it would shred valid records into unparseable fragments.
    """

    if not text:
        return []

    lines = text.split("\n")
    unterminated = lines.pop()
    kept = [line + "\n" for line in lines]

    if unterminated:
        kept.append(unterminated)

    return kept


class SessionService:
    """Manage sessions within a single workspace.

    Delegates session CRUD to the shared SessionRepository; orchestrates container
    lifecycle for new/resumed sessions.
    """

    def __init__(
        self,
        workspace: "RegisteredWorkspace",
        containers: "ContainerService",
        events: Broadcaster,
        agent: str,
        executor: ObservedPool,
    ) -> None:
        self._logger = get_logger(__name__)

        self._workspace = workspace
        self._repo = SessionRepository(Workspace(workspace.path))
        self._containers = containers
        self._events = events
        # resolve_runtime_class(agent) drives synthesis defaults so Claude constants don't
        # leak into LangGraph workspaces.
        self._agent = agent
        # Daemon-owned executor so list_all()'s disk walk doesn't block the event loop.
        self._executor = executor
        self._listing_flight = SingleFlight()
        self._admission = Admission()

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Start session service."""

        self._logger.debug("Starting session service...", **self._log_context)
        self._logger.info("Session service started", **self._log_context)

    async def stop(self) -> None:
        """Stop session service."""

        self._logger.debug("Stopping session service...", **self._log_context)
        self._logger.info("Session service stopped", **self._log_context)

    # Session Management
    # ----------------------------------------------------------------------------------------------

    async def list_all(self) -> list[SessionInfo]:
        """List all sessions from workspace disk, plus running containers without session.json.

        Dispatched to the daemon executor, bounded by DISK_LISTING_TIMEOUT so a hung
        filesystem call can't tie up a worker forever. Concurrent callers share one scan.
        """

        from ..containers import ContainerStatus

        try:
            metadata_list = await asyncio.wait_for(
                self._listing_flight.run(self._dispatch_scan),
                timeout=DISK_LISTING_TIMEOUT.total_seconds(),
            )
        except TimeoutError as exc:
            self._logger.warning(
                "session_listing_timed_out",
                timeout=DISK_LISTING_TIMEOUT.total_seconds(),
                scan_started=self._admission.started,
                queued_seconds=round(self._admission.queued_seconds, 3),
                pool=self._executor.stats().asdict(),
                **self._log_context,
            )

            raise ListingTimeout(workspace=str(self._workspace.path)) from exc

        sessions = []
        seen_session_ids = set()

        for metadata in metadata_list:
            container = await self._containers.find_by_session(metadata.session_id)

            data = metadata.asdict()
            data["container_id"] = container.id if container else None
            sessions.append(SessionInfo.fromdict(data))
            seen_session_ids.add(metadata.session_id)

        # Merge running/starting containers whose sessions aren't on disk yet
        for container in self._containers.list_all():
            if (
                container.session_id
                and container.session_id not in seen_session_ids
                and container.status in (ContainerStatus.RUNNING, ContainerStatus.STARTING)
            ):
                sessions.append(
                    self._synthesize_session_info(
                        container.session_id,
                        container.id,
                        started_at=container.created_at,
                    ),
                )

        return sessions

    def _dispatch_scan(self):
        """Submit the repo scan, recording when a worker picks it up."""

        loop = asyncio.get_running_loop()
        scan, self._admission = tracked(self._repo.list_all)

        return loop.run_in_executor(self._executor, scan)

    async def get(self, session_id: str) -> SessionInfo:
        """Read session metadata from disk; raises SessionNotFound if missing."""

        try:
            metadata = self._repo.get(session_id)
        except SharedSessionNotFound as exc:
            raise SessionNotFound(session_id=exc.session_id) from exc

        container = await self._containers.find_by_session(session_id)

        data = metadata.asdict()
        data["container_id"] = container.id if container else None

        return SessionInfo.fromdict(data)

    async def update(self, session_id: str, **fields) -> SessionInfo:
        """Update session metadata fields on disk."""

        try:
            self._repo.update(session_id, **fields)
        except SharedSessionNotFound as exc:
            raise SessionNotFound(session_id=exc.session_id) from exc

        result = await self.get(session_id)
        await self._broadcast_sessions_changed()

        return result

    async def create(self) -> SessionInfo:
        """Create a new session: spawn container, wait for health, initialize session.

        Returns a fully-populated SessionInfo so the frontend footer renders immediately; the
        SDK init event later refreshes fields with the container's settled values.
        """

        self._logger.info("Creating new session", **self._log_context)

        await self._broadcast_progress("Creating container")
        container = await self._containers.create()

        await self._broadcast_progress("Waiting for container")
        await self._wait_for_health(container.id)

        # Container mints the session ID; treat its response as authoritative.
        await self._broadcast_progress("Starting session")

        async with httpx.AsyncClient(
            timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
        ) as client:
            response = await client.post(f"{container.base_url}/api/sessions/new")
            session_id = response.json()["session_id"]

        # Register session_id now so find_by_session() locates it before the next health poll.
        await self._containers.update(container, session_id=session_id)

        await self._broadcast_sessions_changed()

        # Synthesize from known sources + defaults rather than reading the repo: the container's
        # pipeline writes session.json as events flow, so it may not exist yet.
        workspace = Workspace(self._workspace.path)
        new_session_dir = workspace.ensure_session(session_id).path
        cls = resolve_runtime_class(self._agent)
        now = datetime.now(timezone.utc)

        return SessionInfo(
            session_id=session_id,
            container_id=container.id,
            session_dir=str(new_session_dir),
            workspace=str(workspace.path),
            started_at=now,
            updated_at=now,
            num_turns=0,
            total_cost_usd=0.0,
            fork_point_cost_usd=0.0,
            model=cls.get_default_model(),
            permission_mode=cls.get_default_permission_mode(),
            effort_level=cls.get_default_effort_level(),
        )

    async def resume(self, session_id: str) -> SessionInfo:
        """Resume an existing session: reuse running container or spawn new one.

        Returns a full SessionInfo so the footer renders without waiting for the projection refresh.
        """

        self._logger.info("Resuming session", session_id=session_id, **self._log_context)

        existing = await self._containers.find_by_session(session_id, sync=True)

        if existing:
            return await self._build_session_info(session_id, existing.id)

        await self._broadcast_progress("Creating container", session_id=session_id)
        container = await self._containers.create(session_id=session_id)

        await self._broadcast_progress("Waiting for container", session_id=session_id)
        await self._wait_for_health(container.id)

        await self._broadcast_progress("Resuming session", session_id=session_id)

        async with httpx.AsyncClient(
            timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
        ) as client:
            await client.post(f"{container.base_url}/api/sessions/{session_id}/resume")

        await self._broadcast_sessions_changed()

        return await self._build_session_info(session_id, container.id)

    async def _build_session_info(self, session_id: str, container_id: str) -> SessionInfo:
        """Build a SessionInfo for resume() from on-disk metadata.

        Falls back to a synthesized record (default model/permission mode/effort level)
        when session.json is missing.
        """

        try:
            metadata = self._repo.get(session_id)
        except SharedSessionNotFound:
            return self._synthesize_session_info(session_id, container_id)

        cls = resolve_runtime_class(self._agent)
        workspace = Workspace(self._workspace.path)
        data = metadata.asdict()
        data["container_id"] = container_id
        data.setdefault("workspace", str(workspace.path))
        data.setdefault("effort_level", cls.get_default_effort_level())
        data.setdefault("model", cls.get_default_model())
        data.setdefault("permission_mode", cls.get_default_permission_mode())

        return SessionInfo.fromdict(data)

    def _synthesize_session_info(
        self,
        session_id: str,
        container_id: str,
        *,
        started_at=None,
    ) -> SessionInfo:
        """Synthesize a SessionInfo from defaults when session.json is missing.

        Used for the list_all merge path (spawned, no session.json yet) and by resume()
        when on-disk metadata is absent.
        """

        cls = resolve_runtime_class(self._agent)
        workspace = Workspace(self._workspace.path)
        data: dict = {
            "session_id": session_id,
            "container_id": container_id,
            "workspace": str(workspace.path),
            "fork_point_cost_usd": 0.0,
            "model": cls.get_default_model(),
            "permission_mode": cls.get_default_permission_mode(),
            "effort_level": cls.get_default_effort_level(),
        }

        if started_at is not None:
            data["started_at"] = started_at

        return SessionInfo.fromdict(data)

    async def fork(
        self,
        source_session_id: str,
        turn_id: str | None = None,
        *,
        reuse_container: bool = False,
    ) -> SessionInfo:
        """Fork session: copy files, optionally truncate at turn, spawn or reuse container.

        turn_id=None forks the complete session without truncation.
        """

        new_session_id = str(uuid.uuid4())
        self._logger.info(
            "Forking session",
            source_id=source_session_id,
            turn_id=turn_id,
            new_id=new_session_id,
            reuse_container=reuse_container,
            **self._log_context,
        )

        workspace = Workspace(self._workspace.path)
        loop = asyncio.get_running_loop()

        # Copy-through-seed-write is one unit - a failure must not strand an event log with no
        # session.json. Startup is excluded: a failed spawn past the seed leaves the fork
        # stopped, which resume recovers.
        try:
            await loop.run_in_executor(
                None,
                self._copy_sdk_session_dir,
                workspace,
                source_session_id,
                new_session_id,
            )
            await loop.run_in_executor(
                None,
                self._copy_sdk_transcript,
                workspace,
                source_session_id,
                new_session_id,
            )

            await loop.run_in_executor(
                None,
                self._copy_claudebox_session,
                workspace,
                source_session_id,
                new_session_id,
            )
            await loop.run_in_executor(
                None,
                self._rekey_langgraph_checkpoint,
                workspace,
                source_session_id,
                new_session_id,
            )

            # Seed session.json with parent link so the container Projection picks it up.
            new_session = workspace.ensure_session(new_session_id)

            # Read parent's session.json directly for the INHERITED_CONFIG_FIELDS allow-list;
            # _copy_claudebox_session excludes it.
            source_session_path = (
                workspace.ensure_session(source_session_id).path / SESSION_METADATA_FILE
            )

            try:
                parent_data = read_json(source_session_path, default={}) or {}
            except ValueError as exc:
                self._logger.warning(
                    "Parent session.json unparseable; fork starts with defaults",
                    source_id=source_session_id,
                    error=str(exc),
                    **self._log_context,
                )
                parent_data = {}

            # Truncate before deriving counters so totals reflect only the events the child
            # transcript will contain; skipped for a whole-session fork.
            if turn_id is not None:
                await loop.run_in_executor(
                    None,
                    self._truncate_sdk_transcript,
                    workspace,
                    new_session_id,
                    turn_id,
                )
                await loop.run_in_executor(
                    None,
                    self._truncate_events,
                    workspace,
                    new_session_id,
                    turn_id,
                )

            # Derive from the (possibly truncated) child events.jsonl, not parent_data, to avoid
            # double-counting the parent's tail in cross-session rollups.
            events_path = new_session.path / SESSION_EVENTS_FILE
            derived = await loop.run_in_executor(
                None,
                self._compute_derived_fields,
                events_path,
            )

            # Identity/config inherited from parent; counters/snapshots from derived below.
            inherited = {k: v for k, v in parent_data.items() if k in INHERITED_CONFIG_FIELDS}

            now = datetime.now(timezone.utc).isoformat()
            seed: dict = {
                **inherited,
                **derived,
                "session_id": new_session_id,
                "parent_session_id": source_session_id,
                "session_dir": str(new_session.path),
                "workspace": str(workspace.path),
                "started_at": now,
                "updated_at": now,
                "fork_point_cost_usd": derived["total_cost_usd"],
            }

            write_json(new_session.path / SESSION_METADATA_FILE, seed)
        # fork() is awaited unshielded from the request handler, so a client disconnect
        # mid-copy (CancelledError, a BaseException) is likelier here than a real error.
        except (Exception, asyncio.CancelledError):
            self._discard_fork_artifacts(workspace, new_session_id)

            raise

        if reuse_container:
            container = await self._containers.find_by_session(source_session_id)

            if not container:
                raise ValueError(f"No running container for source session {source_session_id}")

            # Without this, find_by_session() still resolves the parent, so stopping it
            # would kill the active child.
            await self._containers.update(container, session_id=new_session_id)
        else:
            await self._broadcast_progress("Creating container", session_id=new_session_id)
            container = await self._containers.create(session_id=new_session_id)

            await self._broadcast_progress("Waiting for container", session_id=new_session_id)
            await self._wait_for_health(container.id)

        await self._broadcast_progress("Resuming session", session_id=new_session_id)

        async with httpx.AsyncClient(
            timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
        ) as client:
            await client.post(f"{container.base_url}/api/sessions/{new_session_id}/resume")

        await self._broadcast_sessions_changed()

        # Return full SessionInfo so callers can act without waiting for the SSE-debounced refresh.
        return SessionInfo.fromdict({**seed, "container_id": container.id})

    # Internal
    # ----------------------------------------------------------------------------------------------

    async def _wait_for_health(self, container_id: str) -> None:
        """Poll container health endpoint until it responds 200."""

        from ..containers import ContainerTimeout

        container = self._containers.get(container_id)

        for attempt in range(CONTAINER_HEALTH_STARTUP_MAX_RETRIES):
            try:
                async with httpx.AsyncClient(
                    timeout=CONTAINER_HEALTH_STARTUP_TIMEOUT.total_seconds(),
                ) as client:
                    response = await client.get(f"{container.base_url}/api/health")
                    response.raise_for_status()

                    return
            except Exception:
                if attempt < CONTAINER_HEALTH_STARTUP_MAX_RETRIES - 1:
                    await asyncio.sleep(CONTAINER_HEALTH_STARTUP_INTERVAL.total_seconds())

        self._logger.warning(
            "Container health check timed out",
            container={"id": container_id},
            **self._log_context,
        )

        raise ContainerTimeout(container_id=container_id)

    # Fork Helpers
    # ----------------------------------------------------------------------------------------------

    def _copy_sdk_session_dir(self, workspace: Workspace, source_id: str, new_id: str) -> None:
        """Copy SDK session directory (tool-results, subagents). Skip if absent."""

        src = workspace.sdk_project_dir / source_id

        if src.exists():
            try:
                shutil.copytree(
                    src,
                    workspace.sdk_project_dir / new_id,
                    ignore_dangling_symlinks=True,
                )
            except shutil.Error as exc:
                for src_path, dst_path, reason in exc.args[0]:
                    self._logger.warning(
                        "Skipped unreadable file during fork",
                        src=src_path,
                        dst=dst_path,
                        reason=reason,
                    )

    @classmethod
    def _copy_sdk_transcript(cls, workspace: Workspace, source_id: str, new_id: str) -> None:
        """Copy SDK transcript JSONL file. Skip if absent."""

        src = workspace.sdk_project_dir / f"{source_id}.jsonl"

        if src.exists():
            shutil.copy2(src, workspace.sdk_project_dir / f"{new_id}.jsonl")

    def _truncate_sdk_transcript(self, workspace: Workspace, session_id: str, turn_id: str) -> None:
        """Truncate SDK transcript, keeping lines before user message with matching turn_id."""

        path = workspace.sdk_project_dir / f"{session_id}.jsonl"

        if not path.exists():
            return

        kept = []

        for line in _jsonl_lines(path.read_text()):
            data = self._parse_jsonl_line(line, path)

            if data is not None and data.get("type") == "user" and data.get("uuid") == turn_id:
                break

            kept.append(line)

        path.write_text("".join(kept))

    def _copy_claudebox_session(self, workspace: Workspace, source_id: str, new_id: str) -> None:
        """Copy claudebox session directory, excluding session.json."""

        src = workspace.ensure_session(source_id).path
        dst = workspace.ensure_session(new_id).path

        try:
            shutil.copytree(
                src,
                dst,
                ignore=shutil.ignore_patterns(SESSION_METADATA_FILE),
                ignore_dangling_symlinks=True,
                dirs_exist_ok=True,
            )
        except shutil.Error as exc:
            for src_path, dst_path, reason in exc.args[0]:
                self._logger.warning(
                    "Skipped unreadable file during fork",
                    src=src_path,
                    dst=dst_path,
                    reason=reason,
                )

    def _rekey_langgraph_checkpoint(
        self,
        workspace: Workspace,
        source_id: str,
        new_id: str,
    ) -> None:
        """Re-key a copied LangGraph checkpoint onto the fork's own thread_id.

        A copy still points at the parent's `thread_id` (pinned to `session_id`) unless
        re-keyed, so the fork would read empty state; only the key column is rewritten, since
        payloads never embed it. No-op when the file is absent. Kept full-fidelity, not
        truncated, so the model recalls more than the fork's own transcript (see
        ARCHITECTURE.md's Fork paragraph).
        """

        path = workspace.ensure_session(new_id).path / "checkpoints.sqlite"

        if not path.exists():
            return

        conn = sqlite3.connect(path)

        try:
            conn.execute(
                "UPDATE checkpoints SET thread_id = ? WHERE thread_id = ?",
                (new_id, source_id),
            )
            conn.execute(
                "UPDATE writes SET thread_id = ? WHERE thread_id = ?",
                (new_id, source_id),
            )
            conn.commit()
        finally:
            conn.close()

    def _truncate_events(self, workspace: Workspace, session_id: str, turn_id: str) -> None:
        """Truncate events.jsonl, keeping lines before first occurrence of turn_id."""

        path = workspace.ensure_session(session_id).path / "events.jsonl"

        # A session that never persisted an event has nothing to truncate.
        if not path.exists():
            return

        kept = []

        for line in _jsonl_lines(path.read_text()):
            data = self._parse_jsonl_line(line, path)

            if data is not None and data.get("turn_id") == turn_id:
                break

            kept.append(line)

        path.write_text("".join(kept))

    def _compute_derived_fields(self, events_path: Path) -> dict:
        """Sum counters and snapshot last-value fields from an events JSONL log.

        Mirrors Projection.update so totals match the events the transcript will replay;
        absent file yields zeros/None.
        """

        cost = 0.0
        duration_ms = 0
        num_turns = 0
        last_message: str | None = None
        last_context_tokens = 0
        todos: list[dict] | None = None

        if events_path.exists():
            for line in _jsonl_lines(events_path.read_text()):
                if not line.strip():
                    continue

                data = self._parse_jsonl_line(line, events_path)

                if data is None:
                    continue

                if data.get("cost_usd"):
                    cost += data["cost_usd"]

                if data.get("duration_ms"):
                    duration_ms += data["duration_ms"]

                if data.get("is_human"):
                    num_turns += 1

                    if data.get("content"):
                        last_message = data["content"]

                if data.get("context_tokens"):
                    last_context_tokens = data["context_tokens"]

                tool_input = data.get("tool_input")

                if tool_input and "todos" in tool_input:
                    todos = tool_input["todos"]

        return {
            "total_cost_usd": cost,
            "total_duration_ms": duration_ms,
            "num_turns": num_turns,
            "last_message": last_message,
            "last_context_tokens": last_context_tokens,
            "todos": todos,
        }

    def _parse_jsonl_line(self, line: str, path: Path) -> dict | None:
        """Parse one JSONL record, returning None on a damaged line rather than raising.

        One unreadable line must not turn a rewind into a 500.
        """

        try:
            return json.loads(line)
        except ValueError as exc:
            self._logger.warning(
                "Skipped unparseable transcript line during fork",
                path=str(path),
                error=str(exc),
            )

            return None

    def _discard_fork_artifacts(self, workspace: Workspace, new_session_id: str) -> None:
        """Remove everything a failed fork copied, leaving no orphan session behind.

        Safe to delete: new_session_id is a fresh uuid minted in fork(), so these paths can't
        predate the call. Failures are logged, not raised, so the original error propagates.
        """

        targets = (
            workspace.sdk_project_dir / new_session_id,
            workspace.sdk_project_dir / f"{new_session_id}.jsonl",
            workspace.ensure_session(new_session_id).path,
        )

        for target in targets:
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
            except OSError as exc:
                self._logger.warning(
                    "Could not remove forked session artifact after failure",
                    path=str(target),
                    error=str(exc),
                )

    # Misc
    # ----------------------------------------------------------------------------------------------

    async def _broadcast_progress(self, message: str, *, session_id: str | None = None) -> None:
        """Broadcast a session progress event via daemon SSE."""

        await self._events.broadcast(
            SessionProgressEvent(
                workspace_id=self._workspace.id,
                message=message,
                session_id=session_id,
            ),
        )

    async def _broadcast_sessions_changed(self, *, container_id: str | None = None) -> None:
        """Signal that the sessions list has changed via daemon SSE."""

        await self._events.broadcast(
            SessionsChangedEvent(
                workspace_id=self._workspace.id,
                container_id=container_id,
            ),
        )

    @property
    def _log_context(self) -> dict:
        return {
            "workspace": {"id": self._workspace.id, "path": self._workspace.path},
        }
