"""Session lifecycle orchestration - list, create, resume, fork from workspace disk."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sqlite3
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from claudebox import (
    Broadcaster,
    Config,
    InvalidSessionId,
    KeyedSingleFlight,
    SessionMetadata,
    SessionRepository,
    SingleFlight,
    Workspace,
    append_json,
    cost_added,
    find_sdk_transcript,
    find_session_dir,
    get_logger,
    read_json,
    resolve_runtime_class,
    serialization,
    validate_session_id,
    write_json,
)
from claudebox import SessionNotFound as SharedSessionNotFound
from claudebox.constants import (
    SESSION_ATTACHMENTS_DIR,
    SESSION_CHECKPOINT_TURNS_FILE,
    SESSION_EVENTS_FILE,
    SESSION_METADATA_FILE,
    SIBLING_MESSAGES_PENDING_FILE,
)
from .errors import (
    SessionContainerCreateFailed,
    SessionContainerInvalidId,
    SessionContainerResumeFailed,
    SessionContainerUnavailable,
    SessionNotFound,
    SessionNotSpawned,
    SessionTranscriptMissing,
    SiblingNotOwned,
    SiblingStopHostsThread,
    SpawnerUnreachable,
)
from .models import (
    RenderedListing,
    SessionInfo,
    SessionProgressEvent,
    SessionsChangedEvent,
    SiblingSummary,
)
from .schedules import CRON_CREATE, ScheduleIndex
from ..errors import ListingTimeout, ValidationError
from ..executors import Admission, ObservedPool, tracked
from ...constants import (
    CONTAINER_HEALTH_STARTUP_INTERVAL,
    CONTAINER_HEALTH_STARTUP_MAX_RETRIES,
    CONTAINER_HEALTH_STARTUP_TIMEOUT,
    CONTAINER_SESSION_REQUEST_TIMEOUT,
    CONTAINER_STARTUP_BUDGET,
    DISK_LISTING_TIMEOUT,
    LISTING_PREVIEW_CHARS,
)


if TYPE_CHECKING:
    from ..containers import Container, ContainerService
    from ..workspaces import RegisteredWorkspace


# Fields a fork inherits verbatim from its parent. Counters/snapshots instead derive from the
# child's events.jsonl, since a truncated child's events differ from the parent's transcript.
INHERITED_CONFIG_FIELDS = frozenset(
    {
        "name",
        "auto_name",
        "model",
        "runtime",
        "provider",
        "permission_mode",
        "effort_level",
        "session_prompt",
        "first_message",
        "bundle",
        "context_window",
        "commands",
    },
)


# Bundle keys a new session starts from, in the order the welcome screen's pickers drain.
SEEDED_BUNDLE_KEYS = ("model", "permission_mode", "effort_level", "session_prompt")

_SEED_ROUTES = {
    "model": "api/model",
    "permission_mode": "api/permission-mode",
    "effort_level": "api/effort-level",
}

# A stored slash command; a preview cuts only inside its arguments, so the command still parses.
_COMMAND_ARGS = re.compile(
    r"<command-name>[^<]+</command-name>\s*<command-args>([\s\S]*?)</command-args>",
)


def _resolve_container_id(container: Container, session_id: str) -> str | None:
    """Container id for `session_id` if it is genuinely running there, else None.

    Liveness for a member is the health-reported live set - `members` keeps stopped threads forever.
    """

    if container.session_id == session_id or session_id in container.live_session_ids:
        return container.id

    return None


async def deliver_prompt(
    logger,
    containers: ContainerService,
    container_id: str,
    prompt: str,
    *,
    session_id: str | None = None,
) -> bool:
    """Inject one prompt as a session's next turn; a failed delivery is logged and reported, never
    raised, so the larger operation that requested it (creation, assignment) never fails on it.
    """

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

        return False

    return True


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
        workspace: RegisteredWorkspace,
        containers: ContainerService,
        events: Broadcaster,
        agent: str,
        executor: ObservedPool,
        projects_root: Path | None = None,
    ) -> None:
        self._logger = get_logger(__name__)

        self._workspace = workspace
        self._repo = SessionRepository(Workspace(workspace.path))
        # The runtime's transcript folder: the workspace-backed mount, or the host's own (local).
        self._projects_root = projects_root or Workspace(workspace.path).sdk_projects_root
        self._containers = containers
        self._events = events
        # resolve_runtime_class(agent) drives synthesis defaults so Claude constants don't
        # leak into LangGraph workspaces.
        self._agent = agent
        # Daemon-owned executor so list_all()'s disk walk doesn't block the event loop.
        self._executor = executor
        self._listing_flight = SingleFlight()
        self._admission = Admission()
        self._schedule_flight = SingleFlight()
        self._schedule_admission = Admission()
        self._schedule_index = ScheduleIndex()
        self._warmup: asyncio.Task | None = None
        self._resume_flight = KeyedSingleFlight()
        # Resume, a side thread's resume and fork's container phase serialize per session id.
        self._session_locks: dict[str, asyncio.Lock] = {}
        # Siblings their spawner is stopping right now; a turn the stop cuts short is not reported.
        self._stopped_by_spawner: set[str] = set()

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Start session service, warming the listing's record cache in the background."""

        self._logger.debug("Starting session service...", **self._log_context)

        self._warmup = asyncio.create_task(self._warm_listing())

        self._logger.info("Session service started", **self._log_context)

    async def stop(self) -> None:
        """Stop session service, cancelling a warm-up still in flight."""

        self._logger.debug("Stopping session service...", **self._log_context)

        if self._warmup:
            self._warmup.cancel()

            try:
                await self._warmup
            except asyncio.CancelledError:
                pass
            finally:
                self._warmup = None

        self._logger.info("Session service stopped", **self._log_context)

    # Session Management
    # ----------------------------------------------------------------------------------------------

    async def list_all(self) -> RenderedListing:
        """List all sessions from workspace disk, plus running containers without session.json.

        One executor job scans, builds and renders under DISK_LISTING_TIMEOUT; concurrent callers share its body.
        """

        try:
            return await asyncio.wait_for(
                self._listing_flight.run(self._dispatch_listing),
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

    def _dispatch_listing(self):
        """Submit the scan-build-render job, recording when a worker picks it up.

        Logs against a locally-captured admission: self._admission may already be a later flight's.
        """

        loop = asyncio.get_running_loop()
        containers = _ContainerSnapshot.take(self._containers.list_all())
        scan, self._admission = tracked(self._repo.list_all)
        admission = self._admission

        def _scan_and_render() -> RenderedListing:
            metadata_list = scan()
            self._logger.info(
                "session_listing_scanned",
                queued_seconds=round(admission.queued_seconds, 3),
                scan_seconds=round(admission.running_seconds, 3),
                pool=self._executor.stats().asdict(),
                **self._log_context,
            )

            return self._render_listing(metadata_list, containers)

        return loop.run_in_executor(self._executor, _scan_and_render)

    def _render_listing(
        self,
        metadata_list: list[SessionMetadata],
        containers: _ContainerSnapshot,
    ) -> RenderedListing:
        sessions = []
        seen_session_ids = set()

        for metadata in metadata_list:
            data = metadata.asdict()
            data["container_id"] = containers.container_ids.get(metadata.session_id)
            data["first_message"], data["last_message"] = _previews(
                data["first_message"],
                data["last_message"],
            )
            sessions.append(SessionInfo.fromdict(data))
            seen_session_ids.add(metadata.session_id)

        for session_id, container_id, created_at in containers.serving:
            if session_id not in seen_session_ids:
                sessions.append(
                    self._synthesize_session_info(session_id, container_id, started_at=created_at),
                )

        body = serialization.dumps({"sessions": sessions}).encode("utf-8")

        return RenderedListing(body=body, session_count=len(sessions), sessions=tuple(sessions))

    async def _warm_listing(self) -> None:
        try:
            await self.list_all()
        except Exception:
            self._logger.exception("session_listing_warmup_failed", **self._log_context)

    async def list_schedules(self) -> RenderedListing:
        """List the schedule events of every running session whose log holds a schedule create.

        One executor job reads each log from where the last one stopped, under DISK_LISTING_TIMEOUT.
        """

        try:
            return await asyncio.wait_for(
                self._schedule_flight.run(self._dispatch_schedules),
                timeout=DISK_LISTING_TIMEOUT.total_seconds(),
            )
        except TimeoutError as exc:
            self._logger.warning(
                "schedule_listing_timed_out",
                timeout=DISK_LISTING_TIMEOUT.total_seconds(),
                scan_started=self._schedule_admission.started,
                queued_seconds=round(self._schedule_admission.queued_seconds, 3),
                pool=self._executor.stats().asdict(),
                **self._log_context,
            )

            raise ListingTimeout(workspace=str(self._workspace.path)) from exc

    def _dispatch_schedules(self):
        loop = asyncio.get_running_loop()
        containers = _ContainerSnapshot.take(self._containers.list_all())
        running = [sid for sid, container_id in containers.container_ids.items() if container_id]
        scan, self._schedule_admission = tracked(lambda: self._read_schedules(running))
        admission = self._schedule_admission

        def _scan_and_render() -> RenderedListing:
            listing = scan()
            self._logger.info(
                "schedule_listing_scanned",
                queued_seconds=round(admission.queued_seconds, 3),
                scan_seconds=round(admission.running_seconds, 3),
                bytes_read=self._schedule_index.bytes_read,
                pool=self._executor.stats().asdict(),
                **self._log_context,
            )

            return listing

        return loop.run_in_executor(self._executor, _scan_and_render)

    def _read_schedules(self, session_ids: list[str]) -> RenderedListing:
        self._schedule_index.bytes_read = 0
        sessions = []
        logs = []

        for session_id in session_ids:
            session_dir = find_session_dir(self._workspace.path, session_id)

            if session_dir is None:
                continue

            path = session_dir / SESSION_EVENTS_FILE
            logs.append(path)
            log = self._schedule_index.read(path)

            if any(event.get("content") == CRON_CREATE for event in log.events):
                sessions.append(
                    {
                        "session_id": session_id,
                        "responding_since": log.responding_since,
                        "events": log.events,
                    },
                )

        self._schedule_index.retain(logs)
        body = serialization.dumps({"sessions": sessions}).encode("utf-8")

        return RenderedListing(body=body, session_count=len(sessions))

    def log_listing_completed(
        self,
        *,
        session_count: int,
        response_bytes: int,
        total_seconds: float,
        kind: str = "session",
    ) -> None:
        """Log a successful listing's end-to-end cost - the success-path twin of the timeout warning."""

        self._logger.info(
            f"{kind}_listing_completed",
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
        except InvalidSessionId as exc:
            raise ValidationError("invalid_session_id", session_id=exc.session_id) from exc

        container = await self._containers.find_by_session(session_id)

        data = metadata.asdict()
        data["container_id"] = _resolve_container_id(container, session_id) if container else None

        return SessionInfo.fromdict(data)

    async def update(self, session_id: str, **fields) -> SessionInfo:
        """Update session metadata fields on disk."""

        try:
            self._repo.update(session_id, **fields)
        except SharedSessionNotFound as exc:
            # A new session's record appears with its first message; an earlier rename writes it.
            if Workspace(self._workspace.path).find_session(session_id) is None:
                raise SessionNotFound(session_id=exc.session_id) from exc

            self._record_daemon_fields(session_id, **fields)
        except InvalidSessionId as exc:
            raise ValidationError("invalid_session_id", session_id=exc.session_id) from exc

        result = await self.get(session_id)
        await self._broadcast_sessions_changed()

        return result

    async def create(
        self,
        bundle: str | None = None,
        *,
        spawned_from_session_id: str | None = None,
        name: str | None = None,
        model: str | None = None,
        effort_level: str | None = None,
    ) -> SessionInfo:
        """Create a new session: spawn container, wait for health, initialize session.

        Returns a fully-populated SessionInfo so the frontend footer renders immediately; the
        SDK init event later refreshes fields with the container's settled values.
        """

        self._logger.info("Creating new session", bundle=bundle, **self._log_context)

        await self._broadcast_progress("Creating container")
        container = await self._containers.create(bundle=bundle)

        try:
            await self._broadcast_progress("Waiting for container")
            await self._wait_for_health(container.id)

            # Container mints the session ID; treat its response as authoritative.
            await self._broadcast_progress("Starting session")

            async with httpx.AsyncClient(
                timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
            ) as client:
                response = await client.post(f"{container.base_url}/api/sessions/new")

                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError as exc:
                    raise SessionContainerCreateFailed(
                        container_id=container.id,
                        status=str(response.status_code),
                    ) from exc

                session_id = response.json()["session_id"]

            try:
                validate_session_id(session_id)
            except InvalidSessionId as exc:
                raise SessionContainerInvalidId(container_id=container.id) from exc

            # Register session_id now so find_by_session() locates it before the next health poll.
            await self._containers.update(container, session_id=session_id)

            recorded = {
                key: value
                for key, value in (
                    ("bundle", bundle),
                    ("spawned_from_session_id", spawned_from_session_id),
                    ("name", name),
                )
                if value
            }

            if recorded:
                self._record_daemon_fields(session_id, **recorded)
        except (Exception, asyncio.CancelledError):
            await asyncio.shield(self._cleanup_spawned_container(container.id))

            raise
        finally:
            self._containers.release_spawn(container.id)

        await self._broadcast_sessions_changed()

        # Synthesize from known sources + defaults rather than reading the repo: the container's
        # pipeline writes session.json as events flow, so it may not exist yet.
        workspace = Workspace(self._workspace.path)
        new_session_dir = workspace.ensure_session(session_id).path
        cls = resolve_runtime_class(self._agent)
        now = datetime.now(UTC)
        seeded, failed_seeds = await self._seed_starting_values(
            container.id,
            session_id,
            bundle,
            model=model,
            effort_level=effort_level,
        )

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
            model=seeded.get("model", cls.get_default_model()),
            permission_mode=seeded.get("permission_mode", cls.get_default_permission_mode()),
            effort_level=seeded.get("effort_level", cls.get_default_effort_level()),
            bundle=bundle,
            name=name,
            spawned_from_session_id=spawned_from_session_id,
            failed_seeds=failed_seeds,
        )

    async def create_with_prompt(
        self,
        prompt: str,
        *,
        spawned_from_session_id: str | None = None,
        bundle: str | None = None,
        name: str | None = None,
        model: str | None = None,
        effort_level: str | None = None,
    ) -> SessionInfo:
        """Create a session and inject one prompt as its first turn."""

        return await self.create_with_prompts(
            [prompt],
            spawned_from_session_id=spawned_from_session_id,
            bundle=bundle,
            name=name,
            model=model,
            effort_level=effort_level,
        )

    async def create_with_prompts(
        self,
        prompts: list[str],
        *,
        spawned_from_session_id: str | None = None,
        bundle: str | None = None,
        name: str | None = None,
        model: str | None = None,
        effort_level: str | None = None,
    ) -> SessionInfo:
        """Create a session and inject each prompt as a turn. `spawned_from_session_id` must be a
        resolved caller (walked by compute_spawn_depth); the result's failed_prompts names any that failed.
        """

        result = await self.create(
            bundle=bundle,
            spawned_from_session_id=spawned_from_session_id,
            name=name,
            model=model,
            effort_level=effort_level,
        )
        # create() always synthesizes container_id from the container it just spawned; the
        # field is Optional only because other SessionInfo call paths (list/get) can lack one.
        assert result.container_id is not None

        failed = []

        for prompt in prompts:
            delivered = await deliver_prompt(
                self._logger,
                self._containers,
                result.container_id,
                prompt,
                session_id=result.session_id,
            )

            if not delivered:
                failed.append(prompt)

        result.failed_prompts = failed or None

        return result

    def _record_daemon_fields(self, session_id: str, **fields: str) -> None:
        """Merge daemon-owned fields onto a new session's session.json.

        Written directly: no record exists to `update()` yet, and `_DAEMON_OWNED_FIELDS` keeps it.
        """

        workspace = Workspace(self._workspace.path)
        path = workspace.ensure_session(session_id).path / SESSION_METADATA_FILE
        data = read_json(path, default={}) or {}
        data.update(fields)
        write_json(path, data)

    def compute_spawn_depth(self, session_id: str) -> int | None:
        """Walk spawn ancestry from `session_id`, counting only spawn hops (fork hops are free).

        An unreadable own record returns None (fail closed); a missing ancestor just ends the walk.
        """

        try:
            current = self._repo.get(session_id)
        except (SharedSessionNotFound, InvalidSessionId):
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
            except (SharedSessionNotFound, InvalidSessionId):
                return depth

    async def resume_spawned(self, caller: str, session_id: str) -> tuple[SessionInfo, bool]:
        """Resume a session `caller` spawned, adopting a running one; whether a container started."""

        self._require_spawned_by(caller, session_id)
        existing = await self._containers.find_by_session(session_id)
        info = await self.resume(session_id)

        return info, existing is None or existing.id != info.container_id

    async def list_spawned(self, caller: str) -> list[SiblingSummary]:
        """Every session `caller` spawned, oldest first, as working, idle or stopped."""

        listing = await self.list_all()
        statuses = {container.id: container.status for container in self._containers.list_all()}
        siblings = sorted(
            (info for info in listing.sessions if info.spawned_from_session_id == caller),
            key=lambda info: info.started_at or datetime.min.replace(tzinfo=UTC),
        )

        return [
            SiblingSummary(
                session_id=info.session_id,
                name=info.name or info.auto_name,
                state=_sibling_state(info, statuses),
            )
            for info in siblings
        ]

    async def stop_spawned(self, caller: str, session_id: str) -> None:
        """Stop a session `caller` spawned and every session below it, deepest first.

        Refused before anything stops while a live reply thread shares a container in that tree.
        """

        self._require_spawned_by(caller, session_id)
        listing = await self.list_all()
        tree = _spawn_tree(session_id, listing.sessions)

        for member in tree:
            container = await self._containers.find_by_session(member)

            if container is None or container.session_id != member:
                continue

            if threads := set(container.members) & set(container.live_session_ids):
                raise SiblingStopHostsThread(session_id=min(threads))

        for member in reversed(tree):
            async with self._session_lock(member):
                container = await self._containers.find_by_session(member)

                if container is None or container.session_id != member:
                    continue

                self._stopped_by_spawner.add(member)

                try:
                    await self._containers.stop_container(container.id)
                    await self._containers.remove(container.id)
                finally:
                    self._stopped_by_spawner.discard(member)

        await self._broadcast_sessions_changed()

    async def deliver_turn_end(
        self,
        caller: str,
        *,
        delivery_id: str,
        outcome: str,
        text: str,
    ) -> str:
        """Hand a spawned session's turn end to its spawner, or hold it while the spawner is stopped.

        Answers "delivered", "held", or "dropped" for a turn the spawner's own stop cut short.
        """

        try:
            sender = self._repo.get(caller)
        except (SharedSessionNotFound, InvalidSessionId) as exc:
            raise SessionNotSpawned(session_id=caller) from exc

        parent_id = sender.spawned_from_session_id

        if not parent_id:
            raise SessionNotSpawned(session_id=caller)

        if caller in self._stopped_by_spawner:
            return "dropped"

        payload = {
            "from_session_id": caller,
            "from_name": sender.name or sender.auto_name,
            "delivery_id": delivery_id,
            "outcome": outcome,
            "text": text,
        }

        try:
            parent = await self.get(parent_id)
        except SessionNotFound as exc:
            raise SpawnerUnreachable(session_id=parent_id) from exc

        if not parent.container_id:
            held = Workspace(self._workspace.path).ensure_session(parent_id).path
            append_json(held / SIBLING_MESSAGES_PENDING_FILE, payload)

            return "held"

        try:
            await self._containers.send(
                payload=payload,
                container_id=parent.container_id,
                endpoint=f"api/sibling-message?session_id={parent_id}",
                method="POST",
            )
        except Exception as exc:
            raise SpawnerUnreachable(session_id=parent_id) from exc

        return "delivered"

    def _require_spawned_by(self, caller: str, session_id: str) -> SessionMetadata:
        """Read `session_id`'s record; an unknown, malformed or foreign id reads the same: refused."""

        try:
            metadata = self._repo.get(session_id)
        except (SharedSessionNotFound, InvalidSessionId) as exc:
            raise SiblingNotOwned(session_id=session_id) from exc

        if metadata.spawned_from_session_id != caller:
            raise SiblingNotOwned(session_id=session_id)

        return metadata

    async def resume(self, session_id: str) -> SessionInfo:
        """Resume a session: reuse a container once it confirms the session, or spawn one.

        Returns a full SessionInfo so the footer renders without waiting for the projection refresh.
        """

        self._logger.info("Resuming session", session_id=session_id, **self._log_context)

        try:
            metadata = self._repo.get(session_id)
        except SharedSessionNotFound as exc:
            raise SessionNotFound(session_id=exc.session_id) from exc
        except InvalidSessionId as exc:
            raise ValidationError("invalid_session_id", session_id=exc.session_id) from exc

        if metadata.is_side_thread:
            return await self._resume_side_thread(session_id, metadata)

        return await self._resume_flight.run(
            session_id,
            lambda: self._resume_primary(session_id, metadata.bundle),
        )

    async def _resume_primary(self, session_id: str, bundle: str | None) -> SessionInfo:
        async with self._session_lock(session_id):
            existing = await self._containers.find_by_session(session_id, sync=True)

            if existing and await self._adopt(existing, session_id):
                return await self._build_session_info(session_id, existing.id)

            await self._broadcast_progress("Creating container", session_id=session_id)
            container = await self._containers.create(session_id=session_id, bundle=bundle)

            try:
                await self._broadcast_progress("Waiting for container", session_id=session_id)
                await self._wait_for_health(container.id)

                await self._broadcast_progress("Resuming session", session_id=session_id)
                await self._start_session_in(container, session_id, primary=True)
            except (Exception, asyncio.CancelledError):
                await asyncio.shield(self._cleanup_spawned_container(container.id))

                raise

            await self._broadcast_sessions_changed()

            return await self._build_session_info(session_id, container.id)

    async def _resume_side_thread(self, session_id: str, metadata) -> SessionInfo:
        """Start a side thread's session in its parent's container, joining as a member.

        Never restarts the parent nor spawns its own; a parent with no container is a hard failure.
        """

        parent_id = metadata.parent_session_id

        if not parent_id:
            raise SessionContainerUnavailable(session_id=session_id, parent_session_id=parent_id)

        async with self._session_lock(parent_id):
            container = await self._containers.find_by_session(parent_id, sync=True)

            if not container:
                raise SessionContainerUnavailable(
                    session_id=session_id,
                    parent_session_id=parent_id,
                )

            if session_id not in container.members:
                await self._containers.update(container, members=[*container.members, session_id])

            await self._broadcast_progress("Resuming session", session_id=session_id)
            await self._start_session_in(container, session_id, primary=False)

        await self._broadcast_sessions_changed()

        return await self._build_session_info(session_id, container.id)

    async def _adopt(self, container: Container, session_id: str) -> bool:
        """Whether `container` runs `session_id` - asked, as a restart can strand an unstarted owner."""

        elapsed = datetime.now(UTC) - container.created_at
        report = await self._wait_for_health(
            container.id,
            budget=max(CONTAINER_STARTUP_BUDGET - elapsed, timedelta(0)),
        )
        primary = report.get("session_id")
        live = report.get("live_session_ids", [])

        if primary == session_id or session_id in live:
            return True

        if primary is None and container.session_id == session_id:
            await self._start_session_in(container, session_id, primary=True)
            await self._broadcast_sessions_changed()

            return True

        await self._containers.update(container, session_id=primary, live_session_ids=live)

        return False

    async def _start_session_in(
        self,
        container: Container,
        session_id: str,
        *,
        primary: bool,
    ) -> None:
        async with httpx.AsyncClient(
            timeout=CONTAINER_SESSION_REQUEST_TIMEOUT.total_seconds(),
        ) as client:
            response = await client.post(
                f"{container.base_url}/api/sessions/{session_id}/resume",
                params={"primary": "true" if primary else "false"},
            )

            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise SessionContainerResumeFailed(
                    container_id=container.id,
                    session_id=session_id,
                    status=str(response.status_code),
                ) from exc

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

        try:
            validate_session_id(source_session_id)
        except InvalidSessionId as exc:
            raise ValidationError("invalid_session_id", session_id=exc.session_id) from exc

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
        transcript = await loop.run_in_executor(
            None,
            find_sdk_transcript,
            self._projects_root,
            source_session_id,
        )

        if transcript is None and self._runs_claude(workspace, source_session_id):
            raise SessionTranscriptMissing(session_id=source_session_id)

        project_dir = transcript.parent if transcript else None

        # Copy-through-seed-write is one unit - a failure must not strand an event log with no
        # session.json. Startup is excluded: a failed spawn past the seed leaves the fork
        # stopped, which resume recovers.
        try:
            if project_dir is not None:
                await loop.run_in_executor(
                    None,
                    self._copy_sdk_session_dir,
                    project_dir,
                    source_session_id,
                    new_session_id,
                )
                await loop.run_in_executor(
                    None,
                    self._copy_sdk_transcript,
                    project_dir,
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
                if project_dir is not None:
                    await loop.run_in_executor(
                        None,
                        self._truncate_sdk_transcript,
                        project_dir,
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
                parent_data.get("runtime"),
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
            self._discard_fork_artifacts(workspace, project_dir, new_session_id)

            raise

        spawned_container_id: str | None = None

        # The new id too: its session.json is listable, so a resume of it may arrive mid-spawn.
        async with self._session_lock(source_session_id), self._session_lock(new_session_id):
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
                container = await self._containers.create(
                    session_id=new_session_id,
                    bundle=seed.get("bundle"),
                )
                spawned_container_id = container.id

                try:
                    await self._broadcast_progress(
                        "Waiting for container",
                        session_id=new_session_id,
                    )
                    await self._wait_for_health(container.id)
                except (Exception, asyncio.CancelledError):
                    await asyncio.shield(self._cleanup_spawned_container(container.id))

                    raise

                primary = True

            try:
                await self._broadcast_progress("Resuming session", session_id=new_session_id)
                await self._start_session_in(container, new_session_id, primary=primary)
            except (Exception, asyncio.CancelledError):
                if spawned_container_id:
                    await asyncio.shield(self._cleanup_spawned_container(spawned_container_id))

                raise

        await self._broadcast_sessions_changed()

        # Return full SessionInfo so callers can act without waiting for the SSE-debounced refresh.
        return SessionInfo.fromdict({**seed, "container_id": container.id})

    def _session_lock(self, session_id: str) -> asyncio.Lock:
        return self._session_locks.setdefault(session_id, asyncio.Lock())

    # Internal
    # ----------------------------------------------------------------------------------------------

    async def _wait_for_health(
        self,
        container_id: str,
        *,
        budget: timedelta | None = None,
    ) -> dict:
        """Poll the container's health endpoint until it answers 200, returning its report.

        A `budget` caps the wait to whatever it allows, always making at least one attempt.
        """

        from ..containers import ContainerTimeout

        container = self._containers.get(container_id)
        loop = asyncio.get_running_loop()
        deadline = None if budget is None else loop.time() + budget.total_seconds()
        interval = CONTAINER_HEALTH_STARTUP_INTERVAL.total_seconds()

        for attempt in range(CONTAINER_HEALTH_STARTUP_MAX_RETRIES):
            try:
                async with httpx.AsyncClient(
                    timeout=CONTAINER_HEALTH_STARTUP_TIMEOUT.total_seconds(),
                ) as client:
                    response = await client.get(f"{container.base_url}/api/health")
                    response.raise_for_status()

                    return response.json()
            except Exception:  # noqa: BLE001 - startup retry loop: any failure just retries
                out_of_budget = deadline is not None and loop.time() + interval > deadline

                if attempt < CONTAINER_HEALTH_STARTUP_MAX_RETRIES - 1 and not out_of_budget:
                    await asyncio.sleep(interval)
                else:
                    break

        self._logger.warning(
            "Container health check timed out",
            container={"id": container_id},
            **self._log_context,
        )

        raise ContainerTimeout(container_id=container_id)

    async def _seed_starting_values(
        self,
        container_id: str,
        session_id: str,
        bundle: str | None,
        *,
        model: str | None = None,
        effort_level: str | None = None,
    ) -> tuple[dict[str, str], list[str] | None]:
        """Seed a bundle's starting values overlaid with explicit ones; return applied and failed keys.

        The session prompt goes onto the record: its route needs the projection a first turn builds.
        A value the runtime cannot set counts as failed only when it was explicit.
        """

        declared = (
            (Config.load(self._workspace.path).bundles or {}).get(bundle, {}) if bundle else {}
        )
        explicit = {
            key: value
            for key, value in (("model", model), ("effort_level", effort_level))
            if value is not None
        }
        values = {**declared, **explicit}
        caps = resolve_runtime_class(self._agent).CAPABILITIES
        supported = {
            "model": caps.supports_set_model_mid_session,
            "permission_mode": caps.supports_set_permission_mode,
            "effort_level": caps.supports_set_effort_level,
        }
        seeded = {}
        failed = []

        for key in SEEDED_BUNDLE_KEYS:
            if key not in values:
                continue

            if not supported.get(key, True):
                if key in explicit:
                    failed.append(key)

                continue

            try:
                if key == "session_prompt":
                    self._record_daemon_fields(session_id, session_prompt=values[key])
                else:
                    await self._containers.send(
                        payload={key: values[key]},
                        container_id=container_id,
                        endpoint=f"{_SEED_ROUTES[key]}?session_id={session_id}",
                        method="POST",
                    )
            except Exception:  # noqa: BLE001 - a missed starting value must not fail the creation
                self._logger.warning(
                    "Failed to seed starting value",
                    key=key,
                    bundle=bundle,
                    session_id=session_id,
                    **self._log_context,
                )
                failed.append(key)
            else:
                seeded[key] = values[key]

        return seeded, failed or None

    async def _cleanup_spawned_container(self, container_id: str) -> None:
        """A cleanup failure here is logged, never raised - the caller's own error is what stands.

        Every caller awaits this shielded, so a client disconnect mid-cleanup does not abort it.
        """

        try:
            await self._containers.stop_container(container_id)
            await self._containers.remove(container_id)
        except Exception:  # noqa: BLE001 - reported, never raised; see the docstring above
            self._logger.warning(
                "Cleanup of spawned container failed",
                container={"id": container_id},
                **self._log_context,
            )

    # Fork Helpers
    # ----------------------------------------------------------------------------------------------

    def _runs_claude(self, workspace: Workspace, session_id: str) -> bool:
        """Whether the session runs the Claude runtime, whose forks need its transcript."""

        path = workspace.ensure_session(session_id).path / SESSION_METADATA_FILE

        try:
            runtime = (read_json(path, default={}) or {}).get("runtime")
        except ValueError:
            runtime = None

        return runtime == "Claude" or (runtime is None and self._agent == "claude")

    def _copy_sdk_session_dir(self, project_dir: Path, source_id: str, new_id: str) -> None:
        """Copy SDK session directory (tool-results, subagents). Skip if absent."""

        src = project_dir / source_id

        if src.exists():
            try:
                shutil.copytree(
                    src,
                    project_dir / new_id,
                    symlinks=True,
                    ignore=_drop_escaping_links(src),
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
    def _copy_sdk_transcript(cls, project_dir: Path, source_id: str, new_id: str) -> None:
        """Copy SDK transcript JSONL file. Skip if absent."""

        src = project_dir / f"{source_id}.jsonl"

        if not src.exists():
            return

        if _escapes(src, project_dir):
            get_logger(__name__).warning(
                "Skipped a transcript linking outside its folder",
                link=str(src),
            )

            return

        shutil.copy2(src, project_dir / f"{new_id}.jsonl", follow_symlinks=False)

    def _truncate_sdk_transcript(self, project_dir: Path, session_id: str, turn_id: str) -> None:
        """Truncate SDK transcript, keeping lines before user message with matching turn_id."""

        path = project_dir / f"{session_id}.jsonl"

        if not path.exists():
            return

        kept = []

        for line in _jsonl_lines(path.read_text(encoding="utf-8")):
            data = self._parse_jsonl_line(line, path)

            if data is not None and data.get("type") == "user" and data.get("uuid") == turn_id:
                break

            kept.append(line)

        path.write_text("".join(kept), encoding="utf-8")

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
                symlinks=True,
                ignore=_drop_escaping_links(src, *excluded),
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

        for line in _jsonl_lines(path.read_text(encoding="utf-8")):
            data = self._parse_jsonl_line(line, path)

            if data is not None and data.get("turn_id") == turn_id:
                break

            kept.append(line)

        path.write_text("".join(kept), encoding="utf-8")

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

    def _compute_derived_fields(self, events_path: Path, runtime: str | None = None) -> dict:
        """Sum counters and snapshot last-value fields from an events JSONL log.

        Mirrors Projection.update so totals match the events the transcript will replay; absent
        file yields zeros/None. A figure's runtime is its init's, else the record's `runtime`.
        """

        cost = 0.0
        previous_cost: float | None = None
        segment_runtime: str | None = None
        duration_ms = 0
        num_turns = 0
        last_message: str | None = None
        last_context_tokens = 0
        todos: list[dict] | None = None

        if events_path.exists():
            for line in _jsonl_lines(events_path.read_text(encoding="utf-8")):
                if not line.strip():
                    continue

                data = self._parse_jsonl_line(line, events_path)

                if data is None:
                    continue

                if data.get("type") == "system" and data.get("subtype") == "init":
                    segment_runtime = _init_runtime(data)

                if data.get("cost_usd"):
                    cost += cost_added(
                        data["cost_usd"],
                        previous_cost,
                        runtime=segment_runtime or runtime,
                    )
                    previous_cost = data["cost_usd"]

                if data.get("duration_ms"):
                    duration_ms += data["duration_ms"]

                if data.get("is_human") and data.get("parent_tool_use_id") is None:
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

    def _discard_fork_artifacts(
        self,
        workspace: Workspace,
        project_dir: Path | None,
        new_session_id: str,
    ) -> None:
        """Remove everything a failed fork copied, leaving no orphan session behind.

        Safe to delete: new_session_id is a fresh uuid minted in fork(), so these paths can't
        predate the call. Failures are logged, not raised, so the original error propagates.
        """

        sdk_targets = (
            (project_dir / new_session_id, project_dir / f"{new_session_id}.jsonl")
            if project_dir
            else ()
        )
        targets = (*sdk_targets, workspace.ensure_session(new_session_id).path)

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


def _drop_escaping_links(root: Path, *patterns: str) -> Callable[[str, list[str]], set[str]]:
    """Ignore `patterns` and every symlink leaving `root`: the container can write these trees,
    so a followed link would copy a host file of the agent's choosing into its reach."""

    by_pattern = shutil.ignore_patterns(*patterns)

    def ignore(directory: str, names: list[str]) -> set[str]:
        ignored = set(by_pattern(directory, names))

        for name in names:
            path = Path(directory) / name

            if path.is_symlink() and _escapes(path, root):
                get_logger(__name__).warning(
                    "Dropped a symlink leaving the session during fork",
                    link=str(path),
                )
                ignored.add(name)

        return ignored

    return ignore


def _escapes(link: Path, root: Path) -> bool:
    if not link.is_symlink():
        return False

    if Path(os.readlink(link)).is_absolute():
        return True

    try:
        return not link.resolve().is_relative_to(root.resolve())
    except (OSError, RuntimeError):
        return True


def _init_runtime(init: dict) -> str | None:
    if init.get("runtime_name"):
        return init["runtime_name"]
    # Inits older than `runtime_name` are Claude's; LangGraph's carries this key too, as null.
    elif (init.get("message_data") or {}).get("claude_code_version"):
        return "Claude"
    else:
        return None


def _spawn_tree(root: str, sessions: tuple[SessionInfo, ...]) -> list[str]:
    """`root` and every session whose spawner chain leads to it, each before those it spawned."""

    children: dict[str, list[str]] = {}

    for info in sessions:
        if info.spawned_from_session_id:
            children.setdefault(info.spawned_from_session_id, []).append(info.session_id)

    tree = [root]
    index = 0

    while index < len(tree):
        tree += [child for child in children.get(tree[index], []) if child not in tree]
        index += 1

    return tree


def _sibling_state(info: SessionInfo, statuses: dict) -> str:
    from ..containers import ContainerStatus

    if not info.container_id:
        return "stopped"
    elif statuses.get(info.container_id) == ContainerStatus.STARTING or info.activity in (
        "working",
        "waiting",
    ):
        return "working"
    else:
        return "idle"


def _previews(first: str | None, last: str | None) -> tuple[str | None, str | None]:
    """Equal messages send no last; distinct ones keep distinct previews, or the pair reads as one message."""

    if last == first:
        return _preview(first), None

    first_preview, last_preview = _preview(first), _preview(last)

    if last_preview == first_preview:
        last_preview = _preview(last, LISTING_PREVIEW_CHARS - 1)

    return first_preview, last_preview


def _preview(message: str | None, limit: int = LISTING_PREVIEW_CHARS) -> str | None:
    if message is None or len(message) <= limit:
        return message
    elif (args := _COMMAND_ARGS.search(message)) and len(message) - len(args.group(1)) < limit:
        budget = limit - (len(message) - len(args.group(1)))

        return message[: args.start(1)] + args.group(1)[:budget] + "..." + message[args.end(1) :]
    else:
        return message[:limit] + "..."


@dataclass(frozen=True)
class _ContainerSnapshot:
    """Container state a listing resolves against, copied on the loop - the job must not iterate the registry.

    `container_ids` mirrors find_by_session + _resolve_container_id: owner over member, a member only while live.
    """

    container_ids: dict[str, str | None]
    serving: list[tuple[str, str, datetime]]

    @classmethod
    def take(cls, containers: list[Container]) -> _ContainerSnapshot:
        from ..containers import ContainerStatus

        owners: dict[str, str | None] = {}
        members: dict[str, str | None] = {}
        serving = []

        for container in containers:
            if container.status not in (ContainerStatus.RUNNING, ContainerStatus.STARTING):
                continue

            if container.session_id:
                owners.setdefault(container.session_id, container.id)
                serving.append((container.session_id, container.id, container.created_at))

            for member in container.members:
                live = member in container.live_session_ids
                members.setdefault(member, container.id if live else None)

        return cls(container_ids={**members, **owners}, serving=serving)
