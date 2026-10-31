"""Session-scoped /tmp symlink management."""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from .core.fs import touch_dir
from .errors import ApiError


if TYPE_CHECKING:
    from .session.session import Session


# The container-wide temp path this module manages.
TMP_PATH = Path("/tmp")

MOUNTINFO_PATH = Path("/proc/self/mountinfo")


class TmpRemapBlocked(ApiError):
    """Replacing /tmp would delete across a mount or link /tmp into itself; nothing was touched."""

    status_code = 409
    error_key = "tmp_remap_blocked"


def ensure_tmp(session: Session) -> None:
    """Point /tmp at the session's temp dir; no-op under CLAUDEBOX_NO_TMP_REMAP=1 or when already so.
    Raises TmpRemapBlocked, deleting nothing, when a mount or the temp dir is at or under /tmp."""

    if os.environ.get("CLAUDEBOX_NO_TMP_REMAP") == "1":
        return

    dst = session.temp_dir
    tmp = TMP_PATH

    if tmp.is_symlink():
        try:
            if tmp.resolve() == dst.resolve():
                return
        except OSError:
            pass

        tmp.unlink(missing_ok=True)
    else:
        _refuse_unsafe_removal(tmp, dst)
        shutil.rmtree(tmp, ignore_errors=True)

    touch_dir(dst)
    tmp.symlink_to(dst)


def _refuse_unsafe_removal(tmp: Path, dst: Path) -> None:
    if _at_or_under(Path(os.path.abspath(dst)), tmp):
        raise TmpRemapBlocked(paths=str(dst), reason="session_dir_inside")

    try:
        mounts = _mount_points_at_or_under(tmp)
    except OSError as exc:
        raise TmpRemapBlocked(paths=str(MOUNTINFO_PATH), reason="mountinfo_unreadable") from exc

    if mounts:
        raise TmpRemapBlocked(paths=",".join(str(m) for m in mounts), reason="mounted")


def _mount_points_at_or_under(root: Path) -> list[Path]:
    points = []

    for line in MOUNTINFO_PATH.read_text(encoding="utf-8").splitlines():
        fields = line.split(" ")

        if len(fields) > 4:
            # Field 5 escapes space, tab, newline and backslash as octal; nothing else is encoded.
            point = Path(re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), fields[4]))

            if _at_or_under(point, root):
                points.append(point)

    return points


def _at_or_under(path: Path, root: Path) -> bool:
    return path == root or root in path.parents
