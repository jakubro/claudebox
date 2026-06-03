"""Request context for Claude Code hooks."""

from pathlib import Path

from ..constants import USER_LOG_FILENAME, profile_dir
from ..core.logging import configure_logging, get_logger, use_log_file
from ..workspace import Workspace


class Request:
    """Unified context for Claude Code hook execution.

    Combines workspace resolution, session management, and logging setup.

    Attributes:
        workspace: The resolved workspace containing the session.
        session: The active session with its directory paths.
        logger: Configured structlog logger for the hook.
    """

    def __init__(self, session_id: str, start_dir: str | Path | None = None):
        """Initialize request context with workspace, session, and logging."""

        configure_logging()

        self.workspace = Workspace(start_dir=start_dir)
        self.session = self.workspace.ensure_session(session_id)
        self.logger = get_logger("claudebox")

        use_log_file(self.session.path / USER_LOG_FILENAME)

    @property
    def profile_dir(self) -> Path:
        """User's claudebox profile directory: ~/.claudebox/profile/"""

        return profile_dir()
