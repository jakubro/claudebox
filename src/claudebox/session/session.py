"""Session context for managing Claude SDK session directories and paths."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from ..paths import get_session_dir, parse_session_dir_name
from ..workspace import claude_projects_root, find_sdk_transcript


if TYPE_CHECKING:
    from ..workspace import Workspace


class Session:
    """Single session context with resolved directory and SDK paths.

    ``path`` is the session directory under .claudebox/sessions/.
    """

    def __init__(
        self,
        session_id: str,
        *,
        workspace: Workspace | None = None,
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

    @property
    def sdk_session_dir(self) -> Path | None:
        """The SDK's folder for this session, beside its transcript; None without a transcript."""

        transcript = find_sdk_transcript(claude_projects_root(), self.id)

        return transcript.with_suffix("") if transcript else None
