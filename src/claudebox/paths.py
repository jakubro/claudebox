"""Internal helpers for workspace discovery and session directory naming."""

from datetime import UTC, datetime
from glob import glob
from pathlib import Path

from .constants import CONFIG_DIR_NAME, SESSIONS_DIR_NAME, WORKSPACE_MARKER
from .core.fs import touch_dir, walk_up
from .core.time import get_timestamp, parse_timestamp


def get_workspace_root(start_dir: str | Path | None = None) -> Path | None:
    """Find nearest .workspace marker by walking up from start_dir (default cwd)."""

    for directory in walk_up(start_dir):
        if (directory / WORKSPACE_MARKER).exists():
            return directory

    return None


def get_claudebox_root(start_dir: str | Path | None = None) -> Path:
    """Return workspace root or user home directory as fallback."""

    root = get_workspace_root(start_dir)
    return root or Path.home()


def get_sessions_root(start_dir: str | Path | None = None) -> Path:
    """Return .claudebox/sessions/ directory, creating if needed."""

    root = get_claudebox_root(start_dir) / CONFIG_DIR_NAME / SESSIONS_DIR_NAME
    touch_dir(root)
    return root


def find_session_dir(start_dir: str | Path, session_id: str) -> Path | None:
    """Find existing session directory by session_id, or None if not found."""

    root = get_sessions_root(start_dir)
    pattern = str(root / f"*--{session_id}")

    if matches := glob(pattern):
        for path in matches:
            if all(parse_session_dir_name(path)):
                return Path(path)

    return None


def get_session_dir(start_dir: str | Path, session_id: str) -> Path:
    """Find existing session directory or create {YYYYMMDD-HHMMSS}--{session_id}."""

    if found := find_session_dir(start_dir, session_id):
        return found

    path = get_sessions_root(start_dir) / make_session_dir_name(session_id)
    touch_dir(path)
    return path


def parse_session_dir_name(path: str | Path) -> tuple[datetime, str] | tuple[None, None]:
    """Parse {YYYYMMDD-HHMMSS}--{session_id} into (datetime UTC, session_id)."""

    try:
        timestamp, session_id = Path(path).name.split("--", maxsplit=1)
        timestamp = parse_timestamp(timestamp).replace(tzinfo=UTC)
        return timestamp, session_id
    except (IndexError, ValueError):
        return None, None


def make_session_dir_name(session_id: str) -> str:
    """Generate {YYYYMMDD-HHMMSS}--{session_id} using current UTC time."""

    timestamp = get_timestamp()
    return f"{timestamp}--{session_id}"


def parse_timestamped_dir_name(path: str | Path) -> datetime | None:
    """Extract timestamp from a {YYYYMMDD-HHMMSS}--{suffix} directory name."""

    try:
        timestamp = Path(path).name.split("--", maxsplit=1)[0]
        return parse_timestamp(timestamp)
    except (IndexError, ValueError):
        return None


def make_timestamped_dir_prefix() -> str:
    """Generate a {YYYYMMDD-HHMMSS}-- prefix using current UTC time."""

    return f"{get_timestamp()}--"
