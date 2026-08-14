"""File service - orchestrates path resolution."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from claudebox import Workspace, get_logger
from .path_resolver import PathResolver


class FileService:
    """Facade coordinating PathResolver; created once at app startup, persists across restarts."""

    def __init__(self, workspace: Workspace) -> None:
        spec = workspace.build_ignore_spec()

        self._logger = get_logger(__name__)
        self._resolver = PathResolver(workspace.path, spec)

        # Not the default executor: sharing it would stall event persistence on a long walk.
        # One worker serializes walks.
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="path-resolve")

    async def resolve_paths(self, candidates: list[str], temp_dir: Path | None) -> dict[str, str]:
        """Resolve path candidates to absolute host paths via filesystem checks."""

        loop = asyncio.get_running_loop()

        return await loop.run_in_executor(
            self._executor,
            self._resolver.resolve,
            candidates,
            temp_dir,
        )

    def close(self) -> None:
        """Release the resolver's executor without waiting on an in-flight walk."""

        self._executor.shutdown(wait=False)
