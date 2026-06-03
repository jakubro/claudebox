"""Session context for managing Claude SDK session directories and paths."""

from pathlib import Path
from typing import TYPE_CHECKING

from ..paths import get_session_dir, parse_session_dir_name


if TYPE_CHECKING:
    from ..workspace import Workspace


class Session:
    """Single session context with resolved directory and SDK paths.

    Attributes:
        workspace: The parent Workspace instance.
        id: Unique identifier.
        path: Session directory path under .claudebox/sessions/.
        start_time: When the session was created.
    """

    def __init__(
        self,
        session_id: str,
        *,
        workspace: "Workspace | None" = None,
        start_dir: str | Path | None = None,
        _session_dir: Path | None = None,
    ):
        """Initialize session, creating workspace if not provided."""

        from ..workspace import Workspace

        self.workspace = workspace or Workspace(start_dir=start_dir)

        self.id = session_id
        self.path = _session_dir or get_session_dir(self.workspace.path, self.id)
        self.start_time, _ = parse_session_dir_name(self.path)

    @property
    def temp_dir(self) -> Path:
        """Temporary directory for session-specific files: {session_path}/tmp/."""

        return self.path / "tmp"

    # SDK Paths
    # ----------------------------------------------------------------------------------------------

    @property
    def sdk_session_dir(self) -> Path:
        """SDK session directory: ~/.claude/projects/{hash}/{session_id}/."""

        return self.workspace.sdk_project_dir / self.id

    @property
    def sdk_tool_results_dir(self) -> Path:
        """SDK tool results directory: ~/.claude/projects/{hash}/{session_id}/tool-results/."""

        return self.sdk_session_dir / "tool-results"

    def sdk_tool_output_path(self, tool_use_id: str) -> Path:
        """Path to tool output file: {sdk_tool_results_dir}/{tool_use_id}.txt"""

        return self.sdk_tool_results_dir / f"{tool_use_id}.txt"
