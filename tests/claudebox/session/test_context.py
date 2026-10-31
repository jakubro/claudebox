"""Tests for claudebox.session - session context and path derivation."""

from __future__ import annotations

from claudebox.session.session import Session
from claudebox.workspace import Workspace


class TestSessionPaths:
    """Test session path property derivation."""

    def test_temp_dir(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("test-session")
        assert session.temp_dir == session.path / "tmp"

    def test_sdk_session_dir_sits_beside_the_transcript(self, tmp_workspace, tmp_path, monkeypatch):
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "cfg"))
        folder = tmp_path / "cfg" / "projects" / "-home-dev-my-app"
        folder.mkdir(parents=True)
        (folder / "test-session.jsonl").write_text("{}\n")
        session = Workspace(start_dir=tmp_workspace).ensure_session("test-session")

        assert session.sdk_session_dir == folder / "test-session"

    def test_sdk_session_dir_is_none_without_a_transcript(
        self,
        tmp_workspace,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "cfg"))
        session = Workspace(start_dir=tmp_workspace).ensure_session("test-session")

        assert session.sdk_session_dir is None


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
