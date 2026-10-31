"""Tests for claudebox.workspace - workspace context and session access."""

from __future__ import annotations

import pytest

from claudebox.workspace import Workspace, claude_projects_root, find_sdk_transcript


class TestWorkspaceInit:
    """Test workspace initialization from directory path."""

    def test_resolves_workspace_root(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace()
        assert ws.path == tmp_workspace

    def test_with_start_dir(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        assert ws.path == tmp_workspace

    def test_name_property(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        assert ws.name == tmp_workspace.name

    def test_sessions_root(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        assert ws.sessions_root == tmp_workspace / ".claudebox" / "sessions"


class TestIgnorePatterns:
    """Test .ignore file collection and PathSpec building."""

    def test_collect_empty(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        assert ws.collect_ignore_patterns() == []

    def test_collect_from_ignore_file(self, tmp_workspace):
        ignore_file = tmp_workspace / ".ignore"
        ignore_file.write_text("*.env\nnode_modules/\n")

        ws = Workspace(start_dir=tmp_workspace)
        patterns = ws.collect_ignore_patterns()
        assert "*.env" in patterns
        assert "node_modules/" in patterns

    def test_build_ignore_spec(self, tmp_workspace):
        ignore_file = tmp_workspace / ".ignore"
        ignore_file.write_text("*.env\nnode_modules/\n")

        ws = Workspace(start_dir=tmp_workspace)
        spec = ws.build_ignore_spec()
        assert spec.match_file(".env")
        assert spec.match_file("node_modules/package.json")
        assert not spec.match_file("src/main.py")

    def test_build_ignore_spec_empty(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        spec = ws.build_ignore_spec()
        assert not spec.match_file("anything.py")


class TestSdkPaths:
    """Test SDK project directory path computation."""

    def test_sdk_projects_root(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        expected = tmp_workspace / ".claudebox" / "fs" / "root" / ".claude" / "projects"
        assert ws.sdk_projects_root == expected


class TestFindSdkTranscript:
    """A transcript is found by session id in whatever project folder the CLI named."""

    @pytest.mark.parametrize(
        "cli_folder",
        [
            "-root-bh-my-app",
            "-root-bh-john-doe-site-com",
            "-root-bh-with-space",
            "-" + "a" * 199 + "-b8hxks",
        ],
    )
    def test_finds_the_transcript_in_the_cli_named_folder(self, tmp_path, cli_folder):
        transcript = tmp_path / "projects" / cli_folder / "sess-1.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text("{}\n")
        (tmp_path / "projects" / "-other-project").mkdir()

        assert find_sdk_transcript(tmp_path / "projects", "sess-1") == transcript

    def test_none_when_no_folder_holds_it(self, tmp_path):
        (tmp_path / "projects" / "-root-bh-my-app").mkdir(parents=True)

        assert find_sdk_transcript(tmp_path / "projects", "sess-1") is None

    def test_none_when_the_projects_root_is_absent(self, tmp_path):
        assert find_sdk_transcript(tmp_path / "missing", "sess-1") is None


class TestClaudeProjectsRoot:
    """The process's own Claude folder decides where the local backend's CLI writes."""

    def test_follows_claude_config_dir(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "cfg"))

        assert claude_projects_root() == tmp_path / "cfg" / "projects"

    def test_defaults_to_the_home_claude_folder(self, tmp_path, monkeypatch):
        monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
        monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: tmp_path))

        assert claude_projects_root() == tmp_path / ".claude" / "projects"


# --- list_sessions / ensure_session ---


class TestListSessions:
    """Test session listing from workspace."""

    def test_empty_sessions_dir(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        sessions = list(ws.list_sessions())
        assert sessions == []

    def test_lists_existing_sessions(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        sessions_root = ws.sessions_root
        sessions_root.mkdir(parents=True, exist_ok=True)

        (sessions_root / "20260101-120000--sid1").mkdir()
        (sessions_root / "20260102-120000--sid2").mkdir()

        sessions = list(ws.list_sessions())
        ids = {s.id for s in sessions}
        assert ids == {"sid1", "sid2"}

    def test_skips_non_directories(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        sessions_root = ws.sessions_root
        sessions_root.mkdir(parents=True, exist_ok=True)

        (sessions_root / "20260101-120000--sid1").mkdir()
        (sessions_root / "stray-file.txt").write_text("not a dir")

        sessions = list(ws.list_sessions())
        assert len(sessions) == 1

    def test_missing_sessions_dir(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        ws.sessions_root = tmp_workspace / ".claudebox" / "nonexistent"

        sessions = list(ws.list_sessions())
        assert sessions == []


class TestCreateSession:
    """Test session creation from workspace."""

    def test_creates_session(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        session = ws.ensure_session("new-sid")
        assert session.id == "new-sid"
        assert session.path.exists()

    def test_finds_existing_session(self, tmp_workspace):
        ws = Workspace(start_dir=tmp_workspace)
        sessions_root = ws.sessions_root
        sessions_root.mkdir(parents=True, exist_ok=True)
        existing = sessions_root / "20260101-120000--existing-sid"
        existing.mkdir()

        session = ws.ensure_session("existing-sid")
        assert session.path == existing
