"""Session lifecycle orchestration - list, create, resume, fork from workspace disk."""

import asyncio
import json
import shutil
import sqlite3
import uuid
from datetime import UTC, datetime
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
from claudebox.constants import (
    SESSION_ATTACHMENTS_DIR,
    SESSION_CHECKPOINT_TURNS_FILE,
    SESSION_EVENTS_FILE,
    SESSION_METADATA_FILE,
)
from .errors import SessionContainerUnavailable, SessionNotFound
from .models import SessionInfo, SessionProgressEvent, SessionsChangedEvent
from ..errors import ListingTimeout, ValidationError
from ..executors import Admission, ObservedPool, tracked
from ...constants import (
    CONTAINER_HEALTH_STARTUP_INTERVAL,
    CONTAINER_HEALTH_STARTUP_MAX_RETRIES,
    CONTAINER_HEALTH_STARTUP_TIMEOUT,
    CONTAINER_SESSION_REQUEST_TIMEOUT,
    DISK_LISTING_TIMEOUT,
)


if TYPE_CHECKING:
    from ..containers import Container, ContainerService
    from ..workspaces import RegisteredWorkspace


# Fields a fork inherits verbatim from its parent. Counters/snapshots instead derive from the
# child's events.jsonl, since a truncated child's events differ from the parent's transcript.
INHERITED_CONFIG_FIELDS = frozenset(
    {
        "name",
        "model",
        "runtime",
        "provider",
        "permission_mode",
        "effort_level",
        "session_prompt",
        "first_message",
        "context_window",
        "commands",
    },
)


def _resolve_container_id(container: "Container", session_id: str) -> str | None:
    """Container id for `session_id` if it is genuinely running there, else None.

    Liveness for a member is the health-reported live set - `members` keeps stopped threads forever.
    """

    if container.session_id == session_id or session_id in container.live_session_ids:
        return container.id

    return None


async def deliver_prompt(
    logger,
    containers: "ContainerService",
    container_id: str,
    prompt: str,
    *,
    session_id: str | None = None,
) -> None:
    """Inject one prompt as a session's next turn; a failed delivery is logged, not raised."""

    try:
        await containers.send(
            container_id=container_id,
            method="POST",
            endpoint="api/send",
            payload={"prompt": prompt},
        )
    except Exception:  # noqa: BLE001 - best-effort; must not fail the caller's larger operation
        logger.warning(
            "Failed to send prompt message",
            prompt=prompt,
            container_id=container_id,
            session_id=session_id,
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
        # Serializes concurrent forks off the same source - a shared-container fork's
        # find_by_session() -> update(members=...) sequence must not interleave with a sibling's.
        self._fork_locks: dict[str, asyncio.Lock] = {}

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
            data["container_id"] = (
                _resolve_container_id(container, metadata.session_id) if container else None
            )
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
        """Submit the repo scan, recording when a worker picks it up.

        Logs from the wrapper itself, against a locally-captured admission - reading
        self._admission after the fact would race a concurrent caller's later flight.
        """

        loop = asyncio.get_running_loop()
        scan, self._admission = tracked(self._repo.list_all)
        admission = self._admission

        def _scan_and_log():
            result = scan()
            self._logger.info(
                "session_listing_scanned",
                queued_seconds=round(admission.queued_seconds, 3),
                scan_seconds=round(admission.running_seconds, 3),
                pool=self._executor.stats().asdict(),
                **self._log_context,
            )

            return result

        return loop.run_in_executor(self._executor, _scan_and_log)

    def log_listing_completed(
        self,
        *,
        session_count: int,
        response_bytes: int,
        total_seconds: float,
    ) -> None:
        """Log a successful listing's end-to-end cost - the success-path twin of the timeout warning."""

        self._logger.info(
            "session_listing_completed",
            session_count=session_count,
            response_bytes=response_bytes,
            total_seconds=round(total_seconds, 3),
            **self._log_context,
        )

    async def get(self, session_id: str) -> SessionInfo:
        """Read session metadata from disk; raises SessionNotFound if missing."""

        try:
            metadata = self._repo.get(session_id)
        except SharedSessionNotFound as exc:
            raise SessionNotFound(session_id=exc.session_id) from exc

        container = await self._containers.find_by_session(session_id)

        data = metadata.asdict()
        data["container_id"] = _resolve_container_id(container, session_id) if container else None

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
        now = datetime.now(UTC)

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

    async def create_with_prompt(
        self,
        prompt: str,
        *,
        spawned_from_session_id: str | None = None,
    ) -> SessionInfo:
        """Create a session and inject one prompt as its first turn."""

        return await self.create_with_prompts(
            [prompt],
            spawned_from_session_id=spawned_from_session_id,
        )

    async def create_with_prompts(
        self,
        prompts: list[str],
        *,
        spawned_from_session_id: str | None = None,
    ) -> SessionInfo:
        """Create a session and inject each prompt as a turn, in order.

        `spawned_from_session_id` is the caller's claimed lineage: unverified, read by no check.
        """

        result = await self.create()
        # create() always synthesizes container_id from the container it just spawned; the
        # field is Optional only because other SessionInfo call paths (list/get) can lack one.
        assert result.container_id is not None

        if spawned_from_session_id:
            self._record_spawn_lineage(result.session_id, spawned_from_session_id)
            result.spawned_from_session_id = spawned_from_session_id

        for prompt in prompts:
            await deliver_prompt(
                self._logger,
                self._containers,
                result.container_id,
                prompt,
                session_id=result.session_id,
            )

        return result

    def _record_spawn_lineage(self, session_id: str, spawned_from_session_id: str) -> None:
        """Merge the claimed spawner id onto the child's session.json.

        Written directly: no record exists to `update()` yet, and `_DAEMON_OWNED_FIELDS` keeps it.
        """

        workspace = Workspace(self._workspace.path)
        path = workspace.ensure_session(session_id).path / SESSION_METADATA_FILE
        data = read_json(path, default={}) or {}
        data["spawned_from_session_id"] = spawned_from_session_id
        write_json(path, data)

    def compute_spawn_depth(self, session_id: str) -> int | None:
        """Walk spawn ancestry from `session_id`, counting only spawn hops (fork hops are free).

        An unreadable own record returns None (fail closed); a missing ancestor just ends the walk.
        """

        try:
            current = self._repo.get(session_id)
        except SharedSessionNotFound:
            return None

        depth = 0
        seen = {session_id}

        while True:
            next_id = current.spawned_from_session_id or current.parent_session_id

            if not next_id or next_id in seen:
                return depth

            if current.spawned_from_session_id:
                depth += 1

            seen.add(next_id)

            try:
                current = self._repo.get(next_id)
            except SharedSessionNotFound:
                return depth

    async def resume(self, session_id: str) -> SessionInfo:
        """Resume an existing session: reuse running container or spawn new one.

        Returns a full SessionInfo so the footer renders without waiting for the projection refresh.
        """

        self._logger.info("Resuming session", session_id=session_id, **self._log_context)

        try:
            metadata = self._repo.get(session_id)
        except SharedSessionNotFound as exc:
            raise SessionNotFound(session_id=exc.session_id) from exc

        if metadata.is_side_thread:
            return await self._resume_side_thread(session_id, metadata)

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

    async def _resume_side_thread(self, session_id: str, metadata) -> SessionInfo:
        """Start a side thread's session in its parent's container, joining as a member.

        Never restarts the parent nor spawns its own; a parent with no container is a hard failure.
        """

        parent_id = metadata.parent_session_id
        container = (
            await self._containers.find_by_session(parent_id, sync=True) if parent_id else None
        )

        if not container:
            raise SessionContainerUnavailable(session_id=session_id, parent_session_id=parent_id)

        if session_id not in container.members:
            await self._containers.update(container, members=[*container.members, session_id])

        await self._broadcast_progress("Resuming session", session_id=session_id)

        async with httpx.AsyncClient(
            timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
        ) as client:
            await client.post(
                f"{container.base_url}/api/sessions/{session_id}/resume",
                params={"primary": "false"},
            )

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
        share_container: bool = False,
        parent_session_id: str | None = None,
    ) -> SessionInfo:
        """Fork session: copy files, optionally truncate at turn, spawn/reuse/share a container.

        `parent_session_id` re-parents the child onto a drawable ancestor - what promotion needs.
        """

        if reuse_container and share_container:
            raise ValidationError(
                "fork_disposition_conflict",
                detail="reuse_container and share_container are mutually exclusive",
            )

        new_session_id = str(uuid.uuid4())
        self._logger.info(
            "Forking session",
            source_id=source_session_id,
            turn_id=turn_id,
            new_id=new_session_id,
            reuse_container=reuse_container,
            share_container=share_container,
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
                share_container,
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
                await loop.run_in_executor(
                    None,
                    self._truncate_langgraph_checkpoint,
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

            now = datetime.now(UTC).isoformat()
            seed: dict = {
                **inherited,
                **derived,
                "session_id": new_session_id,
                "parent_session_id": parent_session_id or source_session_id,
                "session_dir": str(new_session.path),
                "workspace": str(workspace.path),
                "started_at": now,
                "updated_at": now,
                "fork_point_cost_usd": derived["total_cost_usd"],
                "is_side_thread": share_container,
            }

            write_json(new_session.path / SESSION_METADATA_FILE, seed)
        # fork() is awaited unshielded from the request handler, so a client disconnect
        # mid-copy (CancelledError, a BaseException) is likelier here than a real error.
        except (Exception, asyncio.CancelledError):
            self._discard_fork_artifacts(workspace, new_session_id)

            raise

        async with self._fork_lock(source_session_id):
            if reuse_container:
                container = await self._containers.find_by_session(source_session_id)

                if not container:
                    raise SessionContainerUnavailable(session_id=source_session_id)

                # Without this, find_by_session() still resolves the parent, so stopping it
                # would kill the active child.
                await self._containers.update(container, session_id=new_session_id)
                primary = True
            elif share_container:
                container = await self._containers.find_by_session(source_session_id)

                if not container:
                    raise SessionContainerUnavailable(session_id=source_session_id)

                # Build a fresh list, never append in place - update() compares old vs new by
                # value, so an in-place-mutated list looks unchanged and silently never persists.
                await self._containers.update(
                    container,
                    members=[*container.members, new_session_id],
                )
                primary = False
            else:
                await self._broadcast_progress("Creating container", session_id=new_session_id)
                container = await self._containers.create(session_id=new_session_id)

                await self._broadcast_progress("Waiting for container", session_id=new_session_id)
                await self._wait_for_health(container.id)
                primary = True

            await self._broadcast_progress("Resuming session", session_id=new_session_id)

            async with httpx.AsyncClient(
                timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
            ) as client:
                await client.post(
                    f"{container.base_url}/api/sessions/{new_session_id}/resume",
                    params={"primary": "true" if primary else "false"},
                )

        await self._broadcast_sessions_changed()

        # Return full SessionInfo so callers can act without waiting for the SSE-debounced refresh.
        return SessionInfo.fromdict({**seed, "container_id": container.id})

    def _fork_lock(self, source_session_id: str) -> asyncio.Lock:
        """Lock serializing concurrent forks off the same source session."""

        return self._fork_locks.setdefault(source_session_id, asyncio.Lock())

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
            except Exception:  # noqa: BLE001 - startup retry loop: any failure just retries
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

    def _copy_claudebox_session(
        self,
        workspace: Workspace,
        source_id: str,
        new_id: str,
        share_container: bool = False,
    ) -> None:
        """Copy claudebox session directory, excluding session.json.

        A shared-container fork also drops tmp/ and attachments/ - nothing would ever read them.
        """

        src = workspace.ensure_session(source_id).path
        dst = workspace.ensure_session(new_id).path
        excluded = (
            (SESSION_METADATA_FILE, "tmp", SESSION_ATTACHMENTS_DIR)
            if share_container
            else (SESSION_METADATA_FILE,)
        )

        try:
            shutil.copytree(
                src,
                dst,
                ignore=shutil.ignore_patterns(*excluded),
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
        """Re-key a copied LangGraph checkpoint onto the fork's own thread_id; else it reads empty.
        thread_id is pinned to session_id; only the key column changes - payloads never embed it.
        No-op when the file is absent; must run before `_truncate_langgraph_checkpoint`.
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

    def _truncate_langgraph_checkpoint(
        self,
        workspace: Workspace,
        session_id: str,
        turn_id: str,
    ) -> None:
        """Truncate a forked LangGraph checkpoint at the turn boundary, matching the transcript.
        `LangGraphRuntime` journals each turn's pre-turn checkpoint_id in `checkpoint_turns.json`.
        checkpoint_id is UUID6 - creation-time sortable - so rows past the boundary are deleted.
        No-op when file, journal, or entry is absent - the whole checkpoint carries over instead.
        """

        session_path = workspace.ensure_session(session_id).path
        checkpoint_path = session_path / "checkpoints.sqlite"

        if not checkpoint_path.exists():
            return

        journal = read_json(session_path / SESSION_CHECKPOINT_TURNS_FILE, default=None)

        if not isinstance(journal, dict) or turn_id not in journal:
            return

        boundary_checkpoint_id = journal[turn_id]

        conn = sqlite3.connect(checkpoint_path)

        try:
            if boundary_checkpoint_id is None:
                # The turn being forked away from is the thread's first - nothing precedes it.
                conn.execute("DELETE FROM checkpoints WHERE thread_id = ?", (session_id,))
                conn.execute("DELETE FROM writes WHERE thread_id = ?", (session_id,))
            else:
                conn.execute(
                    "DELETE FROM checkpoints WHERE thread_id = ? AND checkpoint_id > ?",
                    (session_id, boundary_checkpoint_id),
                )
                conn.execute(
                    "DELETE FROM writes WHERE thread_id = ? AND checkpoint_id > ?",
                    (session_id, boundary_checkpoint_id),
                )

            conn.commit()
        finally:
            conn.close()

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
