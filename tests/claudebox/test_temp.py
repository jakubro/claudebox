"""Tests for claudebox.temp - session-scoped /tmp symlink management."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from claudebox import temp


# --- Helpers ---


@pytest.fixture
def managed_tmp(tmp_path, monkeypatch):
    """Redirect the managed path so no test runs against the real /tmp."""

    managed = tmp_path / "tmp"
    monkeypatch.setattr(temp, "TMP_PATH", managed)
    monkeypatch.delenv("CLAUDEBOX_NO_TMP_REMAP", raising=False)

    return managed


def _session(tmp_path: Path, name: str = "session-a") -> Any:
    """Create a stand-in Session - ensure_tmp only reads temp_dir."""

    return SimpleNamespace(temp_dir=tmp_path / name / "tmp")


# --- restore_tmp ---


class TestRestoreTmp:
    """Test teardown of the session /tmp symlink."""

    def test_leaves_another_sessions_symlink_when_suppressed(
        self,
        managed_tmp,
        tmp_path,
        monkeypatch,
    ):
        other = tmp_path / "session-other" / "tmp"
        other.mkdir(parents=True)
        (other / "artifact.log").write_text("evidence")
        managed_tmp.symlink_to(other)

        monkeypatch.setenv("CLAUDEBOX_NO_TMP_REMAP", "1")
        temp.restore_tmp()

        assert managed_tmp.resolve() == other.resolve()
        assert (other / "artifact.log").read_text() == "evidence"

    def test_replaces_own_symlink_with_empty_dir(self, managed_tmp, tmp_path):
        target = tmp_path / "session-a" / "tmp"
        target.mkdir(parents=True)
        managed_tmp.symlink_to(target)

        temp.restore_tmp()

        assert not managed_tmp.is_symlink()
        assert list(managed_tmp.iterdir()) == []

    def test_never_deletes_a_real_directory(self, managed_tmp):
        managed_tmp.mkdir()
        (managed_tmp / "someone-elses.log").write_text("keep me")

        temp.restore_tmp()

        assert (managed_tmp / "someone-elses.log").read_text() == "keep me"


# --- ensure_tmp ---


class TestEnsureTmp:
    """Test session start taking ownership of /tmp."""

    def test_replaces_a_real_directory_with_session_symlink(self, managed_tmp, tmp_path):
        managed_tmp.mkdir()
        (managed_tmp / "stale").write_text("from a previous container")
        session = _session(tmp_path)

        temp.ensure_tmp(session)

        assert managed_tmp.resolve() == session.temp_dir.resolve()

    def test_skips_when_suppressed(self, managed_tmp, tmp_path, monkeypatch):
        managed_tmp.mkdir()
        monkeypatch.setenv("CLAUDEBOX_NO_TMP_REMAP", "1")

        temp.ensure_tmp(_session(tmp_path))

        assert not managed_tmp.is_symlink()

    def test_is_idempotent_for_a_correct_symlink(self, managed_tmp, tmp_path):
        session = _session(tmp_path)
        session.temp_dir.mkdir(parents=True)
        managed_tmp.symlink_to(session.temp_dir)
        (session.temp_dir / "live.log").write_text("in use")

        temp.ensure_tmp(session)

        assert (session.temp_dir / "live.log").read_text() == "in use"
