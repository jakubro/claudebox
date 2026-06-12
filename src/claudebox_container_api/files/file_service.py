"""File service - orchestrates path resolution."""

import asyncio
from pathlib import Path

from claudebox import Workspace, get_logger
from .path_resolver import PathResolver


class FileService:
    """Workspace file service facade.

    Coordinates PathResolver with shared configuration.
    Created once at app startup, persists across session restarts.

    Attributes:
        _workspace: Workspace instance for path and ignore spec access.
        _resolver: PathResolver for path resolution and file indexing.
    """

    def __init__(self, workspace: Workspace) -> None:
        """Build shared ignore spec and initialize resolver subsystem."""

        spec = workspace.build_ignore_spec()

        self._logger = get_logger(__name__)
        self._resolver = PathResolver(workspace.path, spec)

    async def resolve_paths(self, candidates: list[str], temp_dir: Path | None) -> dict[str, str]:
        """Resolve path candidates to absolute host paths via filesystem checks."""

        return await asyncio.to_thread(self._resolver.resolve, candidates, temp_dir)
