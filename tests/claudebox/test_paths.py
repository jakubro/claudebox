"""Tests for claudebox._paths - workspace discovery and session naming."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from claudebox.paths import (
    InvalidSessionId,
    find_session_dir,
    get_session_dir,
    get_sessions_root,
    get_workspace_root,
    make_session_dir_name,
    parse_session_dir_name,
    validate_session_id,
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
        # Constrain walk to tmp_path only - prevents finding host .workspace markers
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


# --- validate_session_id ---


class TestValidateSessionId:
    """Test the accepted session id shape - letters, digits, dash, underscore, dot."""

    @pytest.mark.parametrize(
        "session_id",
        [
            "550e8400-e29b-41d4-a716-446655440000",  # uuid4, the generator's own format
            "abc123",
            "a" * 128,  # exactly at the length bound
        ],
    )
    def test_accepts_every_shape_the_product_mints(self, session_id):
        validate_session_id(session_id)  # raises on rejection - no assertion needed

    @pytest.mark.parametrize(
        "session_id",
        [
            "sess-*",  # glob wildcard
            "sess-?",  # glob single-char wildcard
            "../evil",  # parent reference
            "sub/dir",  # path separator
            ".hidden",  # leading dot
            "a" * 129,  # over the length bound
            "",
        ],
    )
    def test_refuses_everything_else(self, session_id):
        with pytest.raises(InvalidSessionId) as exc_info:
            validate_session_id(session_id)

        assert exc_info.value.session_id == session_id


# --- find_session_dir / get_session_dir ---


class TestFindSessionDir:
    """Test session directory lookup, including refusal of a malformed id."""

    def test_finds_existing_session_dir(self, tmp_workspace):
        sessions_root = get_sessions_root(tmp_workspace)
        existing = sessions_root / "20260101-120000--existing-id"
        existing.mkdir(parents=True)

        assert find_session_dir(tmp_workspace, "existing-id") == existing

    def test_returns_none_for_a_well_formed_id_that_does_not_exist(self, tmp_workspace):
        assert find_session_dir(tmp_workspace, "never-created") is None

    def test_a_pattern_bearing_id_refuses_rather_than_matching_a_neighbour(self, tmp_workspace):
        sessions_root = get_sessions_root(tmp_workspace)
        (sessions_root / "20260101-120000--session-1").mkdir(parents=True)
        (sessions_root / "20260101-120001--session-2").mkdir(parents=True)

        with pytest.raises(InvalidSessionId):
            find_session_dir(tmp_workspace, "session-*")

    def test_the_glob_is_escaped_even_if_validation_is_bypassed(self, tmp_workspace, monkeypatch):
        """Defence in depth: escaping holds even if the shape check is relaxed or bypassed later."""

        sessions_root = get_sessions_root(tmp_workspace)
        (sessions_root / "20260101-120000--session-1").mkdir(parents=True)
        (sessions_root / "20260101-120001--session-2").mkdir(parents=True)
        monkeypatch.setattr("claudebox.paths.validate_session_id", lambda _session_id: None)

        assert find_session_dir(tmp_workspace, "session-*") is None


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

    def test_a_separator_bearing_id_creates_nothing_outside_the_sessions_root(self, tmp_workspace):
        sessions_root = get_sessions_root(tmp_workspace)
        before = set(sessions_root.parent.rglob("*"))

        with pytest.raises(InvalidSessionId):
            get_session_dir(tmp_workspace, "sub/dir")

        assert set(sessions_root.parent.rglob("*")) == before

    def test_a_parent_reference_id_creates_nothing_outside_the_sessions_root(self, tmp_workspace):
        sessions_root = get_sessions_root(tmp_workspace)
        before = set(sessions_root.parent.rglob("*"))

        with pytest.raises(InvalidSessionId):
            get_session_dir(tmp_workspace, "../evil")

        assert set(sessions_root.parent.rglob("*")) == before


# --- get_sessions_root ---


class TestGetSessionsRoot:
    """Test sessions root directory resolution."""

    def test_creates_sessions_dir(self, tmp_workspace):
        root = get_sessions_root(tmp_workspace)
        assert root.exists()
        assert root == tmp_workspace / ".claudebox" / "sessions"
