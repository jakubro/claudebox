"""FastAPI lifespan glue for the container's session registry."""

import asyncio
import contextlib
from collections.abc import Callable
from pathlib import Path

from claudebox import (
    SessionEntryNotFound,
    SessionNotReady,
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
        system_prompt: str | None,
        permission_mode: str | None,
    ) -> None:
        self.workspace = Workspace(workspace)
        self._system_prompt = system_prompt
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
        """Every session id currently registered."""

        return list(self._entries)

    async def start(self, resume_session_id: str | None, *, primary: bool = True) -> str:
        """Start one entry, returning its session id.

        `primary=True` replaces the current primary; `primary=False` joins as a member, one per id.
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

            svc = SessionService(
                workspace=self.workspace.path,
                system_prompt=self._system_prompt,
                permission_mode=self._permission_mode,
                remaps_tmp=primary,
                on_turn_complete=None if primary else self._on_member_turn_complete,
            )
            session_id = await svc.start(resume_session_id)
            self._entries[session_id] = svc

            if primary:
                self._primary_id = session_id

            return session_id

    def promote_session(self, session_id: str) -> None:
        """Cancel a member's turn-complete auto-stop - it runs until stopped like any other entry.

        Promoting the primary is a harmless no-op: it never has that disposition to cancel.
        """

        if session_id not in self._entries:
            raise SessionEntryNotFound(session_id=session_id)

        self._entries[session_id].cancel_turn_complete()

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
    system_prompt: str | None = None,
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
            system_prompt=system_prompt,
            permission_mode=permission_mode,
        )

        try:
            yield
        finally:
            await registry.stop_all()
            stop_logging()
            registry = None

    return handler
