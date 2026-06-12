"""shell.py @tool tests - bash."""

import subprocess
from unittest.mock import patch

import pytest

from claudebox.agent_session.langgraph_tools.shell import make_shell_tools


def _bash(tool_ctx):
    return make_shell_tools(tool_ctx)[0]


class TestBash:
    def test_runs_command_returns_dict(self, tool_ctx):
        bash = _bash(tool_ctx)

        result = bash.invoke({"command": "echo hello"})

        assert result["stdout"].strip() == "hello"
        assert result["exit_code"] == 0
        assert result["stderr"] == ""

    def test_non_zero_exit_code_propagated(self, tool_ctx):
        bash = _bash(tool_ctx)

        result = bash.invoke({"command": "exit 7"})

        assert result["exit_code"] == 7

    def test_cwd_is_workspace_path(self, tool_ctx, tmp_path):
        bash = _bash(tool_ctx)

        result = bash.invoke({"command": "pwd"})

        assert result["stdout"].strip() == str(tmp_path)

    def test_timeout_raises_tool_exception(self, tool_ctx):
        bash = _bash(tool_ctx)
        fake_timeout = subprocess.TimeoutExpired(cmd=["bash"], timeout=1)

        with patch("subprocess.run", side_effect=fake_timeout):
            with pytest.raises(Exception, match="timed out"):
                bash.invoke({"command": "sleep 99", "timeout_seconds": 1})

    def test_timeout_capped_at_300(self, tool_ctx):
        bash = _bash(tool_ctx)

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess(
                args=["bash"], returncode=0, stdout="", stderr=""
            )
            bash.invoke({"command": "true", "timeout_seconds": 9999})

            assert mock_run.call_args.kwargs["timeout"] == 300

    def test_stdout_truncated_at_cap(self, tool_ctx):
        bash = _bash(tool_ctx)
        oversized = "x" * (200 * 1024)
        fake = subprocess.CompletedProcess(args=["bash"], returncode=0, stdout=oversized, stderr="")

        with patch("subprocess.run", return_value=fake):
            result = bash.invoke({"command": "true"})

        assert "truncated at 100 KB" in result["stdout"]
        assert len(result["stdout"]) < 200 * 1024
