"""Tests for claudebox_daemon.domain.config - DaemonConfig persistence and workspace management."""

import json
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from filelock import FileLock

from claudebox_daemon.domain.config import DaemonConfig
from claudebox_daemon.domain.errors import LockTimeout, WorkspaceNotRegistered
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


def _make_config(tmp_path) -> DaemonConfig:
    """Create an empty DaemonConfig backed by a tmp_path file."""

    return DaemonConfig(path=tmp_path / "daemon.json", workspaces=[])


# --- Workspace Management ---


class TestDaemonConfigWorkspaces:
    """Test workspace registration and lookup."""

    def test_get_workspace_found(self, tmp_path):
        ws = RegisteredWorkspace(id="myws", path=Path("/some/path"))
        config = DaemonConfig(path=tmp_path / "daemon.json", workspaces=[ws])
        assert config.get_workspace("myws") == ws

    def test_get_workspace_not_registered(self, tmp_path):
        config = _make_config(tmp_path)

        with pytest.raises(WorkspaceNotRegistered):
            config.get_workspace("nonexistent")

    def test_register_workspace_new(self, tmp_path):
        config = _make_config(tmp_path)

        with patch.object(config, "save"):
            ws = config.register_workspace(tmp_path / "my-project")

        assert ws.id == "my-project"
        assert ws.path == (tmp_path / "my-project").resolve()
        assert len(config.workspaces) == 1

    def test_register_workspace_idempotent(self, tmp_path):
        config = _make_config(tmp_path)

        with patch.object(config, "save"):
            ws1 = config.register_workspace(tmp_path / "my-project")

        ws2 = config.register_workspace(tmp_path / "my-project")
        assert ws1 is ws2
        assert len(config.workspaces) == 1

    def test_deregister_workspace_found(self, tmp_path):
        config = _make_config(tmp_path)

        with patch.object(config, "save"):
            config.register_workspace(tmp_path / "my-project")
            result = config.deregister_workspace("my-project")

        assert result is True
        assert len(config.workspaces) == 0

    def test_deregister_workspace_not_found(self, tmp_path):
        config = _make_config(tmp_path)
        assert config.deregister_workspace("nonexistent") is False

    def test_register_workspace_basename_collision(self, tmp_path):
        """Two workspaces with same basename get disambiguated via hash suffix."""

        config = _make_config(tmp_path)
        path_a = tmp_path / "team-a" / "myapp"
        path_b = tmp_path / "team-b" / "myapp"
        path_a.mkdir(parents=True)
        path_b.mkdir(parents=True)

        with patch.object(config, "save"):
            ws_a = config.register_workspace(path_a)
            ws_b = config.register_workspace(path_b)

        assert ws_a.id == "myapp"
        assert ws_b.id != "myapp"
        assert ws_b.id.startswith("myapp-")
        assert ws_a.path == path_a.resolve()
        assert ws_b.path == path_b.resolve()


# --- Persistence ---


class TestDaemonConfigPersistence:
    """Test load and save roundtrip."""

    def test_load_missing_file(self, tmp_path):
        config = DaemonConfig.load(tmp_path / "missing.json")
        assert config.workspaces == []

    def test_save_raises_lock_timeout_when_contended(self, tmp_path):
        """A held lock produces a bounded, typed error instead of blocking forever."""

        config_path = tmp_path / "daemon.json"
        config = DaemonConfig(path=config_path, workspaces=[])

        holder = FileLock(config_path.with_suffix(".lock"))
        holder.acquire()

        try:
            with patch("claudebox_daemon.domain._locking.FILE_LOCK_TIMEOUT_SECONDS", 0.2):
                started = time.monotonic()

                with pytest.raises(LockTimeout) as exc_info:
                    config.save()

                elapsed = time.monotonic() - started
        finally:
            holder.release()

        assert elapsed < 5.0
        assert exc_info.value.context["path"] == str(config_path.with_suffix(".lock"))

    def test_save_and_load_roundtrip(self, tmp_path):
        config_path = tmp_path / "daemon.json"
        config = DaemonConfig(path=config_path, workspaces=[])
        config.register_workspace(tmp_path / "project-a")

        loaded = DaemonConfig.load(config_path)
        assert len(loaded.workspaces) == 1
        assert loaded.workspaces[0].id == "project-a"

    def test_save_excludes_path_field(self, tmp_path):
        config_path = tmp_path / "daemon.json"
        config = DaemonConfig(path=config_path, workspaces=[])
        config.save()

        data = json.loads(config_path.read_text())
        assert "path" not in data
