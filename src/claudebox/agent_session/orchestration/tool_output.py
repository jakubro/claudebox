"""Tool output - file retrieval from SDK storage."""

from dataclasses import dataclass
from pathlib import Path

from .errors import ToolOutputNotFound
from ...constants import MAX_TOOL_OUTPUT_SIZE
from ...workspace import Workspace


@dataclass
class ToolOutputContent:
    """Content read from a persisted tool output file.

    Attributes:
        content: File content, possibly truncated.
        truncated: Whether content was truncated to max_size.
        total_size: Original file size in bytes.
    """

    content: str
    truncated: bool
    total_size: int


class ToolOutput:
    """Read persisted tool output files from SDK storage.

    Provides access to tool execution results that are stored separately from
    the main conversation to handle large outputs efficiently.

    Attributes:
        _workspace: Workspace for resolving session directories.
    """

    def __init__(self, workspace: Workspace):
        self._workspace = workspace

    def get_content(
        self,
        session_id: str,
        tool_use_id: str,
        max_size: int = MAX_TOOL_OUTPUT_SIZE,
    ) -> ToolOutputContent:
        """Read persisted tool output file.

        Raises ToolOutputNotFound if the file does not exist.
        """

        path = self._resolve_path(session_id, tool_use_id)

        if not path.exists():
            raise ToolOutputNotFound(session_id=session_id, tool_use_id=tool_use_id)

        size = path.stat().st_size

        with open(path, encoding="utf-8", errors="replace") as f:
            content = f.read(max_size)

        return ToolOutputContent(
            content=content,
            truncated=size > max_size,
            total_size=size,
        )

    def get_path(self, session_id: str, tool_use_id: str) -> Path:
        """Get path to persisted tool output file.

        Raises ToolOutputNotFound if the file does not exist.
        """

        path = self._resolve_path(session_id, tool_use_id)

        if not path.exists():
            raise ToolOutputNotFound(session_id=session_id, tool_use_id=tool_use_id)

        return path

    def _resolve_path(self, session_id: str, tool_use_id: str) -> Path:
        """Resolve path to tool output file without checking existence."""

        session = self._workspace.ensure_session(session_id)

        return session.sdk_tool_output_path(tool_use_id)
