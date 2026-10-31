"""Tests for claudebox.temp - session-scoped /tmp symlink management."""

from __future__ import annotations

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
    table = tmp_path / "empty-mountinfo"
    table.write_text("22 1 0:21 / / rw - overlay overlay rw\n")
    monkeypatch.setattr(temp, "MOUNTINFO_PATH", table)
    monkeypatch.delenv("CLAUDEBOX_NO_TMP_REMAP", raising=False)

    return managed


def _session(tmp_path: Path, name: str = "session-a") -> Any:
    """Create a stand-in Session - ensure_tmp only reads temp_dir."""

    return SimpleNamespace(temp_dir=tmp_path / name / "tmp")


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


# --- ensure_tmp refuses to delete across a mount ---


_ROOT_MOUNT = "22 1 0:21 / / rw - overlay overlay rw"


@pytest.fixture
def mountinfo(tmp_path, monkeypatch):
    """Serve a hand-written mount table; returns a writer taking the extra mount-point fields."""

    path = tmp_path / "mountinfo"
    monkeypatch.setattr(temp, "MOUNTINFO_PATH", path)

    def write(*mount_points: str) -> None:
        lines = [_ROOT_MOUNT] + [
            f"{40 + i} 22 0:{50 + i} / {point} rw,relatime - ext4 /dev/sda1 rw"
            for i, point in enumerate(mount_points)
        ]
        path.write_text("\n".join(lines) + "\n")

    write()

    return write


class TestEnsureTmpRefusesAcrossMounts:
    """Nothing mounted at or under /tmp is ever deleted to make room for the remap."""

    def test_a_mount_under_tmp_is_refused_and_survives(self, managed_tmp, tmp_path, mountinfo):
        (managed_tmp / "proj" / "src").mkdir(parents=True)
        (managed_tmp / "proj" / "src" / "main.py").write_text("print('hi')")
        mountinfo(f"{managed_tmp}/proj")

        with pytest.raises(temp.TmpRemapBlocked) as excinfo:
            temp.ensure_tmp(_session(tmp_path))

        assert excinfo.value.context["reason"] == "mounted"
        assert (managed_tmp / "proj" / "src" / "main.py").read_text() == "print('hi')"
        assert not managed_tmp.is_symlink()

    def test_tmp_itself_mounted_is_refused(self, managed_tmp, tmp_path, mountinfo):
        managed_tmp.mkdir()
        (managed_tmp / "lock").write_text("held")
        mountinfo(str(managed_tmp))

        with pytest.raises(temp.TmpRemapBlocked):
            temp.ensure_tmp(_session(tmp_path))

        assert (managed_tmp / "lock").read_text() == "held"

    def test_a_session_dir_inside_tmp_is_refused(self, managed_tmp, mountinfo):
        managed_tmp.mkdir()
        (managed_tmp / "keep").write_text("keep")
        session: Any = SimpleNamespace(temp_dir=managed_tmp / "sessions" / "a" / "tmp")

        with pytest.raises(temp.TmpRemapBlocked) as excinfo:
            temp.ensure_tmp(session)

        assert excinfo.value.context["reason"] == "session_dir_inside"
        assert (managed_tmp / "keep").read_text() == "keep"
        assert not managed_tmp.is_symlink()

    def test_an_escaped_space_in_a_mount_point_is_understood(
        self,
        managed_tmp,
        tmp_path,
        mountinfo,
    ):
        (managed_tmp / "a b").mkdir(parents=True)
        mountinfo(f"{managed_tmp}/a\\040b")

        with pytest.raises(temp.TmpRemapBlocked) as excinfo:
            temp.ensure_tmp(_session(tmp_path))

        assert excinfo.value.context["paths"] == f"{managed_tmp}/a b"

    def test_a_sibling_sharing_the_prefix_does_not_block(self, managed_tmp, tmp_path, mountinfo):
        managed_tmp.mkdir()
        mountinfo(f"{managed_tmp}foo")
        session = _session(tmp_path)

        temp.ensure_tmp(session)

        assert managed_tmp.resolve() == session.temp_dir.resolve()

    def test_an_unreadable_mount_table_refuses(self, managed_tmp, tmp_path, monkeypatch):
        managed_tmp.mkdir()
        (managed_tmp / "keep").write_text("keep")
        monkeypatch.setattr(temp, "MOUNTINFO_PATH", tmp_path / "does-not-exist")

        with pytest.raises(temp.TmpRemapBlocked) as excinfo:
            temp.ensure_tmp(_session(tmp_path))

        assert excinfo.value.context["reason"] == "mountinfo_unreadable"
        assert (managed_tmp / "keep").read_text() == "keep"

    def test_repointing_a_symlink_never_reads_the_mount_table(
        self,
        managed_tmp,
        tmp_path,
        monkeypatch,
    ):
        session_a = _session(tmp_path, "session-a")
        session_a.temp_dir.mkdir(parents=True)
        managed_tmp.symlink_to(session_a.temp_dir)
        monkeypatch.setattr(temp, "MOUNTINFO_PATH", tmp_path / "does-not-exist")
        session_b = _session(tmp_path, "session-b")

        temp.ensure_tmp(session_b)

        assert managed_tmp.resolve() == session_b.temp_dir.resolve()
