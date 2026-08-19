"""Shell tool - bash. Timeout errors flow through ToolException so tool_result.is_error=True."""

import subprocess

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext


_BASH_OUTPUT_CAP = 100 * 1024
_BASH_TIMEOUT_DEFAULT = 60
_BASH_TIMEOUT_CAP = 300
_TRUNCATED = "\n... (truncated at 100 KB)\n"


def make_shell_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind bash tool closed over the workspace cwd."""

    cwd = str(ctx.workspace_path)

    @tool
    def bash(
        command: str,
        description: str = "",
        timeout_seconds: int = _BASH_TIMEOUT_DEFAULT,
    ) -> dict:
        """Run `command` through /bin/bash -c with `timeout_seconds` (default 60, max 300).

        `description` is shown to the user in place of the raw command; it has no effect on execution.

        Returns `stdout`/`stderr` (capped at 100 KB, tail marker appended) and `exit_code`.
        cwd is the workspace path; the container is the only isolation boundary.
        """

        effective_timeout = min(max(1, timeout_seconds), _BASH_TIMEOUT_CAP)

        try:
            result = subprocess.run(
                ["/bin/bash", "-c", command],
                capture_output=True,
                text=True,
                cwd=cwd,
                timeout=effective_timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ToolException(
                f"bash: command timed out after {effective_timeout}s: {command!r}",
            ) from exc

        stdout = result.stdout

        if len(stdout) > _BASH_OUTPUT_CAP:
            stdout = stdout[:_BASH_OUTPUT_CAP] + _TRUNCATED

        stderr = result.stderr

        if len(stderr) > _BASH_OUTPUT_CAP:
            stderr = stderr[:_BASH_OUTPUT_CAP] + _TRUNCATED

        return {"stdout": stdout, "stderr": stderr, "exit_code": result.returncode}

    return [bash]
