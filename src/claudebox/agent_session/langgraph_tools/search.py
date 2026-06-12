"""Search tools - glob, grep.

glob walks the workspace path; grep wraps a ripgrep subprocess so the
Claude -> LangGraph habit transfer keeps the same flag surface. Output capped
at 100 KB; result list capped at 1 000 entries.
"""

import subprocess

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext


_GLOB_RESULT_CAP = 1_000
_GREP_OUTPUT_CAP = 100 * 1024
_GREP_TRUNCATED = "\n... (output truncated at 100 KB)\n"


def make_search_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind glob + grep tools closed over the workspace_path."""

    workspace_path = ctx.workspace_path

    @tool
    def glob(pattern: str) -> list[str]:
        """List paths under the workspace matching the glob `pattern`.

        Results sorted newest-first by mtime; capped at 1 000 entries. Use shell
        glob syntax (e.g. "**/*.py" for recursive).
        """

        matches = list(workspace_path.rglob(pattern))
        matches.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)

        return [str(p) for p in matches[:_GLOB_RESULT_CAP]]

    @tool
    def grep(
        pattern: str,
        path: str = ".",
        output_mode: str = "content",
        glob: str | None = None,
        type: str | None = None,
        i: bool = False,
        n: bool = False,
        A: int | None = None,
        B: int | None = None,
        C: int | None = None,
        multiline: bool = False,
        head_limit: int | None = None,
    ) -> str:
        """Search files for `pattern` using ripgrep semantics.

        `output_mode`: "content" (default, prints matches), "files_with_matches"
        (just filenames), or "count" (match-count per file). Flags follow rg:
        `i` case-insensitive, `n` line numbers, `A`/`B`/`C` after/before/context
        lines, `multiline` enables across-line patterns, `head_limit` caps the
        number of result lines, `glob` filters by file pattern, `type` filters
        by language. Output capped at 100 KB.
        """

        argv: list[str] = ["rg", pattern, path]

        if output_mode == "files_with_matches":
            argv.append("--files-with-matches")
        elif output_mode == "count":
            argv.append("--count")

        if glob is not None:
            argv.extend(["--glob", glob])

        if type is not None:
            argv.extend(["--type", type])

        if i:
            argv.append("-i")

        if n:
            argv.append("-n")

        if A is not None:
            argv.extend(["-A", str(A)])

        if B is not None:
            argv.extend(["-B", str(B)])

        if C is not None:
            argv.extend(["-C", str(C)])

        if multiline:
            argv.append("--multiline")

        try:
            result = subprocess.run(  # noqa: S603 - argv is constructed from typed args
                argv,
                capture_output=True,
                text=True,
                cwd=str(workspace_path),
                check=False,
            )
        except FileNotFoundError as exc:
            raise ToolException("grep: ripgrep ('rg') not installed in container.") from exc

        output = result.stdout

        if head_limit is not None:
            output = "\n".join(output.splitlines()[:head_limit])

        if len(output) > _GREP_OUTPUT_CAP:
            output = output[:_GREP_OUTPUT_CAP] + _GREP_TRUNCATED

        return output

    return [glob, grep]
