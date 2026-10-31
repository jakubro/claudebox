"""Request context for Claude Code hooks."""

from __future__ import annotations

import os
from pathlib import Path

from ..constants import SESSION_RUN_ID_FILE, USER_LOG_FILENAME, profile_dir
from ..core.logging import configure_logging, get_logger, use_log_file
from ..workspace import Workspace


class Request:
    """Unified context for Claude Code hook execution.

    Combines workspace resolution, session management, and logging setup.
    """

    def __init__(self, session_id: str, start_dir: str | Path | None = None):
        """Initialize request context with workspace, session, and logging."""

        configure_logging()

        self.workspace = Workspace(start_dir=start_dir)
        self.session = self.workspace.ensure_session(session_id)
        self.logger = get_logger("claudebox")

        if run_id := os.environ.get("CLAUDEBOX_RUN_ID"):
            _record_run_id(self.session.path / SESSION_RUN_ID_FILE, run_id)

        use_log_file(self.session.path / USER_LOG_FILENAME)

    @property
    def profile_dir(self) -> Path:
        """User's claudebox profile directory: ~/.claudebox/profile/"""

        return profile_dir()


def _record_run_id(path: Path, run_id: str) -> None:
    if not path.is_file() or path.read_text(encoding="utf-8") != run_id:
        path.write_text(run_id, encoding="utf-8")
