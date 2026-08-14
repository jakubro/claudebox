"""Path resolver - resolve file path candidates against workspace index."""

import os
import threading
import time
import uuid
from pathlib import Path

from pathspec import PathSpec

from claudebox import get_logger, serialization, touch_dir
from claudebox.constants import CONFIG_DIR_NAME
from ..constants import (
    FILE_INDEX_CACHE_TTL,
    FILE_INDEX_WALK_TTL_FACTOR,
    PATH_INDEX_FILE,
    PATH_INDEX_LOAD_MAX_AGE,
)


# Excluded regardless of .ignore; CONFIG_DIR_NAME is claudebox's own state, not user files, often the largest dir.
_WALK_EXCLUDE_DIRS = {".git", "__pycache__", CONFIG_DIR_NAME}


class PathResolver:
    """Resolve path candidates to workspace-relative paths.

    Rebuilding the file index clears the resolve cache, since stale entries could point to deleted files.

    Attributes:
        _index_cache: (monotonic_time, {filename: [rel_paths]}) or None.
        _resolve_cache: Maps (candidate, root) to resolved path or None.
        _index_lock: Serializes rebuilds so concurrent callers share one walk.
        _last_walk_seconds: Cost of the most recent walk, feeding the adaptive TTL.
        _index_path: Where the index is persisted, so a restart can start warm.
    """

    def __init__(self, workspace_path: Path, ignore_spec: PathSpec) -> None:
        self._logger = get_logger(__name__)
        self._workspace_path = workspace_path
        self._ignore_spec = ignore_spec
        self._index_cache: tuple[float, dict[str, list[str]]] | None = None
        self._resolve_cache: dict[tuple[str, str], str | None] = {}
        self._index_lock = threading.Lock()
        self._last_walk_seconds = 0.0
        self._index_path = workspace_path / CONFIG_DIR_NAME / PATH_INDEX_FILE

        self._load_persisted_index()

    # Public API

    def resolve(self, candidates: list[str], temp_dir: Path | None) -> dict[str, str]:
        """Resolve all path candidates synchronously (called on the resolver's executor).

        Returns mapping of candidate -> absolute path for successfully resolved paths.
        """

        cleaned = [stripped for stripped in (c.strip() for c in candidates) if stripped]

        # Refresh the index only when a candidate needs it - a /tmp or absolute batch costs nothing.
        if any(self._needs_index(candidate, temp_dir) for candidate in cleaned):
            self._get_file_index()

        resolved = {}

        for candidate in cleaned:
            result = self._resolve_candidate(candidate, temp_dir)

            if result:
                resolved[candidate] = result

        return resolved

    # Resolution

    def _resolve_candidate(self, candidate: str, temp_dir: Path | None) -> str | None:
        """Resolve a single path candidate to an absolute host path, with caching."""

        # /tmp paths: mechanical join - no cache needed, always instant.
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
            resolved = self._workspace_path / entries[0]

            # Guards against a stale index, persisted or merely unrebuilt.
            if resolved.exists():
                return str(resolved)

        return None  # Ambiguous, not found, or stale

    @staticmethod
    def _needs_index(candidate: str, temp_dir: Path | None) -> bool:
        """Whether this candidate needs the file index - only workspace-relative ones do."""

        if temp_dir and (candidate == "/tmp" or candidate.startswith("/tmp/")):
            return False

        return not candidate.startswith("/")

    # Index

    def _get_file_index(self) -> dict[str, list[str]]:
        """Return cached file index, rebuilding if TTL expired.

        Rebuild clears _resolve_cache, since new/deleted files invalidate resolved paths.
        Rebuilds are single-flighted so concurrent callers share one walk, not queue N.
        """

        fresh = self._fresh_index()

        if fresh is not None:
            return fresh

        with self._index_lock:
            # Whoever held the lock may have just rebuilt.
            fresh = self._fresh_index()

            if fresh is not None:
                return fresh

            self._resolve_cache.clear()

            started = time.monotonic()
            index = self._build_index()
            self._last_walk_seconds = time.monotonic() - started

            # Stamped after the walk, so the TTL measures time served, not time building.
            self._index_cache = (time.monotonic(), index)
            self._persist_index(index)

            return index

    def _fresh_index(self) -> dict[str, list[str]] | None:
        """Return the cached index while it is still within its TTL, else None."""

        if self._index_cache is None:
            return None

        cached_time, cached_index = self._index_cache

        if time.monotonic() - cached_time < self._index_ttl_seconds():
            return cached_index

        return None

    def _index_ttl_seconds(self) -> float:
        """Index lifetime, floored at a multiple of the last walk's cost.

        A walk slower than the nominal TTL would otherwise rebuild forever, never serving a warm index.
        """

        return max(
            FILE_INDEX_CACHE_TTL.total_seconds(),
            self._last_walk_seconds * FILE_INDEX_WALK_TTL_FACTOR,
        )

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
                    (os.path.join(rel_dir, d) if rel_dir != "." else d) + "/",
                )
            ]

            for filename in filenames:
                rel_path = os.path.join(rel_dir, filename) if rel_dir != "." else filename

                if self._ignore_spec.match_file(rel_path):
                    continue

                index.setdefault(filename, []).append(rel_path)

        return index

    # Persistence

    def _load_persisted_index(self) -> None:
        """Seed the index from a saved file, if one exists and is worth trusting.

        Counts as freshly built: the TTL clock starts now, not at save time, since monotonic() resets per process.
        Any read or parse failure is treated as no saved index, never raised.
        """

        try:
            saved = serialization.loads(self._index_path.read_text())

            if time.time() - saved["saved_at"] > PATH_INDEX_LOAD_MAX_AGE.total_seconds():
                return

            self._index_cache = (time.monotonic(), saved["index"])
            self._last_walk_seconds = saved["last_walk_seconds"]
        except (OSError, ValueError, KeyError, TypeError):
            pass

    def _persist_index(self, index: dict[str, list[str]]) -> None:
        """Save the index via temp-file-plus-rename, so a concurrent reader never sees a partial write."""

        payload = {
            "saved_at": time.time(),
            "last_walk_seconds": self._last_walk_seconds,
            "index": index,
        }
        tmp_path = self._index_path.with_name(f"{self._index_path.name}.tmp-{uuid.uuid4().hex}")

        try:
            touch_dir(self._index_path.parent)
            tmp_path.write_text(serialization.dumps(payload))
            os.replace(tmp_path, self._index_path)
        except OSError:
            self._logger.warning("path_index_persist_failed", path=str(self._index_path))
            tmp_path.unlink(missing_ok=True)
