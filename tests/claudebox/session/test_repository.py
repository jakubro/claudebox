"""Tests for claudebox.session.repository — shared session disk I/O."""

import json
from datetime import datetime

import pytest

from claudebox.core.io import write_json
from claudebox.session.models import SessionMetadata, SessionNotFound
from claudebox.session.repository import SessionRepository
from claudebox.workspace import Workspace


@pytest.fixture
def workspace(tmp_workspace):
    """Create a workspace with sessions directory."""

    return Workspace(start_dir=tmp_workspace)


@pytest.fixture
def repo(workspace):
    """Create a SessionRepository backed by the test workspace."""

    return SessionRepository(workspace)


def _create_session_dir(workspace, session_id, data=None):
    """Create a session directory with optional session.json."""

    sessions_root = workspace.sessions_root
    sessions_root.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    session_dir = sessions_root / f"{ts}--{session_id}"
    session_dir.mkdir()

    if data is not None:
        write_json(session_dir / "session.json", data)

    return session_dir


class TestListAll:
    """Test SessionRepository.list_all."""

    def test_empty_workspace(self, repo):
        assert repo.list_all() == []

    def test_lists_sessions_with_json(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1", "name": "first"})
        _create_session_dir(workspace, "sid2", {"session_id": "sid2", "name": "second"})

        result = repo.list_all()
        assert len(result) == 2
        assert all(isinstance(r, SessionMetadata) for r in result)

    def test_skips_missing_session_json(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})
        _create_session_dir(workspace, "sid2")  # no session.json

        result = repo.list_all()
        assert len(result) == 1
        assert result[0].session_id == "sid1"

    def test_sorted_by_updated_at_desc(self, repo, workspace):
        _create_session_dir(
            workspace,
            "old",
            {"session_id": "old", "updated_at": "2026-01-01T00:00:00"},
        )
        _create_session_dir(
            workspace,
            "new",
            {"session_id": "new", "updated_at": "2026-03-01T00:00:00"},
        )

        result = repo.list_all()
        assert result[0].session_id == "new"
        assert result[1].session_id == "old"

    def test_falls_back_to_started_at_for_sorting(self, repo, workspace):
        _create_session_dir(
            workspace,
            "old",
            {"session_id": "old", "started_at": "2026-01-01T00:00:00"},
        )
        _create_session_dir(
            workspace,
            "new",
            {"session_id": "new", "started_at": "2026-03-01T00:00:00"},
        )

        result = repo.list_all()
        assert result[0].session_id == "new"
        assert result[1].session_id == "old"

    def test_defaults_session_id_from_dir(self, repo, workspace):
        _create_session_dir(workspace, "from-dir", {"name": "no explicit id"})

        result = repo.list_all()
        assert len(result) == 1
        assert result[0].session_id == "from-dir"


class TestGet:
    """Test SessionRepository.get."""

    def test_get_existing(self, repo, workspace):
        _create_session_dir(
            workspace,
            "sid1",
            {"session_id": "sid1", "name": "test", "num_turns": 5},
        )

        result = repo.get("sid1")
        assert isinstance(result, SessionMetadata)
        assert result.session_id == "sid1"
        assert result.name == "test"
        assert result.num_turns == 5

    def test_get_missing_raises(self, repo):
        with pytest.raises(SessionNotFound) as exc_info:
            repo.get("nonexistent")

        assert exc_info.value.session_id == "nonexistent"

    def test_get_null_json_raises(self, repo, workspace):
        _create_session_dir(workspace, "empty", None)
        session_dir = workspace.ensure_session("empty").path
        write_json(session_dir / "session.json", None)

        with pytest.raises(SessionNotFound):
            repo.get("empty")


class TestUpdate:
    """Test SessionRepository.update."""

    def test_update_single_field(self, repo, workspace):
        session_dir = _create_session_dir(
            workspace,
            "sid1",
            {"session_id": "sid1", "name": "old"},
        )

        result = repo.update("sid1", name="new")
        assert result.name == "new"

        # Verify on disk
        data = json.loads((session_dir / "session.json").read_text())
        assert data["name"] == "new"

    def test_update_preserves_unknown_keys(self, repo, workspace):
        session_dir = _create_session_dir(
            workspace,
            "sid1",
            {
                "session_id": "sid1",
                "name": "test",
                "permission_mode": "auto",
                "todos": [{"text": "do stuff"}],
            },
        )

        repo.update("sid1", name="updated")

        # Unknown keys (web-specific) must be preserved
        data = json.loads((session_dir / "session.json").read_text())
        assert data["name"] == "updated"
        assert data["permission_mode"] == "auto"
        assert data["todos"] == [{"text": "do stuff"}]

    def test_update_missing_raises(self, repo):
        with pytest.raises(SessionNotFound):
            repo.update("nonexistent", name="test")

    def test_update_returns_typed_metadata(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})

        result = repo.update("sid1", name="typed")
        assert isinstance(result, SessionMetadata)
        assert result.name == "typed"

    def test_update_multiple_fields(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})

        result = repo.update("sid1", name="updated", num_turns=10)
        assert result.name == "updated"
        assert result.num_turns == 10
