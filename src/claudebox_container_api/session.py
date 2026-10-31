"""FastAPI lifespan glue for the container's session registry."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from pathlib import Path

from claudebox import (
    SessionEntryNotFound,
    SessionNotFound,
    SessionNotReady,
    SessionRepository,
    SessionService,
    ValidationError,
    Workspace,
)
from claudebox.constants import CONFIG_DIR_NAME
from .constants import CONTAINER_API_LOG_FILENAME
from .logging import start_logging, stop_logging


class SessionRegistry:
    """Keyed SessionService instances sharing one container.

    Exactly one entry is primary - fixed at the first start, never reassigned by a later one.
    """

    def __init__(
        self,
        workspace: Path,
        system_prompt_file: Path | None,
        permission_mode: str | None,
    ) -> None:
        self.workspace = Workspace(workspace)
        self._repo = SessionRepository(self.workspace)
        self._system_prompt_file = system_prompt_file
        self._permission_mode = permission_mode
        self._entries: dict[str, SessionService] = {}
        self._primary_id: str | None = None
        self._lock = asyncio.Lock()

    def get(self, session_id: str | None = None) -> SessionService:
        """Resolve one entry by id, or the primary when unaddressed."""

        key = session_id or self._primary_id

        if key is None or key not in self._entries:
            raise SessionNotReady()

        return self._entries[key]

    @property
    def primary_id(self) -> str | None:
        """The container's owning session id, or None before any session has started."""

        return self._primary_id

    def live_ids(self) -> list[str]:
        """Every registered session id whose runtime is not in a terminal connect-failed state."""

        return [sid for sid, svc in self._entries.items() if not svc.connect_failed]

    async def start(self, resume_session_id: str | None, *, primary: bool = True) -> str:
        """Start one entry, returning its session id.

        `primary=True` replaces the primary; a member joins once per id, auto-stops unless promoted.
        """

        async with self._lock:
            if not primary and resume_session_id is not None:
                existing = self._entries.get(resume_session_id)

                if existing is not None:
                    await existing.settle_turn_complete()

                    # Settling can let the entry's own auto-stop remove it - re-check under the
                    # same lock acquisition rather than trusting a membership test taken before it.
                    if resume_session_id in self._entries:
                        return resume_session_id

            if primary and self._primary_id is not None:
                await self._stop_entry(self._primary_id)

            stops_after_answer = not (primary or self._is_promoted(resume_session_id))
            svc = SessionService(
                workspace=self.workspace.path,
                system_prompt_file=self._system_prompt_file,
                permission_mode=self._permission_mode,
                remaps_tmp=primary,
                on_turn_complete=self._on_member_turn_complete if stops_after_answer else None,
            )
            session_id = await svc.start(resume_session_id)
            self._entries[session_id] = svc

            if primary:
                self._primary_id = session_id

            return session_id

    def promote_session(self, session_id: str) -> None:
        """Record a session as promoted and cancel a running member's turn-complete auto-stop.

        Needs the session's record, not a running entry: a stopped member rejoins without auto-stop.
        """

        try:
            self._repo.update(session_id, is_promoted=True)
        except SessionNotFound as exc:
            raise SessionEntryNotFound(session_id=session_id) from exc

        if (entry := self._entries.get(session_id)) is not None:
            entry.cancel_turn_complete()

    async def stop_session(self, session_id: str) -> None:
        """Stop and remove one non-primary entry.

        Never the primary: ending the container's owning session is a container-lifecycle decision.
        """

        if session_id not in self._entries:
            raise SessionEntryNotFound(session_id=session_id)

        if session_id == self._primary_id:
            raise ValidationError("cannot_stop_primary", session_id=session_id)

        await self._stop_entry(session_id)

    async def stop_all(self) -> None:
        """Stop and remove every entry."""

        for session_id in list(self._entries):
            await self._stop_entry(session_id)

        self._primary_id = None

    # Internal
    # ----------------------------------------------------------------------------------------------

    async def _on_member_turn_complete(self, session_id: str) -> None:
        """A member's own turn-complete trigger, wired as `SessionService.on_turn_complete`.

        Never wired for the primary; tolerates the entry already being gone (concurrent stop).
        """

        try:
            await self.stop_session(session_id)
        except SessionEntryNotFound:
            pass

    def _is_promoted(self, session_id: str | None) -> bool:
        if session_id is None:
            return False

        try:
            return self._repo.get(session_id).is_promoted
        except SessionNotFound:
            return False

    async def _stop_entry(self, session_id: str) -> None:
        svc = self._entries.pop(session_id, None)

        if svc is not None:
            await svc.stop()

        if session_id == self._primary_id:
            self._primary_id = None


registry: SessionRegistry | None = None


def get_session(session_id: str | None = None) -> SessionService:
    """Resolve the addressed session, or the primary when unaddressed.

    FastAPI binds `session_id` to the route's path segment when it has one, else to a query param.
    """

    if registry is None:
        raise SessionNotReady()

    return registry.get(session_id)


def get_registry() -> SessionRegistry:
    """Return the active session registry, raising SessionNotReady if uninitialized."""

    if registry is None:
        raise SessionNotReady()

    return registry


def managed(
    workspace: str,
    system_prompt_file: str | None = None,
    permission_mode: str | None = None,
    **_server_args,
) -> Callable:
    """Build an async context manager owning the container's session registry.

    Logging is container-scoped, so a session-scoped stop never takes `/api/logs` down.
    """

    @contextlib.asynccontextmanager
    async def handler(*_args, **_kwargs):
        global registry

        workspace_path = Path(workspace)
        start_logging(workspace_path / CONFIG_DIR_NAME / CONTAINER_API_LOG_FILENAME)

        registry = SessionRegistry(
            workspace=workspace_path,
            system_prompt_file=Path(system_prompt_file) if system_prompt_file else None,
            permission_mode=permission_mode,
        )

        try:
            yield
        finally:
            await registry.stop_all()
            stop_logging()
            registry = None

    return handler
