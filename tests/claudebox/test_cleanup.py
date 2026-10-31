"""Tests for claudebox.cleanup - stale directory removal."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from claudebox.cleanup import (
    SweepReport,
    _cleanup_stale_temp_dirs,
    _daemon_held_session_ids,
    _registered_workspaces,
    cleanup_stale_dirs,
)
from claudebox.config import Config
from claudebox.constants import (
    SESSION_MAX_AGE,
    SESSION_METADATA_FILE,
    SESSION_RUN_ID_FILE,
    UI_STATE_FILE,
    UI_STATE_VERSION,
)
from claudebox.core.time import TIMESTAMP_FORMAT


pytestmark = pytest.mark.usefixtures("bounded_config_root")


# --- Helpers ---


def _make_session_dir(
    root: Path,
    timestamp: datetime,
    *,
    mtime: datetime | None = None,
    session_id: str = "session-id",
) -> Path:
    """Create a timestamp-named directory, backdating its mtime if given - creation always sets
    mtime to "now", so a caller testing the mtime-fallback rule must set it explicitly.
    """

    name = timestamp.strftime(TIMESTAMP_FORMAT) + f"--{session_id}"
    path = root / name
    path.mkdir(parents=True)

    if mtime is not None:
        ts = mtime.timestamp()
        os.utime(path, (ts, ts))

    return path


def _write_session_record(path: Path, updated_at: datetime) -> None:
    """Write a minimal session.json carrying only the field cleanup reads."""

    (path / SESSION_METADATA_FILE).write_text(json.dumps({"updated_at": updated_at.isoformat()}))


def _make_config(config_dir: Path) -> Config:
    """Create a Config with config_dir pointing to the given path."""

    return Config(work_dir=config_dir.parent, config_dir=config_dir, backend="podman")


# --- cleanup_stale_dirs ---


@patch("claudebox.cleanup._registered_workspaces", return_value={})
class TestCleanupStaleSessions:
    """Test session-directory age (last-used, not creation) and liveness.

    The registry is patched empty so no test depends on this machine's real daemon registry.
    """

    def test_removes_a_session_unused_past_the_period(self, _mock_resolve, tmp_path):
        """No session.json - falls back to the directory's own (backdated) mtime."""

        sessions = tmp_path / ".claudebox" / "sessions"
        sessions.mkdir(parents=True)

        old_time = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=1)
        old_dir = _make_session_dir(sessions, old_time, mtime=old_time)

        config = _make_config(tmp_path / ".claudebox")

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert not old_dir.exists()
        assert removed == [old_dir]

    def test_keeps_a_session_used_inside_the_period(self, _mock_resolve, tmp_path):
        sessions = tmp_path / ".claudebox" / "sessions"
        sessions.mkdir(parents=True)

        recent_time = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
        recent_dir = _make_session_dir(sessions, recent_time, mtime=recent_time)

        config = _make_config(tmp_path / ".claudebox")

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert recent_dir.exists()
        assert removed == []

    def test_old_name_but_recently_used_record_survives(self, _mock_resolve, tmp_path):
        """A directory named beyond the retention period, whose record says it was used
        yesterday, survives - age must come from the record, not the name."""

        sessions = tmp_path / ".claudebox" / "sessions"
        sessions.mkdir(parents=True)

        far_past = SESSION_MAX_AGE + timedelta(days=30)
        old_name_time = datetime.now(UTC).replace(tzinfo=None) - far_past
        session_dir = _make_session_dir(sessions, old_name_time)
        _write_session_record(
            session_dir,
            datetime.now(UTC).replace(tzinfo=None) - timedelta(days=1),
        )

        config = _make_config(tmp_path / ".claudebox")

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert session_dir.exists()
        assert removed == []

    def test_old_name_and_old_record_is_removed(self, _mock_resolve, tmp_path):
        sessions = tmp_path / ".claudebox" / "sessions"
        sessions.mkdir(parents=True)

        old_time = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=30)
        session_dir = _make_session_dir(sessions, old_time)
        _write_session_record(session_dir, old_time)

        config = _make_config(tmp_path / ".claudebox")

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert not session_dir.exists()
        assert removed == [session_dir]

    def test_unreadable_record_falls_back_to_mtime(self, _mock_resolve, tmp_path):
        """A session whose record is corrupt is judged by its file-system times - not kept
        forever, not deleted on the strength of a broken file."""

        sessions = tmp_path / ".claudebox" / "sessions"
        sessions.mkdir(parents=True)

        old_time = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=1)
        session_dir = _make_session_dir(sessions, old_time)
        (session_dir / SESSION_METADATA_FILE).write_text("{not valid json")
        # Writing the file just above stamped it and the directory "now" - backdate both, after,
        # so the mtime fallback this test exercises sees them as old.
        ts = old_time.timestamp()
        os.utime(session_dir / SESSION_METADATA_FILE, (ts, ts))
        os.utime(session_dir, (ts, ts))

        config = _make_config(tmp_path / ".claudebox")

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert not session_dir.exists()
        assert removed == [session_dir]

    def test_skips_nonexistent_root(self, _mock_resolve, tmp_path):
        nonexistent = tmp_path / "nonexistent" / ".claudebox"
        config = _make_config(nonexistent)

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert not nonexistent.exists()
        assert removed == []

    def test_skips_non_timestamped_dirs(self, _mock_resolve, tmp_path):
        """Directories without a timestamp-prefixed name are left untouched."""

        sessions = tmp_path / ".claudebox" / "sessions"
        sessions.mkdir(parents=True)

        random_dir = sessions / "some-random-name"
        random_dir.mkdir()

        config = _make_config(tmp_path / ".claudebox")

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert random_dir.exists()
        assert removed == []


@patch("claudebox.cleanup._registered_workspaces", return_value={})
class TestPinnedSessionKept:
    """A session pinned in the workspace's UI state is never removed; unreadable pins stop the sweep."""

    AGED = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=35)

    def _seed(self, tmp_path: Path, ui_state: str | None) -> tuple[Path, Path]:
        sessions = tmp_path / ".claudebox" / "sessions"
        pinned = _make_session_dir(sessions, self.AGED, session_id="kept-by-pin")
        unpinned = _make_session_dir(sessions, self.AGED, session_id="nothing-keeps-it")

        for path in (pinned, unpinned):
            _write_session_record(path, self.AGED)

        if ui_state is not None:
            (tmp_path / ".claudebox" / UI_STATE_FILE).write_text(ui_state)

        return pinned, unpinned

    def _prune(self, tmp_path: Path, build_dir: Path | None = None) -> SweepReport:
        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", build_dir or tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            return cleanup_stale_dirs(_make_config(tmp_path / ".claudebox"))

    def test_a_pinned_session_survives_and_an_unpinned_one_of_its_age_goes(
        self,
        _mock_resolve,
        tmp_path,
    ):
        ui_state = {"version": UI_STATE_VERSION, "global": {"pinnedSessions": ["kept-by-pin"]}}
        pinned, unpinned = self._seed(tmp_path, json.dumps(ui_state))

        removed = self._prune(tmp_path).removed

        assert pinned.exists()
        assert removed == [unpinned]

    def test_a_version_written_as_a_float_still_keeps_the_pins(self, _mock_resolve, tmp_path):
        ui_state = {
            "version": float(UI_STATE_VERSION),
            "global": {"pinnedSessions": ["kept-by-pin"]},
        }
        pinned, unpinned = self._seed(tmp_path, json.dumps(ui_state))

        removed = self._prune(tmp_path).removed

        assert pinned.exists()
        assert removed == [unpinned]

    def test_pins_in_a_file_the_daemon_discards_keep_nothing(self, _mock_resolve, tmp_path):
        ui_state = {"version": UI_STATE_VERSION - 1, "global": {"pinnedSessions": ["kept-by-pin"]}}
        pinned, unpinned = self._seed(tmp_path, json.dumps(ui_state))

        removed = self._prune(tmp_path).removed

        assert sorted(removed) == sorted([pinned, unpinned])

    @pytest.mark.parametrize(
        "ui_state",
        [
            "{not json",
            "[]",
            json.dumps({"version": UI_STATE_VERSION, "global": []}),
            json.dumps({"version": UI_STATE_VERSION, "global": {"pinnedSessions": "kept-by-pin"}}),
            json.dumps({"version": str(UI_STATE_VERSION), "global": {"pinnedSessions": []}}),
            json.dumps({"version": None, "global": {"pinnedSessions": []}}),
        ],
        ids=[
            "not-json",
            "not-an-object",
            "global-not-an-object",
            "pins-not-a-list",
            "version-a-string",
            "version-null",
        ],
    )
    def test_unreadable_pins_remove_no_session_and_still_sweep_temp_dirs(
        self,
        _mock_resolve,
        tmp_path,
        ui_state,
    ):
        pinned, unpinned = self._seed(tmp_path, ui_state)
        build_dir = tmp_path / "build"
        old_build = _make_session_dir(build_dir, self.AGED)

        report = self._prune(tmp_path, build_dir)

        assert pinned.exists()
        assert unpinned.exists()
        assert not old_build.exists()
        assert "cannot read the pinned sessions" in report.failed[tmp_path]


def _container(status: str = "running", session_id: str | None = None, members=()) -> dict:
    return {
        "id": "ctr-1",
        "status": status,
        "session_id": session_id,
        "members": list(members),
        "live_session_ids": [],
    }


def _daemon_answers(*containers: dict):
    response = MagicMock()
    response.json.return_value = {"containers": list(containers)}

    return patch("claudebox.cleanup.httpx.get", return_value=response)


def _daemon_silent():
    return patch("claudebox.cleanup.httpx.get", side_effect=httpx.ConnectError("refused"))


def _runtime_lists(*containers: dict):
    backend = MagicMock()
    backend.return_value.list_containers.return_value = list(containers)

    return patch("claudebox.cleanup.ContainerBackend", backend)


def _runtime_fails():
    backend = MagicMock()
    backend.return_value.list_containers.side_effect = subprocess.CalledProcessError(
        125,
        ["podman"],
    )

    return patch("claudebox.cleanup.ContainerBackend", backend)


class TestRunningSessionsKept:
    """Held sessions are never touched; a workspace where that cannot be told is left whole, named."""

    IDLE = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=30)

    @pytest.fixture
    def workspace(self, tmp_path):
        root = tmp_path / "ws"
        (root / ".claudebox").mkdir(parents=True)

        with patch(
            "claudebox.cleanup._registered_workspaces",
            return_value={root.resolve(): "ws-1"},
        ):
            yield root

    def _session(self, root: Path, session_id: str) -> Path:
        path = _make_session_dir(root / ".claudebox" / "sessions", self.IDLE, session_id=session_id)
        _write_session_record(path, self.IDLE)

        return path

    def _backend(self, root: Path, backend: str) -> None:
        (root / ".claudebox" / "settings.toml").write_text(f'backend = "{backend}"\n')

    def _sweep(self, tmp_path: Path, root: Path) -> SweepReport:
        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            return cleanup_stale_dirs(_make_config(root / ".claudebox"))

    def test_the_owner_of_a_running_container_is_kept(self, tmp_path, workspace):
        owner = self._session(workspace, "owner")
        idle = self._session(workspace, "nothing-holds-it")

        with _daemon_answers(_container(session_id="owner")):
            report = self._sweep(tmp_path, workspace)

        assert owner.exists()
        assert report.removed == [idle]

    def test_a_held_session_keeps_its_tmp(self, tmp_path, workspace):
        used = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=15)
        session = _make_session_dir(workspace / ".claudebox" / "sessions", used, session_id="owner")
        _write_session_record(session, used)
        (session / "tmp").mkdir()
        (session / "tmp" / "build.log").write_text("still being written")

        with _daemon_answers(_container(session_id="owner")):
            report = self._sweep(tmp_path, workspace)

        assert (session / "tmp" / "build.log").exists()
        assert report.emptied == {}

    def test_a_side_conversation_that_is_not_live_is_kept(self, tmp_path, workspace):
        side = self._session(workspace, "side-thread")

        with _daemon_answers(_container(session_id="owner", members=["side-thread"])):
            report = self._sweep(tmp_path, workspace)

        assert side.exists()
        assert report.removed == []

    @pytest.mark.parametrize("status", ["starting", "running", "stopping", "crashed"])
    def test_every_state_but_stopped_holds(self, tmp_path, workspace, status):
        held = self._session(workspace, "held")

        with _daemon_answers(_container(status=status, session_id="held")):
            self._sweep(tmp_path, workspace)

        assert held.exists()

    def test_a_stopped_container_holds_nothing(self, tmp_path, workspace):
        idle = self._session(workspace, "was-held")

        with _daemon_answers(_container(status="stopped", session_id="was-held", members=["x"])):
            report = self._sweep(tmp_path, workspace)

        assert report.removed == [idle]

    def test_a_silent_daemon_leaves_a_local_workspace_whole(self, tmp_path, workspace):
        self._backend(workspace, "local")
        idle = self._session(workspace, "maybe-running")

        with _daemon_silent():
            report = self._sweep(tmp_path, workspace)

        assert idle.exists()
        assert "cannot tell which sessions are running" in report.failed[workspace.resolve()]

    def test_a_silent_daemon_with_a_workspace_container_running_leaves_it_whole(
        self,
        tmp_path,
        workspace,
    ):
        idle = self._session(workspace, "maybe-running")
        running = {"State": "running", "Labels": {"claudebox-workspace": "ws-1"}}

        with _daemon_silent(), _runtime_lists(running):
            report = self._sweep(tmp_path, workspace)

        assert idle.exists()
        assert list(report.failed) == [workspace.resolve()]

    def test_a_silent_daemon_with_no_workspace_container_running_sweeps(self, tmp_path, workspace):
        idle = self._session(workspace, "nothing-runs")
        others = [
            {"State": "exited", "Labels": {"claudebox-workspace": "ws-1"}},
            {"State": "running", "Labels": {"claudebox-workspace": "another-ws"}},
        ]

        with _daemon_silent(), _runtime_lists(*others):
            report = self._sweep(tmp_path, workspace)

        assert report.removed == [idle]
        assert report.failed == {}

    def test_a_silent_daemon_and_a_failing_runtime_leave_it_whole(self, tmp_path, workspace):
        idle = self._session(workspace, "maybe-running")

        with _daemon_silent(), _runtime_fails():
            report = self._sweep(tmp_path, workspace)

        assert idle.exists()
        assert "cannot list the podman containers" in report.failed[workspace.resolve()]

    def test_an_unregistered_workspace_asks_no_daemon(self, tmp_path):
        root = tmp_path / "unregistered"
        idle = self._session(root, "nothing-runs")

        with (
            patch("claudebox.cleanup._registered_workspaces", return_value={}),
            patch("claudebox.cleanup.httpx.get") as daemon,
        ):
            report = self._sweep(tmp_path, root)

        daemon.assert_not_called()
        assert report.removed == [idle]

    def test_a_claudebox_run_session_is_kept_while_its_container_runs(self, tmp_path, workspace):
        running = self._session(workspace, "run-alive")
        (running / "run-id").write_text("run-aaaa")
        gone = self._session(workspace, "run-gone")
        (gone / "run-id").write_text("run-bbbb")
        listing = [
            {"State": "running", "Labels": {"claudebox-run": "run-aaaa"}},
            {"State": "exited", "Labels": {"claudebox-run": "run-bbbb"}},
        ]

        with _daemon_answers(), _runtime_lists(*listing):
            report = self._sweep(tmp_path, workspace)

        assert running.exists()
        assert report.removed == [gone]

    def test_a_claudebox_run_session_and_a_failing_runtime_leave_it_whole(
        self,
        tmp_path,
        workspace,
    ):
        session = self._session(workspace, "run-unknown")
        (session / "run-id").write_text("run-cccc")

        with _daemon_answers(), _runtime_fails():
            report = self._sweep(tmp_path, workspace)

        assert session.exists()
        assert list(report.failed) == [workspace.resolve()]


class TestRegisteredWorkspaces:
    """The daemon's registry, read by path - a missing file registers nothing, a damaged one fails."""

    def test_maps_each_resolved_path_to_its_id(self, tmp_path):
        work_dir = tmp_path / "my-workspace"
        work_dir.mkdir()
        (tmp_path / "link").symlink_to(work_dir)
        registry = tmp_path / "daemon.json"
        registry.write_text(
            json.dumps({"workspaces": [{"id": "ws-1", "path": str(tmp_path / "link")}]}),
        )

        with patch("claudebox.cleanup.daemon_config_path", return_value=registry):
            assert _registered_workspaces() == {work_dir.resolve(): "ws-1"}

    def test_a_missing_registry_registers_nothing(self, tmp_path):
        with patch("claudebox.cleanup.daemon_config_path", return_value=tmp_path / "absent.json"):
            assert _registered_workspaces() == {}

    @pytest.mark.parametrize(
        "content",
        [
            "{not json",
            "[]",
            json.dumps({"workspaces": {"id": "ws-1"}}),
            json.dumps({"workspaces": [{"id": "ws-1"}]}),
        ],
        ids=["not-json", "not-an-object", "workspaces-not-a-list", "entry-without-a-path"],
    )
    def test_a_damaged_registry_raises(self, tmp_path, content):
        registry = tmp_path / "daemon.json"
        registry.write_text(content)

        with (
            patch("claudebox.cleanup.daemon_config_path", return_value=registry),
            pytest.raises(OSError, match="registered workspaces"),
        ):
            _registered_workspaces()


class TestDaemonHeldSessionIds:
    """The daemon's container listing names every session a container still holds."""

    def test_owners_and_members_of_containers_not_stopped(self):
        listing = [
            _container(session_id="owner-a", members=["side-a"]),
            _container(status="stopped", session_id="owner-b", members=["side-b"]),
            _container(session_id=None, members=["side-c"]),
        ]

        with _daemon_answers(*listing):
            assert _daemon_held_session_ids("ws-1") == {"owner-a", "side-a", "side-c"}

    def test_an_unreachable_daemon_raises(self):
        with _daemon_silent(), pytest.raises(httpx.ConnectError):
            _daemon_held_session_ids("ws-1")


@patch("claudebox.cleanup._daemon_held_session_ids", return_value=set())
class TestSweepReachesEveryWorkspace:
    """Every registered workspace, the home directory and the current workspace are swept, each once."""

    IDLE = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=35)
    RECENT = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)

    def _session(self, root: Path, session_id: str, used: datetime) -> Path:
        path = _make_session_dir(root / ".claudebox" / "sessions", used, session_id=session_id)
        _write_session_record(path, used)

        return path

    def _register(self, *workspaces: Path) -> None:
        registry = Path.home() / ".claudebox" / "daemon.json"
        registry.parent.mkdir(parents=True, exist_ok=True)
        entries = [{"id": ws.name, "path": str(ws)} for ws in workspaces]
        registry.write_text(json.dumps({"workspaces": entries}))

    def _sweep(self, tmp_path: Path, current: Path):
        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            return cleanup_stale_dirs(_make_config(current / ".claudebox"))

    def test_a_registered_workspace_is_swept_from_the_home_directory(self, _live, tmp_path):
        registered = tmp_path / "registered"
        idle = self._session(registered, "registered-idle", self.IDLE)
        recent = self._session(registered, "registered-recent", self.RECENT)
        home_idle = self._session(Path.home(), "home-idle", self.IDLE)
        self._register(registered)

        report = self._sweep(tmp_path, Path.home())

        assert sorted(report.removed) == sorted([idle, home_idle])
        assert recent.exists()
        assert (report.missing, report.failed) == ([], {})

    def test_an_unregistered_current_workspace_is_swept_beside_the_registered_ones(
        self,
        _live,
        tmp_path,
    ):
        registered, current = tmp_path / "registered", tmp_path / "current"
        registered_idle = self._session(registered, "registered-idle", self.IDLE)
        current_idle = self._session(current, "current-idle", self.IDLE)
        self._register(registered)

        report = self._sweep(tmp_path, current)

        assert sorted(report.removed) == sorted([registered_idle, current_idle])

    def test_a_workspace_reached_twice_is_noted_once(self, _live, tmp_path):
        gone = tmp_path / "gone"
        (tmp_path / "link").symlink_to(gone)
        self._register(gone, tmp_path / "link")

        report = self._sweep(tmp_path, Path.home())

        assert report.missing == [gone]

    def test_a_missing_workspace_is_noted_and_the_others_are_swept(self, _live, tmp_path):
        present, gone = tmp_path / "present", tmp_path / "gone"
        idle = self._session(present, "present-idle", self.IDLE)
        self._register(gone, present)

        report = self._sweep(tmp_path, Path.home())

        assert report.removed == [idle]
        assert report.missing == [gone]
        assert report.failed == {}

    def test_unreadable_pins_leave_their_workspace_whole_and_the_others_swept(
        self,
        _live,
        tmp_path,
    ):
        broken, healthy = tmp_path / "broken", tmp_path / "healthy"
        kept = self._session(broken, "broken-idle", self.IDLE)
        (broken / ".claudebox" / UI_STATE_FILE).write_text("{not json")
        idle = self._session(healthy, "healthy-idle", self.IDLE)
        self._register(broken, healthy)

        report = self._sweep(tmp_path, Path.home())

        assert kept.exists()
        assert report.removed == [idle]
        assert list(report.failed) == [broken.resolve()]
        assert "cannot read the pinned sessions" in report.failed[broken.resolve()]

    def test_settings_that_fail_to_parse_leave_their_workspace_whole_and_the_others_swept(
        self,
        _live,
        tmp_path,
    ):
        broken, healthy = tmp_path / "broken", tmp_path / "healthy"
        kept = self._session(broken, "broken-idle", self.IDLE)
        (broken / ".claudebox" / "settings.toml").write_text('network = "bridge"\n')
        idle = self._session(healthy, "healthy-idle", self.IDLE)
        self._register(broken, healthy)

        report = self._sweep(tmp_path, Path.home())

        assert kept.exists()
        assert report.removed == [idle]
        assert list(report.failed) == [broken.resolve()]

    def test_an_unreadable_registry_sweeps_no_session_but_still_the_temp_dirs(
        self,
        _live,
        tmp_path,
    ):
        home_idle = self._session(Path.home(), "home-idle", self.IDLE)
        registry = Path.home() / ".claudebox" / "daemon.json"
        registry.write_text("{not json")
        build_dir = tmp_path / "build"
        old_build = _make_session_dir(build_dir, self.IDLE)

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", build_dir),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            report = cleanup_stale_dirs(_make_config(Path.home() / ".claudebox"))

        assert home_idle.exists()
        assert report.removed == [old_build]
        assert list(report.failed) == [registry]


@patch("claudebox.cleanup._registered_workspaces", return_value={})
class TestSessionTmpEmptied:
    """An idle session's tmp/ is emptied, the folder and the session kept; a pinned one is not."""

    PAYLOAD = os.urandom(1024 * 1024)

    def _session(
        self,
        root: Path,
        session_id: str,
        idle_days: int,
        *,
        payload: bool = True,
    ) -> Path:
        used = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=idle_days)
        path = _make_session_dir(root / ".claudebox" / "sessions", used, session_id=session_id)
        _write_session_record(path, used)
        (path / "tmp").mkdir()

        if payload:
            (path / "tmp" / "venv").mkdir()
            (path / "tmp" / "venv" / "scratch.bin").write_bytes(self.PAYLOAD)

        return path

    def _settings(self, root: Path, content: str) -> None:
        (root / ".claudebox").mkdir(parents=True, exist_ok=True)
        (root / ".claudebox" / "settings.toml").write_text(content)

    def _sweep(self, tmp_path: Path, root: Path) -> SweepReport:
        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", tmp_path / "no-run"),
        ):
            return cleanup_stale_dirs(_make_config(root / ".claudebox"))

    def test_a_session_without_a_record_counts_its_newest_file_as_last_use(
        self,
        _registered,
        tmp_path,
    ):
        session = self._session(tmp_path, "run-session", 30)
        (session / SESSION_METADATA_FILE).unlink()
        (session / SESSION_RUN_ID_FILE).write_text("run-yesterday")
        old = (datetime.now(UTC) - timedelta(days=30)).timestamp()
        os.utime(session, (old, old))

        report = self._sweep(tmp_path, tmp_path)

        assert (session / "tmp" / "venv" / "scratch.bin").exists()
        assert report.emptied == {}

    @pytest.mark.parametrize("days", [800_000, 10**12])
    def test_a_lifetime_past_the_calendar_keeps_every_session(self, _registered, tmp_path, days):
        self._settings(tmp_path, f"[prune]\nsession_days = {days}\n")
        session = self._session(tmp_path, "idle-15-days", 15)

        report = self._sweep(tmp_path, tmp_path)

        assert report.failed == {}
        assert session.is_dir()
        assert session / "tmp" in report.emptied

    def test_an_idle_sessions_tmp_is_emptied_and_the_session_stays(self, _registered, tmp_path):
        session = self._session(tmp_path, "idle-15-days", 15)

        report = self._sweep(tmp_path, tmp_path)

        assert (session / "tmp").is_dir()
        assert list((session / "tmp").iterdir()) == []
        assert (session / "session.json").exists()
        assert report.removed == []
        assert list(report.emptied) == [session / "tmp"]
        assert len(self.PAYLOAD) <= report.emptied[session / "tmp"] < len(self.PAYLOAD) + 65536

    def test_a_session_inside_the_lifetime_keeps_its_tmp(self, _registered, tmp_path):
        session = self._session(tmp_path, "idle-13-days", 13)

        report = self._sweep(tmp_path, tmp_path)

        assert (session / "tmp" / "venv" / "scratch.bin").exists()
        assert report.emptied == {}

    def test_a_pinned_session_keeps_its_tmp(self, _registered, tmp_path):
        session = self._session(tmp_path, "pinned-idle", 15)
        state = {"version": UI_STATE_VERSION, "global": {"pinnedSessions": ["pinned-idle"]}}
        (tmp_path / ".claudebox" / UI_STATE_FILE).write_text(json.dumps(state))

        report = self._sweep(tmp_path, tmp_path)

        assert (session / "tmp" / "venv" / "scratch.bin").exists()
        assert report.emptied == {}

    def test_an_empty_tmp_is_not_reported(self, _registered, tmp_path):
        self._session(tmp_path, "nothing-inside", 15, payload=False)

        assert self._sweep(tmp_path, tmp_path).emptied == {}

    def test_a_tmp_that_is_a_link_is_never_followed(self, _registered, tmp_path):
        session = self._session(tmp_path, "linked-tmp", 15, payload=False)
        (session / "tmp").rmdir()
        elsewhere = tmp_path / "elsewhere"
        elsewhere.mkdir()
        (elsewhere / "keep.txt").write_text("not the session's")
        (session / "tmp").symlink_to(elsewhere)

        report = self._sweep(tmp_path, tmp_path)

        assert (elsewhere / "keep.txt").exists()
        assert report.emptied == {}

    def test_the_workspace_lifetimes_govern_both_actions(self, _registered, tmp_path):
        self._settings(tmp_path, "[prune]\ntmp_days = 3\nsession_days = 30\n")
        recent = self._session(tmp_path, "idle-5-days", 5)
        middle = self._session(tmp_path, "idle-20-days", 20)
        old = self._session(tmp_path, "idle-40-days", 40)

        report = self._sweep(tmp_path, tmp_path)

        assert report.removed == [old]
        assert sorted(report.emptied) == sorted([recent / "tmp", middle / "tmp"])
        assert middle.exists()

    def test_the_home_lifetime_reaches_a_workspace_without_its_own(self, _registered, tmp_path):
        self._settings(Path.home(), "[prune]\ntmp_days = 10\n")
        twelve = self._session(tmp_path, "idle-12-days", 12)
        five = self._session(tmp_path, "idle-5-days", 5)

        report = self._sweep(tmp_path, tmp_path)

        assert list(report.emptied) == [twelve / "tmp"]
        assert (five / "tmp" / "venv" / "scratch.bin").exists()


class TestCleanupStaleTempDirs:
    """Temp build/run directories keep the creation-timestamp rule, unconditionally."""

    def test_removes_old_temp_dirs(self, tmp_path):
        """Exercise temp dir cleanup paths (HOST_TEMP_BUILD_DIR, HOST_TEMP_RUN_DIR)."""

        sessions = tmp_path / ".claudebox" / "sessions"
        sessions.mkdir(parents=True)

        build_dir = tmp_path / "build"
        build_dir.mkdir()
        run_dir = tmp_path / "run"
        run_dir.mkdir()

        old_time = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE - timedelta(days=1)
        old_build = _make_session_dir(build_dir, old_time)
        old_run = _make_session_dir(run_dir, old_time)

        config = _make_config(tmp_path / ".claudebox")

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", build_dir),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", run_dir),
            patch("claudebox.cleanup._registered_workspaces", return_value={}),
        ):
            removed = cleanup_stale_dirs(config).removed

        assert not old_build.exists()
        assert not old_run.exists()
        assert set(removed) == {old_build, old_run}


class TestStaleTempRootsNeverFollowALink:
    """The daily prune never deletes through a temp root someone else can point elsewhere."""

    CUTOFF = datetime(2025, 1, 1, tzinfo=UTC).replace(tzinfo=None)

    def test_a_symlinked_root_is_skipped(self, tmp_path):
        victim = tmp_path / "victim"
        (victim / "20240101-000000--old").mkdir(parents=True)
        root = tmp_path / "run"
        root.symlink_to(victim)

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", root),
        ):
            removed = _cleanup_stale_temp_dirs(self.CUTOFF)

        assert removed == []
        assert (victim / "20240101-000000--old").is_dir()

    def test_a_real_root_is_still_pruned(self, tmp_path):
        root = tmp_path / "run"
        (root / "20240101-000000--old").mkdir(parents=True)

        with (
            patch("claudebox.cleanup.HOST_TEMP_BUILD_DIR", tmp_path / "no-build"),
            patch("claudebox.cleanup.HOST_TEMP_RUN_DIR", root),
        ):
            removed = _cleanup_stale_temp_dirs(self.CUTOFF)

        assert removed == [root / "20240101-000000--old"]
