"""File cache — mtime-based invalidation."""

from collections.abc import Callable
from pathlib import Path
from typing import Generic, TypeVar


T = TypeVar("T")

MISSING = object()


class FileCache(Generic[T]):
    """Cache keyed by file path, invalidated when the file's mtime changes."""

    def __init__(self):
        self._store: dict[str, tuple[float, T]] = {}

    def get(self, path: str | Path, callback: Callable[[], T]) -> T:
        """Return cached value if mtime matches, otherwise invoke callback and cache."""

        path = str(path)

        if (value := self._find(path)) is not MISSING:
            return value
        else:
            value = callback()
            return self._add(path, value)

    def _find(self, path: str) -> T:
        """Return cached value if mtime is unchanged, otherwise MISSING."""

        current_mtime = self._get_mtime(path)

        if path in self._store:
            mtime, value = self._store[path]
            if mtime == current_mtime:
                return value

        return MISSING  # ty: ignore[invalid-return-type]

    def _add(self, path: str, value: T) -> T:
        """Store value with current mtime and return it."""

        mtime = self._get_mtime(path)

        self._store[path] = (mtime, value)
        return value

    @staticmethod
    def _get_mtime(path: str) -> float:
        """Return file modification time, or 0 if unavailable."""

        p = Path(path)

        if p.exists():
            try:
                return p.stat().st_mtime
            except OSError:
                pass

        return 0
