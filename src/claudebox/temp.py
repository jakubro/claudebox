"""Session-scoped /tmp symlink management."""

import os
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from .core.fs import touch_dir


if TYPE_CHECKING:
    from .session.session import Session


# The container-wide temp path this module manages.
TMP_PATH = Path("/tmp")


def ensure_tmp(session: "Session") -> None:
    """Ensure /tmp symlinks to session temp directory; no-op if CLAUDEBOX_NO_TMP_REMAP is set or already correct."""

    if os.environ.get("CLAUDEBOX_NO_TMP_REMAP") == "1":
        return

    dst = session.temp_dir
    touch_dir(dst)

    tmp = TMP_PATH

    # Idempotent: skip if already pointing to correct destination
    if tmp.is_symlink():
        try:
            if tmp.resolve() == dst.resolve():
                return
        except OSError:
            pass

    _remove_tmp()
    tmp.symlink_to(dst)


def restore_tmp() -> None:
    """Restore /tmp as regular empty directory; no-op if CLAUDEBOX_NO_TMP_REMAP is set or /tmp is not our symlink."""

    if os.environ.get("CLAUDEBOX_NO_TMP_REMAP") == "1":
        return

    tmp = TMP_PATH

    # A /tmp we did not create belongs to another session; removing it destroys their files.
    if not tmp.is_symlink():
        return

    tmp.unlink(missing_ok=True)
    touch_dir(tmp)


def _remove_tmp() -> Path:
    """Remove /tmp whether symlink or directory - ensure_tmp owns the replacement."""

    tmp = TMP_PATH

    if tmp.is_symlink():
        tmp.unlink(missing_ok=True)
    else:
        shutil.rmtree(tmp, ignore_errors=True)

    return tmp
