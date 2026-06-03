"""Tests for claudebox_daemon.domain.ui_state.service — persistent UI state store."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from claudebox.core.io import write_json
from claudebox_daemon.domain.ui_state.service import UIStateService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


def _make_service(tmp_path: Path) -> UIStateService:
    """Create a UIStateService rooted at a temp workspace."""

    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    (tmp_path / ".claudebox").mkdir(parents=True, exist_ok=True)
    return UIStateService(ws)


# --- _apply_operations ---


class TestApplyOperations:
    """Test individual patch operations on state dicts."""

    def test_set(self):
        state = {}
        result = UIStateService._apply_operations(
            state, [{"op": "set", "path": "theme", "value": "dark"}]
        )
        assert result["theme"] == "dark"
        assert "updated_at" in result

    def test_unset(self):
        state = {"theme": "dark"}
        result = UIStateService._apply_operations(state, [{"op": "unset", "path": "theme"}])
        assert "theme" not in result

    def test_unset_missing_key_noop(self):
        state = {}
        result = UIStateService._apply_operations(state, [{"op": "unset", "path": "nonexistent"}])
        assert "nonexistent" not in result

    def test_add_creates_list(self):
        state = {}
        result = UIStateService._apply_operations(
            state, [{"op": "add", "path": "tags", "value": "a"}]
        )
        assert result["tags"] == ["a"]

    def test_add_deduplicates(self):
        state = {"tags": ["a"]}
        result = UIStateService._apply_operations(
            state, [{"op": "add", "path": "tags", "value": "a"}]
        )
        assert result["tags"] == ["a"]

    def test_add_new_value(self):
        state = {"tags": ["a"]}
        result = UIStateService._apply_operations(
            state, [{"op": "add", "path": "tags", "value": "b"}]
        )
        assert result["tags"] == ["a", "b"]

    def test_append_allows_duplicates(self):
        state = {"items": ["a"]}
        result = UIStateService._apply_operations(
            state, [{"op": "append", "path": "items", "value": "a"}]
        )
        assert result["items"] == ["a", "a"]

    def test_append_creates_list(self):
        state = {}
        result = UIStateService._apply_operations(
            state, [{"op": "append", "path": "items", "value": "x"}]
        )
        assert result["items"] == ["x"]

    def test_remove_from_list(self):
        state = {"tags": ["a", "b", "c"]}
        result = UIStateService._apply_operations(
            state, [{"op": "remove", "path": "tags", "value": "b"}]
        )
        assert result["tags"] == ["a", "c"]

    def test_remove_missing_value_noop(self):
        state = {"tags": ["a"]}
        result = UIStateService._apply_operations(
            state, [{"op": "remove", "path": "tags", "value": "z"}]
        )
        assert result["tags"] == ["a"]

    def test_remove_missing_key_noop(self):
        state = {}
        result = UIStateService._apply_operations(
            state, [{"op": "remove", "path": "missing", "value": "x"}]
        )
        assert "missing" not in result

    def test_invalid_op_raises(self):
        with pytest.raises(ValueError):
            UIStateService._apply_operations({}, [{"path": "x"}])

    def test_missing_path_raises(self):
        with pytest.raises(ValueError):
            UIStateService._apply_operations({}, [{"op": "set"}])


# --- _resolve_path ---


class TestResolvePath:
    """Test dot-path resolution with intermediary dict creation."""

    def test_single_key(self):
        state = {}
        parent, key = UIStateService._resolve_path(state, "theme")
        assert parent is state
        assert key == "theme"

    def test_nested_path_creates_intermediary(self):
        state = {}
        parent, key = UIStateService._resolve_path(state, "layout.sidebar.width")
        assert key == "width"
        assert "layout" in state
        assert "sidebar" in state["layout"]

    def test_nested_path_existing(self):
        state = {"layout": {"sidebar": {"width": 300}}}
        parent, key = UIStateService._resolve_path(state, "layout.sidebar.width")
        assert parent == {"width": 300}
        assert key == "width"

    def test_non_dict_overwritten(self):
        state = {"layout": "flat"}
        parent, key = UIStateService._resolve_path(state, "layout.sidebar")
        assert key == "sidebar"
        assert isinstance(state["layout"], dict)


# --- _prune_old_sessions ---


class TestPruneOldSessions:
    """Test session expiry pruning."""

    def test_keeps_recent(self):
        now = datetime.now(UTC).isoformat()
        sessions = {"s1": {"updated_at": now}}
        result = UIStateService._prune_old_sessions(sessions)
        assert "s1" in result

    def test_removes_old(self):
        old = (datetime.now(UTC) - timedelta(days=400)).isoformat()
        sessions = {"s1": {"updated_at": old}}
        result = UIStateService._prune_old_sessions(sessions)
        assert "s1" not in result

    def test_mixed(self):
        now = datetime.now(UTC).isoformat()
        old = (datetime.now(UTC) - timedelta(days=400)).isoformat()
        sessions = {"recent": {"updated_at": now}, "stale": {"updated_at": old}}
        result = UIStateService._prune_old_sessions(sessions)
        assert "recent" in result
        assert "stale" not in result


# --- _load ---


class TestLoad:
    """Test state loading with version migration."""

    def test_fresh_file(self, tmp_path):
        svc = _make_service(tmp_path)
        physical, virtual = svc._load(None)
        assert physical["version"] == UIStateService.VERSION
        assert virtual["global"] == {}
        assert virtual["session"] == {}

    def test_old_version_migrated(self, tmp_path):
        svc = _make_service(tmp_path)
        write_json(svc._state_path, {"version": 1, "global": {"old": True}, "sessions": {}})

        physical, virtual = svc._load(None)
        assert physical["version"] == UIStateService.VERSION
        assert physical["global"] == {}  # migrated — old data cleared

    def test_loads_existing_session(self, tmp_path):
        svc = _make_service(tmp_path)
        write_json(
            svc._state_path,
            {
                "version": UIStateService.VERSION,
                "global": {"theme": "dark"},
                "sessions": {"s1": {"panel": "open", "updated_at": datetime.now(UTC).isoformat()}},
            },
        )

        _, virtual = svc._load("s1")
        assert virtual["global"]["theme"] == "dark"
        assert virtual["session"]["panel"] == "open"

    def test_unknown_session_returns_empty(self, tmp_path):
        svc = _make_service(tmp_path)
        write_json(
            svc._state_path,
            {
                "version": UIStateService.VERSION,
                "global": {},
                "sessions": {},
            },
        )

        _, virtual = svc._load("nonexistent")
        assert virtual["session"] == {}


# --- get / patch integration ---


class TestGetPatch:
    """Test full get/patch roundtrip through file."""

    def test_get_empty(self, tmp_path):
        svc = _make_service(tmp_path)
        result = svc.get()
        assert result.asdict() == {"global": {}, "session": {}}

    def test_patch_global(self, tmp_path):
        svc = _make_service(tmp_path)
        result = svc.patch(None, **{"global": [{"op": "set", "path": "theme", "value": "dark"}]})
        assert result.global_state["theme"] == "dark"

    def test_patch_session(self, tmp_path):
        svc = _make_service(tmp_path)
        result = svc.patch(
            "s1",
            **{"session": [{"op": "set", "path": "sidebar", "value": "open"}]},
        )
        assert result.session_state["sidebar"] == "open"

    def test_patch_session_without_id_raises(self, tmp_path):
        svc = _make_service(tmp_path)
        with pytest.raises(ValueError, match="session_id required"):
            svc.patch(None, **{"session": [{"op": "set", "path": "x", "value": 1}]})

    def test_patch_persists(self, tmp_path):
        svc = _make_service(tmp_path)
        svc.patch(None, **{"global": [{"op": "set", "path": "theme", "value": "dark"}]})

        # Fresh service reads from file
        svc2 = _make_service(tmp_path)
        result = svc2.get()
        assert result.global_state["theme"] == "dark"

    def test_latest_session_inheritance(self, tmp_path):
        svc = _make_service(tmp_path)
        svc.patch("s1", **{"session": [{"op": "set", "path": "layout", "value": "wide"}]})

        # Get without session_id returns latest
        result = svc.get()
        assert result.session_state["layout"] == "wide"
