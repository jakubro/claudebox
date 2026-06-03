"""Tests for claudebox._paths — workspace discovery and session naming."""

from datetime import UTC, datetime
from unittest.mock import patch

from claudebox.paths import (
    get_session_dir,
    get_sessions_root,
    get_workspace_root,
    make_session_dir_name,
    parse_session_dir_name,
)


# --- get_workspace_root ---


class TestGetWorkspaceRoot:
    """Test .workspace marker discovery."""

    def test_finds_marker_in_start_dir(self, tmp_workspace):
        assert get_workspace_root(tmp_workspace) == tmp_workspace

    def test_finds_marker_from_subdirectory(self, tmp_workspace):
        subdir = tmp_workspace / "src" / "deep"
        subdir.mkdir(parents=True)
        assert get_workspace_root(subdir) == tmp_workspace

    def test_returns_none_without_marker(self, tmp_path, monkeypatch):
        # Constrain walk to tmp_path only — prevents finding host .workspace markers
        monkeypatch.setattr("claudebox.paths.walk_up", lambda *_a, **_kw: [tmp_path])
        assert get_workspace_root(tmp_path) is None


# --- parse_session_dir_name / make_session_dir_name ---


class TestParseSessionDirName:
    """Test session directory name parsing."""

    def test_roundtrip(self):
        name = "20260308-120000--abc123"
        ts, session_id = parse_session_dir_name(name)
        assert session_id == "abc123"
        assert ts == datetime(2026, 3, 8, 12, 0, 0, tzinfo=UTC)

    def test_session_id_with_dashes(self):
        name = "20260308-120000--abc-def-123"
        _, session_id = parse_session_dir_name(name)
        assert session_id == "abc-def-123"

    def test_malformed_no_separator_returns_none(self):
        assert parse_session_dir_name("noseparator") == (None, None)


class TestMakeSessionDirName:
    """Test session directory name generation."""

    def test_format(self):
        with patch("claudebox.paths.get_timestamp", return_value="20260308-120000"):
            name = make_session_dir_name("abc123")
        assert name == "20260308-120000--abc123"

    def test_contains_session_id(self):
        name = make_session_dir_name("test-id")
        assert "test-id" in name
        assert "--" in name


# --- get_session_dir ---


class TestGetSessionDir:
    """Test session directory lookup and creation."""

    def test_creates_new_session_dir(self, tmp_workspace):
        session_dir = get_session_dir(tmp_workspace, "new-session")
        assert session_dir.exists()
        assert "new-session" in session_dir.name

    def test_finds_existing_session_dir(self, tmp_workspace):
        sessions_root = get_sessions_root(tmp_workspace)
        existing = sessions_root / "20260101-120000--existing-id"
        existing.mkdir(parents=True)

        found = get_session_dir(tmp_workspace, "existing-id")
        assert found == existing


# --- get_sessions_root ---


class TestGetSessionsRoot:
    """Test sessions root directory resolution."""

    def test_creates_sessions_dir(self, tmp_workspace):
        root = get_sessions_root(tmp_workspace)
        assert root.exists()
        assert root == tmp_workspace / ".claudebox" / "sessions"
