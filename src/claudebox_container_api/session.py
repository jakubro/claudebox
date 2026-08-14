"""FastAPI lifespan glue for the active session singleton."""

import contextlib
from collections.abc import Callable
from pathlib import Path

from claudebox import SessionNotReady, SessionService
from .constants import CONTAINER_API_LOG_FILENAME
from .logging import start_logging, stop_logging


current: SessionService | None = None


def get_session() -> SessionService:
    """Return the active session, raising SessionNotReady if uninitialized."""

    if not current:
        raise SessionNotReady()

    return current


def managed(
    workspace: str,
    system_prompt: str | None = None,
    permission_mode: str | None = None,
    **_server_args,
) -> Callable:
    """Build an async context manager owning the session singleton.

    Construction does not auto-start; the daemon triggers start() via POST /api/sessions/new or /{id}/resume.
    Log routing wires through on_start/on_stop, since the path is known only once session_dir resolves.
    `_server_args` (e.g. `port`) are HTTP-server CLI args the lifespan forwards but the session ignores.
    """

    @contextlib.asynccontextmanager
    async def handler(*_args, **_kwargs):
        global current

        current = SessionService(
            workspace=Path(workspace),
            system_prompt=system_prompt,
            permission_mode=permission_mode,
            on_start=lambda session: start_logging(
                session.path / CONTAINER_API_LOG_FILENAME,
            ),
            on_stop=stop_logging,
        )

        try:
            yield
        finally:
            await current.stop()
            current = None

    return handler
