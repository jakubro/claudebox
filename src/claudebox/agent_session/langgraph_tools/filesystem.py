"""Filesystem tools - read_file, write_file, edit_file.

No path containment (container is the isolation boundary). edit_file mirrors
Claude's strict semantics: old_string must occur exactly once unless
replace_all=True; preserves surrounding whitespace; raises with diff-context
on miss. Habit transfer from Claude -> LangGraph is the goal.
"""

from pathlib import Path

from langchain_core.tools import BaseTool, tool

from ._context import ToolContext


def make_filesystem_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind read_file, write_file, edit_file as @tool functions."""

    @tool
    def read_file(path: str) -> str:
        """Read the full text content of a file at `path`."""

        return Path(path).resolve().read_text()

    @tool
    def write_file(path: str, content: str) -> str:
        """Write `content` to `path`, creating parent directories as needed.

        Returns a short status string with the byte count written.
        """

        resolved = Path(path).resolve()
        resolved.parent.mkdir(parents=True, exist_ok=True)
        written = resolved.write_text(content)

        return f"Wrote {written} bytes to {resolved}"

    @tool
    def edit_file(
        path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> str:
        """Replace `old_string` with `new_string` in the file at `path`.

        Strict semantics: `old_string` must occur exactly once in the file. If
        it appears multiple times and `replace_all` is False, raises with a
        match-count error. If it appears zero times, raises a not-found error.
        Set `replace_all=True` to replace every occurrence at once. Surrounding
        whitespace is preserved verbatim.
        """

        resolved = Path(path).resolve()
        original = resolved.read_text()

        count = original.count(old_string)

        if count == 0:
            raise ValueError(f"edit_file: old_string not found in {resolved}")

        if count > 1 and not replace_all:
            raise ValueError(
                f"edit_file: old_string occurs {count} times in {resolved}; "
                f"pass replace_all=True to replace every occurrence."
            )

        updated = (
            original.replace(old_string, new_string)
            if replace_all
            else original.replace(old_string, new_string, 1)
        )
        resolved.write_text(updated)
        replaced = count if replace_all else 1

        return f"Replaced {replaced} occurrence(s) in {resolved}"

    return [read_file, write_file, edit_file]
