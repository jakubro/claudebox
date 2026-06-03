"""Tests for claudebox.cleanup — stale directory removal."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from claudebox.cleanup import cleanup_stale_dirs
from claudebox.config import Config
from claudebox.constants import SESSION_MAX_AGE
from claudebox.core.time import TIMESTAMP_FORMAT


# --- Helpers ---


def _make_session_dir(root: Path, timestamp: datetime) -> Path:
    """Create a directory named with a timestamp prefix."""

    name = timestamp.strftime(TIMESTAMP_FORMAT) + "--session-id"
    path = root / name
    path.mkdir(parents=True)
    return path


def _make_config(config_dir: Path) -> Config:
    """Create a Config with config_dir pointing to the given path."""

    return Config(work_dir=config_dir.parent, config_dir=config_dir, backend="podman")


# --- cleanup_stale_dirs ---


class TestCleanupStaleDirs:
    """Test stale directory detection and removal."""

    @patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR")
    @patch("claudebox.cleanup.HOST_TEMP_RUN_DIR")
    def test_removes_old_session_dirs(self, mock_run_dir, mock_build_dir, tmp_path):
        mock_build_dir.exists.return_value = False
        mock_run_dir.exists.return_value = False

        sessions = tmp_path / "sessions"
        sessions.mkdir()

        old_time = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=1)
        old_dir = _make_session_dir(sessions, old_time)

        config = _make_config(tmp_path)
        removed = cleanup_stale_dirs(config)

        assert not old_dir.exists()
        assert removed == [old_dir]

    @patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR")
    @patch("claudebox.cleanup.HOST_TEMP_RUN_DIR")
    def test_keeps_recent_dirs(self, mock_run_dir, mock_build_dir, tmp_path):
        mock_build_dir.exists.return_value = False
        mock_run_dir.exists.return_value = False

        sessions = tmp_path / "sessions"
        sessions.mkdir()

        recent_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
        recent_dir = _make_session_dir(sessions, recent_time)

        config = _make_config(tmp_path)
        removed = cleanup_stale_dirs(config)

        assert recent_dir.exists()
        assert removed == []

    @patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR")
    @patch("claudebox.cleanup.HOST_TEMP_RUN_DIR")
    def test_skips_nonexistent_root(self, mock_run_dir, mock_build_dir, tmp_path):
        mock_build_dir.exists.return_value = False
        mock_run_dir.exists.return_value = False

        nonexistent = tmp_path / "nonexistent"
        config = _make_config(nonexistent)
        removed = cleanup_stale_dirs(config)
        assert not nonexistent.exists()
        assert removed == []

    def test_removes_old_temp_dirs(self, tmp_path):
        """Exercise temp dir cleanup paths (HOST_TEMP_BUILD_DIR, HOST_TEMP_RUN_DIR)."""

        sessions = tmp_path / "sessions"
        sessions.mkdir()

        build_dir = tmp_path / "build"
        build_dir.mkdir()
        run_dir = tmp_path / "run"
        run_dir.mkdir()

        old_time = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=1)
        old_build = _make_session_dir(build_dir, old_time)
        old_run = _make_session_dir(run_dir, old_time)

        config = _make_config(tmp_path)

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", build_dir),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", run_dir),
        ):
            removed = cleanup_stale_dirs(config)

        assert not old_build.exists()
        assert not old_run.exists()
        assert set(removed) == {old_build, old_run}

    def test_skips_non_timestamped_dirs(self, tmp_path):
        """Directories without timestamp prefix are left untouched."""

        sessions = tmp_path / "sessions"
        sessions.mkdir()

        random_dir = sessions / "some-random-name"
        random_dir.mkdir()

        config = _make_config(tmp_path)

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config)

        assert random_dir.exists()
        assert removed == []
