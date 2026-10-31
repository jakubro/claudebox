"""Tool output - file retrieval from SDK storage."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .errors import ToolOutputNotFound
from ...constants import MAX_TOOL_OUTPUT_SIZE
from ...workspace import Workspace


@dataclass
class ToolOutputContent:
    """Content read from a persisted tool output file. `total_size` is the untruncated size in bytes."""

    content: str
    truncated: bool
    total_size: int


class ToolOutput:
    """Read persisted tool output files from SDK storage."""

    def __init__(self, workspace: Workspace):
        self._workspace = workspace

    def get_content(
        self,
        session_id: str,
        tool_use_id: str,
        max_size: int = MAX_TOOL_OUTPUT_SIZE,
    ) -> ToolOutputContent:
        """Read persisted tool output file; raises `ToolOutputNotFound` if it does not exist."""

        path = self.get_path(session_id, tool_use_id)
        size = path.stat().st_size

        with open(path, encoding="utf-8", errors="replace") as f:
            content = f.read(max_size)

        return ToolOutputContent(
            content=content,
            truncated=size > max_size,
            total_size=size,
        )

    def get_path(self, session_id: str, tool_use_id: str) -> Path:
        """Get path to persisted tool output file; raises `ToolOutputNotFound` if it does not exist."""

        session_dir = self._workspace.ensure_session(session_id).sdk_session_dir
        path = session_dir / "tool-results" / f"{tool_use_id}.txt" if session_dir else None

        if path is None or not path.exists():
            raise ToolOutputNotFound(session_id=session_id, tool_use_id=tool_use_id)

        return path
