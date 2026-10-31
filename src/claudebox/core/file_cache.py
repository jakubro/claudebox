"""File cache - invalidated by a change in the file's stamp: inode, size, modification and change time."""

from __future__ import annotations

import os
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from time import time_ns
from typing import TypeVar


T = TypeVar("T")

# File timestamps move once per clock tick (once per second or two on some network mounts), so a
# second same-size write in that tick leaves every stat field equal; only an older change is safe.
SETTLE_WINDOW = timedelta(seconds=2)


@dataclass(frozen=True)
class FileStamp:
    """A file's inode, size and change times as of one stat."""

    ino: int
    size: int
    mtime_ns: int
    ctime_ns: int
    settled: bool = field(compare=False)


class FileCache[T]:
    """Cache keyed by file path, trusted only while the file's stamp is unchanged and was settled."""

    def __init__(self):
        self._store: dict[str, tuple[FileStamp | None, T]] = {}

    def get(self, path: str | Path, callback: Callable[[], T]) -> T:
        """Return the cached value while the file is unchanged, otherwise invoke callback and cache it.

        The file is stamped before the callback runs, so a write landing during it is re-read next time.
        """

        path = str(path)
        stamp = file_stamp(path)

        entry = self._store.get(path)

        if entry is not None and entry[0] == stamp and (stamp is None or stamp.settled):
            return entry[1]

        value = callback()
        self._store[path] = (stamp, value)

        return value

    def retain(self, paths: Iterable[str | Path]) -> None:
        """Drop every entry whose path is not in `paths`."""

        kept = {str(path) for path in paths}

        for path in self._store.keys() - kept:
            del self._store[path]


def file_stamp(path: str | Path) -> FileStamp | None:
    """Stamp `path`, or None when it cannot be stat'ed."""

    now = time_ns()

    try:
        stat = os.stat(path)
    except OSError:
        return None

    return FileStamp(
        ino=stat.st_ino,
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        ctime_ns=stat.st_ctime_ns,
        settled=stat.st_ctime_ns < now - int(SETTLE_WINDOW.total_seconds() * 1e9),
    )
