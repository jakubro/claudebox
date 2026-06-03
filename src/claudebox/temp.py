"""Session-scoped /tmp symlink management."""

import os
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from .core.fs import touch_dir


if TYPE_CHECKING:
    from .session.session import Session


def ensure_tmp(session: "Session") -> None:
    """Ensure /tmp symlinks to session temp directory.

    No-op if suppressed via CLAUDEBOX_NO_TMP_REMAP env var, or already
    pointing to the correct target.
    """

    if os.environ.get("CLAUDEBOX_NO_TMP_REMAP") == "1":
        return

    dst = session.temp_dir
    touch_dir(dst)

    tmp = Path("/tmp")

    # Idempotent: skip if already pointing to correct destination
    if tmp.is_symlink():
        try:
            if tmp.resolve() == dst.resolve():
                return
        except OSError:
            pass

    # Remove and recreate
    _remove_tmp()
    tmp.symlink_to(dst)


def restore_tmp() -> None:
    """Restore /tmp as regular empty directory."""

    tmp = _remove_tmp()
    touch_dir(tmp)


def _remove_tmp() -> Path:
    """Remove /tmp whether symlink or directory."""

    tmp = Path("/tmp")

    if tmp.is_symlink():
        tmp.unlink(missing_ok=True)
    else:
        shutil.rmtree("/tmp", ignore_errors=True)

    return tmp
