"""Shared FileLock helper - bounded acquisition with a typed timeout error."""

from __future__ import annotations

import contextlib
from collections.abc import Generator
from pathlib import Path

from filelock import FileLock, Timeout

from claudebox.constants import FILE_LOCK_TIMEOUT_SECONDS
from .errors import LockTimeout


@contextlib.contextmanager
def locked(lock_path: Path) -> Generator[None]:
    """Acquire ``lock_path`` within ``FILE_LOCK_TIMEOUT_SECONDS``, else raise LockTimeout."""

    lock = FileLock(lock_path, timeout=FILE_LOCK_TIMEOUT_SECONDS)

    try:
        with lock:
            yield
    except Timeout as exc:
        raise LockTimeout(path=str(lock_path)) from exc
