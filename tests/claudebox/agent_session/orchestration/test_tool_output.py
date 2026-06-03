"""Tests for claudebox.agent_session.orchestration.tool_output — file retrieval."""

import pytest

from claudebox.agent_session.orchestration.errors import ToolOutputNotFound
from claudebox.agent_session.orchestration.tool_output import ToolOutput, ToolOutputContent
from claudebox.workspace import Workspace


@pytest.fixture
def _local_sdk_projects(tmp_workspace, monkeypatch):
    """Redirect sdk_projects_root into tmp_workspace to avoid writing to ~/.claude/."""

    monkeypatch.setattr(
        Workspace,
        "sdk_projects_root",
        property(lambda self: tmp_workspace / ".claude" / "projects"),
    )


@pytest.mark.usefixtures("_local_sdk_projects")
class TestToolOutputGetContent:
    """Test tool output file reading with truncation."""

    def _setup(self, tmp_workspace, session_id="sid", tool_use_id="toolu_abc"):
        """Create workspace, session, and tool output file."""

        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session(session_id)

        tool_results_dir = session.sdk_tool_results_dir
        tool_results_dir.mkdir(parents=True, exist_ok=True)
        path = tool_results_dir / f"{tool_use_id}.txt"

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
        session = ws.ensure_session("sid")

        tool_results_dir = session.sdk_tool_results_dir
        tool_results_dir.mkdir(parents=True, exist_ok=True)
        (tool_results_dir / "toolu_abc.txt").write_text("")

        to = ToolOutput(ws)
        path = to.get_path("sid", "toolu_abc")
        assert path.name == "toolu_abc.txt"
        assert "tool-results" in str(path)

    def test_missing_file_raises(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        to = ToolOutput(ws)

        with pytest.raises(ToolOutputNotFound):
            to.get_path("sid", "nonexistent")
