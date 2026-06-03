"""Tests for claudebox.session — session context and path derivation."""

from claudebox.session.session import Session
from claudebox.workspace import Workspace


class TestSessionPaths:
    """Test session path property derivation."""

    def test_temp_dir(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("test-session")
        assert session.temp_dir == session.path / "tmp"

    def test_sdk_session_dir(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("test-session")
        assert session.sdk_session_dir == ws.sdk_project_dir / "test-session"

    def test_sdk_tool_results_dir(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("test-session")
        expected = ws.sdk_project_dir / "test-session" / "tool-results"
        assert session.sdk_tool_results_dir == expected

    def test_sdk_tool_output_path(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("test-session")
        path = session.sdk_tool_output_path("toolu_abc123")
        assert path.name == "toolu_abc123.txt"
        assert "tool-results" in str(path)


class TestSessionInit:
    """Test session initialization."""

    def test_creates_workspace_from_start_dir(self, tmp_workspace):
        session = Session("sid", start_dir=tmp_workspace)
        assert session.workspace.path == tmp_workspace

    def test_uses_provided_workspace(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = Session("sid", workspace=ws)
        assert session.workspace is ws

    def test_start_time_parsed(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("test-id")
        assert session.start_time is not None
        assert session.id == "test-id"
