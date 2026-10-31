"""Tests for claudebox.agent_session.orchestration.tool_output - file retrieval."""

from __future__ import annotations

import pytest

from claudebox.agent_session.orchestration.errors import ToolOutputNotFound
from claudebox.agent_session.orchestration.tool_output import ToolOutput, ToolOutputContent
from claudebox.workspace import Workspace


@pytest.fixture
def _local_sdk_projects(tmp_workspace, monkeypatch):
    """Point this process's Claude folder into tmp_workspace, the way a container's is mounted."""

    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_workspace / ".claude"))


def _tool_results_dir(tmp_workspace, session_id: str):
    """Plant the session's transcript in a folder named as the CLI names a project directory."""

    folder = tmp_workspace / ".claude" / "projects" / "-home-dev-my-app"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{session_id}.jsonl").write_text("{}\n")
    tool_results = folder / session_id / "tool-results"
    tool_results.mkdir(parents=True)

    return tool_results


@pytest.mark.usefixtures("_local_sdk_projects")
class TestToolOutputGetContent:
    """Test tool output file reading with truncation."""

    def _setup(self, tmp_workspace, session_id="sid", tool_use_id="toolu_abc"):
        """Create workspace, session, and tool output file."""

        ws = Workspace(start_dir=tmp_workspace)
        path = _tool_results_dir(tmp_workspace, session_id) / f"{tool_use_id}.txt"

        return ToolOutput(ws), path

    def test_reads_content(self, tmp_workspace):
        to, path = self._setup(tmp_workspace)
        path.write_text("hello world")

        result = to.get_content("sid", "toolu_abc")
        assert isinstance(result, ToolOutputContent)
        assert result.content == "hello world"
        assert result.truncated is False
        assert result.total_size == 11

    def test_truncation(self, tmp_workspace):
        to, path = self._setup(tmp_workspace)
        path.write_text("x" * 200)

        result = to.get_content("sid", "toolu_abc", max_size=50)
        assert len(result.content) == 50
        assert result.truncated is True
        assert result.total_size == 200

    def test_missing_file_raises(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        to = ToolOutput(ws)

        with pytest.raises(ToolOutputNotFound):
            to.get_content("sid", "nonexistent")


@pytest.mark.usefixtures("_local_sdk_projects")
class TestToolOutputGetPath:
    """Test tool output path resolution."""

    def test_returns_path(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        expected = _tool_results_dir(tmp_workspace, "sid") / "toolu_abc.txt"
        expected.write_text("")

        to = ToolOutput(ws)
        assert to.get_path("sid", "toolu_abc") == expected

    def test_missing_file_raises(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        to = ToolOutput(ws)

        with pytest.raises(ToolOutputNotFound):
            to.get_path("sid", "nonexistent")
