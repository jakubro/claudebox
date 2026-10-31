"""Tests for claudebox.session.repository - shared session disk I/O."""

from __future__ import annotations

import json
import os
import shutil
from datetime import UTC, datetime
from time import time_ns
from unittest.mock import patch

import pytest

import claudebox.session.repository as repository_module
from claudebox.core.io import read_json, write_json
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
    """Create a session directory with optional session.json.

    `fork_point_cost_usd` auto-fills when missing - a required SessionMetadata field unrelated to most assertions.
    """

    sessions_root = workspace.sessions_root
    sessions_root.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    session_dir = sessions_root / f"{ts}--{session_id}"
    session_dir.mkdir()

    if data is not None:
        data = {"fork_point_cost_usd": 0.0, **data}
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

    def test_lists_the_automatic_name_beside_the_hand_given_one(self, repo, workspace):
        _create_session_dir(workspace, "s1", {"session_id": "s1", "auto_name": "Tuning the parser"})
        _create_session_dir(
            workspace,
            "s2",
            {"session_id": "s2", "name": "Mine", "auto_name": "Other"},
        )

        by_id = {s.session_id: s for s in repo.list_all()}

        assert (by_id["s1"].name, by_id["s1"].auto_name) == (None, "Tuning the parser")
        assert (by_id["s2"].name, by_id["s2"].auto_name) == ("Mine", "Other")

    def test_skips_missing_session_json(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})
        _create_session_dir(workspace, "sid2")  # no session.json

        result = repo.list_all()
        assert len(result) == 1
        assert result[0].session_id == "sid1"

    def test_skips_unreadable_session_json(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})
        corrupt = _create_session_dir(workspace, "sid2", {"session_id": "sid2"})
        (corrupt / "session.json").write_text('{"session_id": "sid')

        result = repo.list_all()
        assert [r.session_id for r in result] == ["sid1"]

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


class TestListAllRereadsOnlyChangedRecords:
    """A listing re-reads a session.json only when its stat changed since the last listing."""

    def test_an_unchanged_workspace_is_listed_without_reading_a_record(
        self,
        repo,
        workspace,
        monkeypatch,
    ):
        monkeypatch.setattr("claudebox.core.file_cache.time_ns", lambda: time_ns() + 3600 * 10**9)
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})
        _create_session_dir(workspace, "sid2", {"session_id": "sid2"})
        repo.list_all()

        with patch.object(repository_module, "read_json", wraps=read_json) as reads:
            result = repo.list_all()

        assert reads.call_count == 0
        assert sorted(r.session_id for r in result) == ["sid1", "sid2"]

    def test_a_same_size_rename_in_the_same_tick_shows_in_the_next_listing(
        self,
        repo,
        workspace,
        monkeypatch,
    ):
        monkeypatch.setattr("claudebox.core.file_cache.time_ns", lambda: time_ns() + 3600 * 10**9)
        session_dir = _create_session_dir(
            workspace,
            "sid1",
            {"session_id": "sid1", "fork_point_cost_usd": 0.0, "name": "alpha"},
        )
        record = session_dir / "session.json"
        repo.list_all()
        before = record.stat()

        repo.update("sid1", name="omega")
        os.utime(record, ns=(before.st_atime_ns, before.st_mtime_ns))

        assert [r.name for r in repo.list_all()] == ["omega"]

    def test_a_rewritten_record_is_reread(self, repo, workspace, monkeypatch):
        monkeypatch.setattr("claudebox.core.file_cache.time_ns", lambda: time_ns() + 3600 * 10**9)
        session_dir = _create_session_dir(workspace, "sid1", {"session_id": "sid1", "num_turns": 1})
        _create_session_dir(workspace, "sid2", {"session_id": "sid2"})
        repo.list_all()
        record = session_dir / "session.json"
        write_json(record, {"session_id": "sid1", "fork_point_cost_usd": 0.0, "num_turns": 12})
        os.utime(record, (record.stat().st_atime, record.stat().st_mtime + 2))

        with patch.object(repository_module, "read_json", wraps=read_json) as reads:
            result = repo.list_all()

        assert reads.call_count == 1
        assert {r.session_id: r.num_turns for r in result}["sid1"] == 12

    def test_a_new_session_is_read(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})
        repo.list_all()
        _create_session_dir(workspace, "sid2", {"session_id": "sid2"})

        result = repo.list_all()

        assert sorted(r.session_id for r in result) == ["sid1", "sid2"]

    def test_a_deleted_session_disappears(self, repo, workspace):
        _create_session_dir(workspace, "sid1", {"session_id": "sid1"})
        doomed = _create_session_dir(workspace, "sid2", {"session_id": "sid2"})
        repo.list_all()
        shutil.rmtree(doomed)

        assert [r.session_id for r in repo.list_all()] == ["sid1"]

    def test_an_unreadable_record_is_retried_on_the_next_listing(self, repo, workspace):
        corrupt = _create_session_dir(workspace, "sid1", {"session_id": "sid1"})
        (corrupt / "session.json").write_text('{"session_id": "sid')
        assert repo.list_all() == []

        with patch.object(repository_module, "read_json", wraps=read_json) as reads:
            repo.list_all()

        assert reads.call_count == 1

    def test_a_write_landing_during_the_read_is_picked_up_next_listing(self, repo, workspace):
        session_dir = _create_session_dir(workspace, "sid1", {"session_id": "sid1", "num_turns": 1})
        record = session_dir / "session.json"

        def read_then_overwrite(path, **kwargs):
            data = read_json(path, **kwargs)
            write_json(record, {"session_id": "sid1", "fork_point_cost_usd": 0.0, "num_turns": 7})
            os.utime(record, (record.stat().st_atime, record.stat().st_mtime + 2))

            return data

        with patch.object(repository_module, "read_json", side_effect=read_then_overwrite):
            assert repo.list_all()[0].num_turns == 1

        assert repo.list_all()[0].num_turns == 7


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
