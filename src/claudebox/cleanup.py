"""Stale session and temp directory cleanup."""

from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from .constants import HOST_TEMP_BUILD_DIR, HOST_TEMP_RUN_DIR, SESSIONS_DIR_NAME, SESSION_MAX_AGE
from .core.fs import remove_path
from .paths import parse_timestamped_dir_name


if TYPE_CHECKING:
    from .config import Config


def cleanup_stale_dirs(config: "Config") -> list[Path]:
    """Remove session and temp directories older than SESSION_MAX_AGE.

    Scans the sessions directory and temporary build/run directories for
    subdirectories with timestamp-prefixed names (YYYYMMDD-HHMMSS--*). Any
    directory whose timestamp is older than the cutoff is removed recursively.
    Returns the list of removed paths.
    """

    cutoff = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE
    removed: list[Path] = []

    for root in (config.config_dir / SESSIONS_DIR_NAME, HOST_TEMP_BUILD_DIR, HOST_TEMP_RUN_DIR):
        try:
            for path in root.iterdir():
                timestamp = parse_timestamped_dir_name(path)

                if not timestamp:
                    continue

                if timestamp < cutoff:
                    remove_path(path)
                    removed.append(path)
        except OSError:
            continue

    return removed
