"""Path resolver — resolve file path candidates against workspace index."""

import os
import time
from pathlib import Path

from pathspec import PathSpec

from claudebox import get_logger
from ..constants import FILE_INDEX_CACHE_TTL


# Directories always excluded during workspace walk (regardless of .ignore).
_WALK_EXCLUDE_DIRS = {".git", "__pycache__"}


class PathResolver:
    """Resolve path candidates to workspace-relative paths.

    Maintains a file index (filename -> [relative paths]) and a resolve cache
    (candidate -> resolved path). Both use TTL-based invalidation.
    When the file index rebuilds, the resolve cache is cleared.

    Attributes:
        _workspace_path: Workspace root path.
        _ignore_spec: Shared PathSpec for file exclusion.
        _index_cache: (monotonic_time, {filename: [rel_paths]}) or None.
        _resolve_cache: Maps (candidate, root) to resolved path or None.
    """

    def __init__(self, workspace_path: Path, ignore_spec: PathSpec) -> None:
        self._logger = get_logger(__name__)
        self._workspace_path = workspace_path
        self._ignore_spec = ignore_spec
        self._index_cache: tuple[float, dict[str, list[str]]] | None = None
        self._resolve_cache: dict[tuple[str, str], str | None] = {}

    # Public API
    # ----------------------------------------------------------------------------------------------

    def resolve(self, candidates: list[str], temp_dir: Path | None) -> dict[str, str]:
        """Resolve all path candidates synchronously (called via asyncio.to_thread).

        Returns mapping of candidate -> absolute path for successfully resolved paths.
        Refreshes file index first so stale resolve cache entries are cleared.
        """

        # Ensure file index is fresh — clears resolve cache on rebuild.
        self._get_file_index()

        resolved = {}
        for candidate in candidates:
            candidate = candidate.strip()
            if not candidate:
                continue

            result = self._resolve_candidate(candidate, temp_dir)
            if result:
                resolved[candidate] = result

        return resolved

    # Resolution
    # ----------------------------------------------------------------------------------------------

    def _resolve_candidate(self, candidate: str, temp_dir: Path | None) -> str | None:
        """Resolve a single path candidate to an absolute host path, with caching."""

        # /tmp paths: mechanical join — no cache needed, always instant.
        if temp_dir and (candidate == "/tmp" or candidate.startswith("/tmp/")):
            remainder = candidate[4:]  # strip "/tmp" prefix
            return str(temp_dir) + remainder

        cache_key = (candidate, str(self._workspace_path))
        if cache_key in self._resolve_cache:
            return self._resolve_cache[cache_key]

        result = self._resolve_candidate_uncached(candidate)
        self._resolve_cache[cache_key] = result
        return result

    def _resolve_candidate_uncached(self, candidate: str) -> str | None:
        """Resolve a single non-tmp path candidate without caching."""

        # Absolute paths: existence check.
        if candidate.startswith("/"):
            path = Path(candidate)
            if path.exists():
                return candidate
            return None

        # Relative paths: look up in pre-built file index.
        target = Path(candidate)
        target_name = target.name
        index = self._get_file_index()

        entries = index.get(target_name, [])

        # For multi-segment candidates (e.g. "docs/foo.md"), filter by path suffix.
        if target.parts != (target_name,):
            entries = [e for e in entries if e.endswith(candidate)]

        if len(entries) == 1:
            return str(self._workspace_path / entries[0])
        return None  # Ambiguous or not found

    # Index
    # ----------------------------------------------------------------------------------------------

    def _get_file_index(self) -> dict[str, list[str]]:
        """Return cached file index, rebuilding if TTL expired.

        Clears _resolve_cache on rebuild — new/deleted files invalidate
        previously resolved paths.
        """

        now = time.monotonic()

        if self._index_cache is not None:
            cached_time, cached_index = self._index_cache
            if now - cached_time < FILE_INDEX_CACHE_TTL.total_seconds():
                return cached_index

        # TTL expired — rebuild index and clear resolve cache.
        self._resolve_cache.clear()
        index = self._build_index()
        self._index_cache = (now, index)
        return index

    def _build_index(self) -> dict[str, list[str]]:
        """Walk workspace directory and build filename -> [relative_paths] index."""

        index: dict[str, list[str]] = {}

        for dirpath, dirnames, filenames in os.walk(self._workspace_path):
            rel_dir = os.path.relpath(dirpath, str(self._workspace_path))

            # Prune directories in-place to skip entire subtrees.
            dirnames[:] = [
                d
                for d in dirnames
                if d not in _WALK_EXCLUDE_DIRS
                and not self._ignore_spec.match_file(
                    (os.path.join(rel_dir, d) if rel_dir != "." else d) + "/"
                )
            ]

            for filename in filenames:
                rel_path = os.path.join(rel_dir, filename) if rel_dir != "." else filename
                if self._ignore_spec.match_file(rel_path):
                    continue
                index.setdefault(filename, []).append(rel_path)

        return index
