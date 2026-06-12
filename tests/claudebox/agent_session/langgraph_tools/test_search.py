"""search.py @tool tests - glob, grep."""

import subprocess
from unittest.mock import patch

import pytest

from claudebox.agent_session.langgraph_tools.search import make_search_tools


def _tools(tool_ctx):
    by_name = {tool_obj.name: tool_obj for tool_obj in make_search_tools(tool_ctx)}

    return by_name["glob"], by_name["grep"]


class TestGlob:
    def test_returns_matches_relative_to_workspace(self, tool_ctx, tmp_path):
        (tmp_path / "a.py").write_text("x")
        (tmp_path / "b.txt").write_text("y")
        glob, _ = _tools(tool_ctx)

        result = glob.invoke({"pattern": "*.py"})

        assert any(p.endswith("a.py") for p in result)
        assert not any(p.endswith("b.txt") for p in result)

    def test_recursive_pattern(self, tool_ctx, tmp_path):
        (tmp_path / "nested").mkdir()
        (tmp_path / "nested" / "deep.py").write_text("x")
        glob, _ = _tools(tool_ctx)

        result = glob.invoke({"pattern": "**/*.py"})

        assert any(p.endswith("deep.py") for p in result)

    def test_sorted_newest_first(self, tool_ctx, tmp_path):
        old = tmp_path / "old.py"
        old.write_text("o")
        new = tmp_path / "new.py"
        new.write_text("n")
        import os

        os.utime(old, (1000, 1000))
        os.utime(new, (2000, 2000))
        glob, _ = _tools(tool_ctx)

        result = glob.invoke({"pattern": "*.py"})

        assert result[0].endswith("new.py")
        assert result[1].endswith("old.py")


class TestGrep:
    def test_argv_includes_pattern_and_path(self, tool_ctx):
        _, grep = _tools(tool_ctx)
        fake = subprocess.CompletedProcess(args=["rg"], returncode=0, stdout="match\n", stderr="")

        with patch("subprocess.run", return_value=fake) as mock_run:
            grep.invoke({"pattern": "def foo", "path": "./src"})

        argv = mock_run.call_args.args[0]
        assert argv[0] == "rg"
        assert "def foo" in argv
        assert "./src" in argv

    def test_argv_flag_mapping(self, tool_ctx):
        _, grep = _tools(tool_ctx)
        fake = subprocess.CompletedProcess(args=["rg"], returncode=0, stdout="", stderr="")

        with patch("subprocess.run", return_value=fake) as mock_run:
            grep.invoke(
                {
                    "pattern": "x",
                    "i": True,
                    "n": True,
                    "A": 2,
                    "glob": "*.py",
                    "output_mode": "count",
                }
            )

        argv = mock_run.call_args.args[0]
        assert "-i" in argv
        assert "-n" in argv
        assert "-A" in argv and "2" in argv
        assert "--glob" in argv and "*.py" in argv
        assert "--count" in argv

    def test_missing_rg_raises_tool_exception(self, tool_ctx, tmp_path):
        _, grep = _tools(tool_ctx)

        with patch("subprocess.run", side_effect=FileNotFoundError("rg")):
            with pytest.raises(Exception, match="ripgrep"):
                grep.invoke({"pattern": "x"})

    def test_output_truncated_at_cap(self, tool_ctx, tmp_path):
        _, grep = _tools(tool_ctx)
        oversized = "x" * (200 * 1024)
        fake = subprocess.CompletedProcess(args=["rg"], returncode=0, stdout=oversized, stderr="")

        with patch("subprocess.run", return_value=fake):
            result = grep.invoke({"pattern": "x"})

        assert "truncated at 100 KB" in result
        assert len(result) < 200 * 1024
