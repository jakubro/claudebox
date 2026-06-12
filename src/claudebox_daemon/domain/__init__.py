"""Daemon domain facade - re-exports service, lifecycle, and singleton."""

import contextlib

from .boards import BoardNotFound, BoardParseError, BoardService
from .config import DaemonConfig
from .containers import (
    Container,
    ContainerNotFound,
    ContainerProxyClient,
    ContainerStatus,
    ContainerUnavailable,
)
from .errors import DaemonError, DaemonNotReady, WorkspaceNotFound, WorkspaceUnavailable
from .service import DaemonService
from .sessions import SessionInfo, SessionNotFound, SessionService
from .ui_state import UIState, UIStateService
from .workspaces import WorkspaceService


# Singleton holding the current active daemon service, set by the managed() context manager.
current: DaemonService | None = None


@contextlib.asynccontextmanager
async def managed():
    """Create, start, yield, and stop the daemon service.

    Sets the package-level singleton (domain.current) for handler access.
    """

    global current

    svc = DaemonService()
    await svc.start()
    current = svc

    try:
        yield svc
    finally:
        await svc.stop()
        current = None


def get_daemon() -> DaemonService:
    """Return the active daemon service, raising DaemonNotReady if uninitialized."""

    if not current:
        raise DaemonNotReady()

    return current


async def get_workspace(workspace_id: str) -> WorkspaceService:
    """Resolve workspace service, lazy-loading from config if needed."""

    daemon = get_daemon()
    workspace = await daemon.get_workspace(workspace_id)

    if not workspace.workspace.available:
        raise WorkspaceUnavailable(workspace_id=workspace_id)

    return workspace
