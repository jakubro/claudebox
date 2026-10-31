"""Workspace context for managing Claude SDK workspaces and sessions."""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from pathspec import PathSpec

from .constants import CONFIG_DIR_NAME, HOST_CLAUDE_DIR_SUBPATH
from .paths import (
    find_session_dir,
    get_sessions_root,
    get_workspace_root,
    parse_session_dir_name,
)


if TYPE_CHECKING:
    from .session.session import Session


class Workspace:
    """Resolved workspace: `path` is the workspace root; `sessions_root` is `.claudebox/sessions/`."""

    def __init__(self, start_dir: str | Path | None = None):
        """Initialize workspace from start_dir or CLAUDEBOX_PWD, finding .workspace marker."""

        start_dir = Path(start_dir or os.environ["CLAUDEBOX_PWD"])

        self.path = get_workspace_root(start_dir) or start_dir
        self.sessions_root = get_sessions_root(start_dir)

    @property
    def name(self) -> str:
        """Workspace directory name."""

        return self.path.name

    def list_sessions(self) -> Iterable[Session]:
        """Yield Session objects for each session directory in workspace."""

        from .session.session import Session

        if not self.sessions_root.exists() or not self.sessions_root.is_dir():
            return

        for session_dir in self.sessions_root.iterdir():
            if not session_dir.is_dir():
                continue

            _, session_id = parse_session_dir_name(session_dir)

            if not session_id:
                continue

            yield Session(session_id, workspace=self, _session_dir=session_dir)

    def find_session(self, session_id: str) -> Session | None:
        """Find existing session by ID, or None if not found."""

        from .session.session import Session

        session_dir = find_session_dir(self.path, session_id)

        if session_dir is None:
            return None

        return Session(session_id, workspace=self, _session_dir=session_dir)

    def ensure_session(self, session_id: str) -> Session:
        """Find existing session or create new timestamped directory."""

        from .session.session import Session

        return Session(session_id, workspace=self)

    # Ignore Patterns

    def collect_ignore_patterns(self) -> list[str]:
        """Collect ignore patterns from .ignore file in workspace."""

        ignore_path = self.path / ".ignore"

        if ignore_path.exists():
            return ignore_path.read_text().splitlines()

        return []

    def build_ignore_spec(self) -> PathSpec:
        """Build PathSpec from the workspace .ignore file."""

        patterns = self.collect_ignore_patterns()

        return PathSpec.from_lines("gitignore", patterns)

    # SDK Paths

    @property
    def sdk_projects_root(self) -> Path:
        """Root directory for Claude SDK project data under workspace config."""

        return self.path / CONFIG_DIR_NAME / HOST_CLAUDE_DIR_SUBPATH / "projects"


def claude_projects_root() -> Path:
    """Return this process's Claude projects folder, under `$CLAUDE_CONFIG_DIR` else `~/.claude`."""

    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"


def find_sdk_transcript(projects_root: Path, session_id: str) -> Path | None:
    """Return the `<session_id>.jsonl` under any project folder of `projects_root`, or None.

    Found by id, as the CLI finds it, because the folder name is the CLI's to choose.
    """

    if not projects_root.is_dir():
        return None

    for project in sorted(projects_root.iterdir()):
        transcript = project / f"{session_id}.jsonl"

        if transcript.is_file():
            return transcript

    return None
