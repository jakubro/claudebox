"""File service — path resolution."""

import contextlib
from collections.abc import Callable

from claudebox import Workspace
from .errors import FileServiceNotReady
from .file_service import FileService


# Singleton holding the file service, set by the managed() context manager.
current: FileService | None = None


def get_file_service() -> FileService:
    """Return the active file service. Raises FileServiceNotReady if uninitialized."""

    if current is None:
        raise FileServiceNotReady()

    return current


def managed(workspace: Workspace) -> Callable:
    """Create an async context manager that manages the file service lifecycle."""

    @contextlib.asynccontextmanager
    async def handler(*_args, **_kwargs):
        global current

        current = FileService(workspace)

        try:
            yield
        finally:
            current = None

    return handler
