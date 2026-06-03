"""Session lifecycle orchestration — list, create, resume, fork from workspace disk."""

import asyncio
import json
import shutil
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import httpx

from claudebox import (
    Broadcaster,
    ClaudeRuntime,
    SessionRepository,
    Workspace,
    get_logger,
    read_json,
    write_json,
)
from claudebox import SessionNotFound as SharedSessionNotFound
from claudebox.constants import SESSION_METADATA_FILE
from .errors import SessionNotFound
from .models import SessionInfo, SessionProgressEvent, SessionsChangedEvent
from ...constants import (
    CONTAINER_HEALTH_STARTUP_INTERVAL,
    CONTAINER_HEALTH_STARTUP_MAX_RETRIES,
    CONTAINER_HEALTH_STARTUP_TIMEOUT,
    CONTAINER_SESSION_REQUEST_TIMEOUT,
)


if TYPE_CHECKING:
    from ..containers import ContainerService
    from ..workspaces import RegisteredWorkspace


class SessionService:
    """Manage sessions within a single workspace.

    Delegates session CRUD to the shared SessionRepository and orchestrates
    container lifecycle for new/resumed sessions.

    Attributes:
        _workspace: The registered workspace this service is scoped to.
        _repo: Shared session repository for disk I/O.
        _containers: Container orchestrator for spawning/finding containers.
        _events: Broadcaster for publishing events.
    """

    def __init__(
        self,
        workspace: "RegisteredWorkspace",
        containers: "ContainerService",
        events: Broadcaster,
    ) -> None:
        self._logger = get_logger(__name__)

        self._workspace = workspace
        self._repo = SessionRepository(Workspace(workspace.path))
        self._containers = containers
        self._events = events

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
        """List all sessions from workspace disk, plus running containers without session.json."""

        from ..containers import ContainerStatus

        metadata_list = self._repo.list_all()

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
                    )
                )

        return sessions

    async def get(self, session_id: str) -> SessionInfo:
        """Read session metadata from disk.

        Raises SessionNotFound if session directory or session.json is missing.
        """

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

        Returns a fully-populated SessionInfo so the frontend footer renders from the
        moment of creation; the SDK init event later refreshes the fields with the
        values the container actually settled on.
        """

        self._logger.info("Creating new session", **self._log_context)

        await self._broadcast_progress("Creating container")
        container = await self._containers.create()

        await self._broadcast_progress("Waiting for container")
        await self._wait_for_health(container.id)

        # Tell container to start a new session and use its authoritative session ID
        await self._broadcast_progress("Starting session")
        async with httpx.AsyncClient(
            timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
        ) as client:
            response = await client.post(f"{container.base_url}/api/sessions/new")
            session_id = response.json()["session_id"]

        # Register session_id on the container so find_by_session() can locate it
        # before the health monitor's next poll cycle
        await self._containers.update(container, session_id=session_id)

        await self._broadcast_sessions_changed()

        # Synthesize the SessionInfo from known sources + defaults. session.json
        # may not yet exist on disk (the container's pipeline writes it as
        # events flow), so we don't read from repo here.
        workspace = Workspace(self._workspace.path)
        new_session_dir = workspace.ensure_session(session_id).path
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
            model=ClaudeRuntime.DEFAULT_MODEL,
            permission_mode=ClaudeRuntime.DEFAULT_PERMISSION_MODE,
            effort_level=ClaudeRuntime.DEFAULT_EFFORT_LEVEL,
        )

    async def resume(self, session_id: str) -> SessionInfo:
        """Resume an existing session: reuse running container or spawn new one.

        Returns a fully-populated SessionInfo so the frontend footer renders without
        waiting for the projection refresh that follows.
        """

        self._logger.info("Resuming session", session_id=session_id, **self._log_context)

        # Check for existing container serving this session
        existing = await self._containers.find_by_session(session_id, sync=True)
        if existing:
            return await self._build_session_info(session_id, existing.id)

        # Spawn new container
        await self._broadcast_progress("Creating container", session_id=session_id)
        container = await self._containers.create(session_id=session_id)

        await self._broadcast_progress("Waiting for container", session_id=session_id)
        await self._wait_for_health(container.id)

        # Tell container to resume the session
        await self._broadcast_progress("Resuming session", session_id=session_id)
        async with httpx.AsyncClient(
            timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
        ) as client:
            await client.post(f"{container.base_url}/api/sessions/{session_id}/resume")

        await self._broadcast_sessions_changed()
        return await self._build_session_info(session_id, container.id)

    async def _build_session_info(self, session_id: str, container_id: str) -> SessionInfo:
        """Build a SessionInfo for resume() from on-disk metadata.

        Falls back to a synthesized minimal record (with default model, permission
        mode, and effort level) when session.json is missing.
        """

        try:
            metadata = self._repo.get(session_id)
        except SharedSessionNotFound:
            return self._synthesize_session_info(session_id, container_id)

        workspace = Workspace(self._workspace.path)
        data = metadata.asdict()
        data["container_id"] = container_id
        data.setdefault("workspace", str(workspace.path))
        data.setdefault("effort_level", ClaudeRuntime.DEFAULT_EFFORT_LEVEL)
        data.setdefault("model", ClaudeRuntime.DEFAULT_MODEL)
        data.setdefault("permission_mode", ClaudeRuntime.DEFAULT_PERMISSION_MODE)
        return SessionInfo.fromdict(data)

    def _synthesize_session_info(
        self,
        session_id: str,
        container_id: str,
        *,
        started_at=None,
    ) -> SessionInfo:
        """Synthesize a SessionInfo from defaults when session.json is missing.

        Used for containers that have spawned but haven't yet written session.json
        (list_all merge path) and for resume() when on-disk metadata is absent.
        """

        workspace = Workspace(self._workspace.path)
        data: dict = {
            "session_id": session_id,
            "container_id": container_id,
            "workspace": str(workspace.path),
            "model": ClaudeRuntime.DEFAULT_MODEL,
            "permission_mode": ClaudeRuntime.DEFAULT_PERMISSION_MODE,
            "effort_level": ClaudeRuntime.DEFAULT_EFFORT_LEVEL,
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

        When turn_id is None, forks the complete session without truncation.
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

        # Copy SDK files (blocking I/O offloaded to thread pool)
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

        # Copy claudebox files
        await loop.run_in_executor(
            None,
            self._copy_claudebox_session,
            workspace,
            source_session_id,
            new_session_id,
        )

        # Seed session.json with parent link so the container Projection picks it up.
        new_session = workspace.ensure_session(new_session_id)

        # Read parent's session.json directly to inherit all parent settings
        # (permission mode, effort, prompt, name, model, display state) —
        # _copy_claudebox_session excludes session.json from the new directory.
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

        now = datetime.now(timezone.utc).isoformat()
        seed: dict = {
            **parent_data,
            "session_id": new_session_id,
            "parent_session_id": source_session_id,
            "session_dir": str(new_session.path),
            "workspace": str(workspace.path),
            "started_at": now,
            "updated_at": now,
        }

        write_json(new_session.path / SESSION_METADATA_FILE, seed)

        # Truncate at turn boundary only when forking from a specific turn
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

        if reuse_container:
            # Reuse the source session's existing container
            container = await self._containers.find_by_session(source_session_id)
            if not container:
                raise ValueError(f"No running container for source session {source_session_id}")
            # Transfer container ownership to the child: without it, find_by_session()
            # still resolves the parent, so stopping the parent kills the active child.
            await self._containers.update(container, session_id=new_session_id)
        else:
            # Spawn a fresh container for the forked session
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
        # Return the full SessionInfo so callers can act on the new session
        # without waiting for the SSE-debounced refresh round-trip.
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

    @classmethod
    def _truncate_sdk_transcript(cls, workspace: Workspace, session_id: str, turn_id: str) -> None:
        """Truncate SDK transcript, keeping lines before user message with matching turn_id."""

        path = workspace.sdk_project_dir / f"{session_id}.jsonl"
        if not path.exists():
            return
        lines = path.read_text().splitlines(keepends=True)

        kept = []
        for line in lines:
            data = json.loads(line)
            if data.get("type") == "user" and data.get("uuid") == turn_id:
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

    @classmethod
    def _truncate_events(cls, workspace: Workspace, session_id: str, turn_id: str) -> None:
        """Truncate events.jsonl, keeping lines before first occurrence of turn_id."""

        path = workspace.ensure_session(session_id).path / "events.jsonl"
        lines = path.read_text().splitlines(keepends=True)

        kept = []
        for line in lines:
            data = json.loads(line)
            if data.get("turn_id") == turn_id:
                break
            kept.append(line)

        path.write_text("".join(kept))

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
