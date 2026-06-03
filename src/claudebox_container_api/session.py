"""FastAPI lifespan glue for the active session singleton."""

import contextlib
from collections.abc import Callable

from claudebox import SessionNotReady, SessionService
from .constants import CONTAINER_API_LOG_FILENAME
from .logging import start_logging, stop_logging


current: SessionService | None = None


def get_session() -> SessionService:
    """Return the active session, raising SessionNotReady if uninitialized."""

    if not current:
        raise SessionNotReady()

    return current


def managed(**kwargs) -> Callable:
    """Build an async context manager owning the session singleton.

    Construction does not auto-start the session — the daemon triggers start()
    via POST /api/sessions/new or POST /api/sessions/{id}/resume. Per-session
    log routing wires through on_session_start/on_session_stop so the file path
    is known only when the session resolves its own session_dir.
    """

    @contextlib.asynccontextmanager
    async def handler(*_args, **_kwargs):
        global current

        current = SessionService(
            **kwargs,
            on_session_start=lambda session: start_logging(
                session.path / CONTAINER_API_LOG_FILENAME,
            ),
            on_session_stop=stop_logging,
        )

        try:
            yield
        finally:
            await current.stop()
            current = None

    return handler
