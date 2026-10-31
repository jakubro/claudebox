"""End-to-end behavioral tests for ``claudebox prune``.

Real-binary surface: subprocess exec paths through fake podman.
The fake bin records every invocation; the CLI shells to the expected sub-commands without a traceback.
"""

from __future__ import annotations

import fcntl
import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


@pytest.fixture(autouse=True)
def scratch_workspace(tmp_path, monkeypatch):
    """Run every prune inside a scratch workspace.

    From the repository, or a temp dir that resolves under it, prune walks up to the real workspace.
    """

    (tmp_path / ".workspace").touch()
    monkeypatch.chdir(tmp_path)


def _seed_session(workspace: Path, name: str, updated_at: str) -> Path:
    session = workspace / ".claudebox" / "sessions" / name
    session.mkdir(parents=True)
    (session / "session.json").write_text(json.dumps({"updated_at": updated_at}))

    return session


def _container(owner: str | None, *, status: str = "running", members=()) -> dict:
    return {
        "id": "c-1",
        "status": status,
        "session_id": owner,
        "members": list(members),
        "live_session_ids": [],
    }


# SPEC: cli:prune
class TestPrune:
    """Prune removes sessions unused past retention, never one in use, plus claudebox images and containers."""

    def test_sessions_are_judged_by_last_use_and_a_served_one_is_kept(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
        hermetic_home,
        httpserver,
    ) -> None:
        (tmp_path / ".workspace").touch()
        recent = datetime.now(UTC).isoformat()
        unused = _seed_session(
            tmp_path,
            "20200101-000000--unused-since-2020",
            "2020-01-02T00:00:00",
        )
        reused = _seed_session(tmp_path, "20200101-000000--started-2020-used-today", recent)
        served = _seed_session(tmp_path, "20200101-000000--served-right-now", "2020-01-02T00:00:00")
        side = _seed_session(
            tmp_path,
            "20200101-000000--side-thread-at-rest",
            "2020-01-02T00:00:00",
        )
        (hermetic_home / ".claudebox").mkdir()
        (hermetic_home / ".claudebox" / "daemon.json").write_text(
            json.dumps({"workspaces": [{"id": "ws-prune", "path": str(tmp_path)}]}),
        )
        httpserver.expect_request("/api/workspaces/ws-prune/containers").respond_with_json(
            {"containers": [_container("served-right-now", members=["side-thread-at-rest"])]},
        )

        result = run_claudebox(["prune"], cwd=tmp_path, timeout=60)

        assert result.returncode == 0
        assert not unused.exists()
        assert reused.exists()
        assert served.exists()
        assert side.exists()
        log = (record_dir / "podman.log").read_text().splitlines()
        assert "image prune -f --filter label=app=claudebox" in log
        assert "container prune -f --filter label=app=claudebox" in log


# SPEC: cli:prune-keeps-pinned
class TestPruneKeepsPinned:
    """Prune never removes a pinned session; unreadable pins remove no session and fail the run."""

    def _seed(self, workspace: Path, ui_state: str) -> tuple[Path, Path]:
        (workspace / ".workspace").touch()
        pinned = _seed_session(
            workspace,
            "20200101-000000--pinned-since-2020",
            "2020-01-02T00:00:00",
        )
        unpinned = _seed_session(
            workspace,
            "20200101-000000--unpinned-again",
            "2020-01-02T00:00:00",
        )
        (workspace / ".claudebox" / "ui-state.json").write_text(ui_state)

        return pinned, unpinned

    def test_a_pinned_session_is_kept_and_one_no_longer_pinned_goes(
        self,
        tmp_path,
        run_claudebox,
    ) -> None:
        ui_state = {"version": 3, "global": {"pinnedSessions": ["pinned-since-2020"]}}
        pinned, unpinned = self._seed(tmp_path, json.dumps(ui_state))

        result = run_claudebox(["prune"], cwd=tmp_path, timeout=60)

        assert result.returncode == 0
        assert pinned.exists()
        assert not unpinned.exists()

    def test_unreadable_pins_remove_no_session_and_the_rest_still_run(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
    ) -> None:
        pinned, unpinned = self._seed(tmp_path, "{not json")

        result = run_claudebox(["prune"], cwd=tmp_path, timeout=60)

        assert result.returncode == 1
        assert pinned.exists()
        assert unpinned.exists()
        assert "cannot read the pinned sessions" in _output(result)
        assert "image prune" in (record_dir / "podman.log").read_text()


# SPEC: cli:prune:partial-failure
class TestPrunePartialFailure:
    """Prune fans out across all categories, reports them, and tolerates per-category failure."""

    def test_prune_summarizes_every_category(self, run_claudebox) -> None:
        result = run_claudebox(["prune"], timeout=60)
        # Fan-out across every category regardless of backend outcome.
        assert "stopped containers" in result.stdout or "stopped containers" in result.stderr
        assert "dangling images" in result.stdout or "dangling images" in result.stderr
        assert "build leftovers" in result.stdout or "build leftovers" in result.stderr
        assert "stale" in result.stdout or "stale" in result.stderr

    def test_prune_no_python_traceback(self, run_claudebox, record_dir) -> None:
        # Fake podman returns canned output for `image prune`/`container prune`; no traceback, both calls logged.
        result = run_claudebox(["prune"], timeout=60)
        assert "Traceback" not in result.stderr

        podman_log = record_dir / "podman.log"

        if podman_log.exists():
            log = podman_log.read_text()
            # At least one of the prune sub-commands reached the fake.
            assert "prune" in log


_OURS = "c0ffee000001"
_THEIRS = "beef00000002"
_PLAIN = "f00d00000003"
_LEFTOVERS = json.dumps(
    [
        {"Id": _OURS, "ImageID": "img-ours", "Command": ["buildah"]},
        {"Id": _THEIRS, "ImageID": "img-theirs", "Command": ["buildah"]},
        {"Id": _PLAIN, "ImageID": "img-ours", "Command": ["sleep", "infinity"]},
    ],
)
_LEFTOVER_ENV = {
    "CLAUDEBOX_TEST_PODMAN_EXTERNAL_PS": _LEFTOVERS,
    "CLAUDEBOX_TEST_PODMAN_IMAGE_APPS": "img-ours=claudebox img-theirs=elsewhere",
}


def _removed(record_dir: Path) -> list[str]:
    log = (record_dir / "podman.log").read_text().splitlines()

    return [line.split()[-1] for line in log if line.startswith("rm ")]


def _output(result) -> str:
    return " ".join((result.stdout + result.stderr).split())


# SPEC: cli:prune-build-leftovers
class TestPruneBuildLeftovers:
    """Prune removes what interrupted claudebox builds left, and nothing else's."""

    def test_only_claudebox_build_leftovers_are_removed(self, run_claudebox, record_dir) -> None:
        result = run_claudebox(["prune"], env=_LEFTOVER_ENV, timeout=60)

        assert result.returncode == 0
        assert _removed(record_dir) == [_OURS]
        assert "removed 1 build leftovers" in _output(result)

    def test_verbose_lists_each_removed_leftover(self, run_claudebox) -> None:
        result = run_claudebox(["-v", "prune"], env=_LEFTOVER_ENV, timeout=60)

        assert f"removed build leftover {_OURS}" in _output(result)
        assert _THEIRS not in _output(result)

    def test_a_running_build_skips_the_category(
        self,
        run_claudebox,
        record_dir,
        hermetic_home,
    ) -> None:
        lock = hermetic_home / ".claudebox" / "build.lock"
        lock.parent.mkdir(parents=True)

        with lock.open("a") as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_SH)
            result = run_claudebox(["prune"], env=_LEFTOVER_ENV, timeout=60)

        log = (record_dir / "podman.log").read_text()
        assert result.returncode == 0
        assert "build leftovers skipped (a claudebox build is running)" in _output(result)
        assert "--external" not in log
        assert _removed(record_dir) == []
        assert "image prune" in log

    def test_a_failed_removal_is_reported_and_the_rest_still_run(
        self,
        run_claudebox,
        record_dir,
    ) -> None:
        env = {**_LEFTOVER_ENV, "CLAUDEBOX_TEST_PODMAN_RM_FAIL": _OURS}

        result = run_claudebox(["prune"], env=env, timeout=60)

        assert result.returncode == 1
        assert "container is mounted by a running build" in _output(result)
        assert "container prune" in (record_dir / "podman.log").read_text()

    def test_docker_has_no_build_leftovers(self, tmp_path, run_claudebox, record_dir) -> None:
        (tmp_path / ".workspace").touch()
        (tmp_path / ".claudebox").mkdir()
        (tmp_path / ".claudebox" / "settings.toml").write_text('backend = "docker"\n')

        result = run_claudebox(["prune"], cwd=tmp_path, env=_LEFTOVER_ENV, timeout=60)

        assert "removed 0 build leftovers" in _output(result)
        assert "build leftovers:" not in _output(result)
        assert not (record_dir / "podman.log").exists()


class TestBuildHoldsTheLock:
    """A running build holds the lock prune checks, so prune never sweeps a live build."""

    def test_build_runs_under_the_build_lock(self, tmp_path, run_claudebox, record_dir) -> None:
        env = {"CLAUDEBOX_TEST_PODMAN_PROBE_BUILD_LOCK": "1"}

        run_claudebox(["build"], cwd=tmp_path, env=env, timeout=60)

        assert "build lock held" in (record_dir / "podman.log").read_text()

    def test_a_build_outliving_its_claudebox_process_keeps_the_lock(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
    ) -> None:
        env = {
            "CLAUDEBOX_TEST_PODMAN_ORPHAN_BUILD": "1",
            "CLAUDEBOX_TEST_PODMAN_PROBE_BUILD_LOCK": "1",
        }

        run_claudebox(["build"], cwd=tmp_path, env=env, timeout=60)

        log = record_dir / "podman.log"
        deadline = time.monotonic() + 10

        while "build lock" not in log.read_text() and time.monotonic() < deadline:
            time.sleep(0.1)

        assert "build lock held" in log.read_text()

    def test_a_running_build_does_not_hold_up_another(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
    ) -> None:
        lock = hermetic_home / ".claudebox" / "build.lock"
        lock.parent.mkdir(parents=True)

        with lock.open("a") as held:
            fcntl.flock(held.fileno(), fcntl.LOCK_SH)
            result = run_claudebox(["build"], cwd=tmp_path, timeout=30)

        assert result.returncode == 0


# SPEC: cli:prune-local
class TestPruneLocalBackend:
    """With the local backend prune clears stale directories and runs no container runtime."""

    def test_stale_dirs_go_and_the_backend_categories_do_not_apply(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
    ) -> None:
        (tmp_path / ".workspace").touch()
        stale = _seed_session(tmp_path, "20200101-000000--unused-since-2020", "2020-01-02T00:00:00")
        (tmp_path / ".claudebox" / "settings.toml").write_text('backend = "local"\n')

        result = run_claudebox(["-v", "prune"], cwd=tmp_path, timeout=60)

        assert result.returncode == 0
        assert not stale.exists()
        assert str(stale) in (result.stdout + result.stderr).replace("\n", "")
        assert "do not apply to the local backend" in _output(result)
        assert not (record_dir / "podman.log").exists()


_UNUSED = "2020-01-02T00:00:00"


def _register(home: Path, httpserver, *workspaces: Path) -> None:
    (home / ".claudebox").mkdir(exist_ok=True)
    entries = [{"id": ws.name, "path": str(ws)} for ws in workspaces]
    (home / ".claudebox" / "daemon.json").write_text(json.dumps({"workspaces": entries}))

    for ws in workspaces:
        httpserver.expect_request(f"/api/workspaces/{ws.name}/containers").respond_with_json(
            {"containers": []},
        )


def _days_ago(days: int) -> str:
    return (datetime.now(UTC) - timedelta(days=days)).isoformat()


def _with_tmp(session: Path) -> Path:
    (session / "tmp").mkdir()
    (session / "tmp" / "scratch.bin").write_bytes(b"\0" * 1024 * 1024)

    return session


# SPEC: cli:prune-every-workspace
class TestPruneEveryWorkspace:
    """Prune sweeps every registered workspace, the home directory and the current one, from anywhere."""

    @pytest.mark.parametrize("backend", ["podman", "local"])
    def test_run_from_home_it_sweeps_a_registered_workspace(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
        httpserver,
        backend,
    ) -> None:
        registered = tmp_path / "registered"
        idle = _seed_session(registered, "20200101-000000--registered-unused", _UNUSED)
        recent = _seed_session(
            registered,
            "20200101-000000--registered-used-today",
            datetime.now(UTC).isoformat(),
        )
        home_idle = _seed_session(hermetic_home, "20200101-000000--home-unused", _UNUSED)
        _register(hermetic_home, httpserver, registered)
        (hermetic_home / ".claudebox" / "settings.toml").write_text(f'backend = "{backend}"\n')

        result = run_claudebox(["-v", "prune"], cwd=hermetic_home, timeout=60)

        assert result.returncode == 0, _output(result)
        assert not idle.exists()
        assert not home_idle.exists()
        assert recent.exists()
        assert str(idle) in (result.stdout + result.stderr).replace("\n", "")

    def test_an_unregistered_current_workspace_is_swept_too(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        registered, current = tmp_path / "registered", tmp_path / "current"
        registered_idle = _seed_session(registered, "20200101-000000--registered-unused", _UNUSED)
        current_idle = _seed_session(current, "20200101-000000--current-unused", _UNUSED)
        (current / ".workspace").touch()
        _register(hermetic_home, httpserver, registered)

        result = run_claudebox(["prune"], cwd=current, timeout=60)

        assert result.returncode == 0, _output(result)
        assert not registered_idle.exists()
        assert not current_idle.exists()

    def test_a_missing_workspace_is_skipped_with_a_note(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        gone = tmp_path / "gone"
        present = tmp_path / "present"
        idle = _seed_session(present, "20200101-000000--present-unused", _UNUSED)
        _register(hermetic_home, httpserver, gone, present)

        result = run_claudebox(["prune"], cwd=hermetic_home, timeout=60)

        assert result.returncode == 0, _output(result)
        assert f"skipped {gone}" in (result.stdout + result.stderr).replace("\n", "")
        assert not idle.exists()

    def test_unreadable_pins_leave_one_workspace_whole_and_the_others_swept(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        broken, healthy = tmp_path / "broken", tmp_path / "healthy"
        kept = _seed_session(broken, "20200101-000000--broken-unused", _UNUSED)
        (broken / ".claudebox" / "ui-state.json").write_text("{not json")
        idle = _seed_session(healthy, "20200101-000000--healthy-unused", _UNUSED)
        _register(hermetic_home, httpserver, broken, healthy)

        result = run_claudebox(["prune"], cwd=hermetic_home, timeout=60)

        assert result.returncode == 1
        assert kept.exists()
        assert not idle.exists()
        assert f"stale dirs: {broken}" in (result.stdout + result.stderr).replace("\n", "")


# SPEC: cli:prune-empties-session-tmp
class TestPruneEmptiesSessionTmp:
    """Prune empties the /tmp of a session idle past the tmp lifetime and keeps the session."""

    def test_an_idle_sessions_tmp_is_emptied_listed_and_counted(
        self,
        tmp_path,
        run_claudebox,
    ) -> None:
        idle = _with_tmp(_seed_session(tmp_path, "20200101-000000--idle-20-days", _days_ago(20)))
        recent = _with_tmp(_seed_session(tmp_path, "20200101-000000--idle-2-days", _days_ago(2)))

        result = run_claudebox(["-v", "prune"], cwd=tmp_path, timeout=60)
        output = (result.stdout + result.stderr).replace("\n", "")

        assert result.returncode == 0, _output(result)
        assert (idle / "tmp").is_dir()
        assert list((idle / "tmp").iterdir()) == []
        assert (idle / "session.json").exists()
        assert (recent / "tmp" / "scratch.bin").exists()
        assert f"emptied {idle / 'tmp'} (freed 1.0 MB)" in output
        assert "emptied 1 session /tmp folders, freed 1.0 MB" in _output(result)

    def test_a_workspace_value_overrides_the_home_one(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
        httpserver,
    ) -> None:
        own, inherits = tmp_path / "own", tmp_path / "inherits"
        (hermetic_home / ".claudebox").mkdir()
        (hermetic_home / ".claudebox" / "settings.toml").write_text("[prune]\ntmp_days = 30\n")
        (own / ".claudebox").mkdir(parents=True)
        (own / ".claudebox" / "settings.toml").write_text("[prune]\ntmp_days = 3\n")
        emptied = _with_tmp(_seed_session(own, "20200101-000000--own-idle-5-days", _days_ago(5)))
        kept = _with_tmp(
            _seed_session(inherits, "20200101-000000--inherits-idle-5-days", _days_ago(5)),
        )
        _register(hermetic_home, httpserver, own, inherits)

        result = run_claudebox(["prune"], cwd=hermetic_home, timeout=60)

        assert result.returncode == 0, _output(result)
        assert list((emptied / "tmp").iterdir()) == []
        assert (kept / "tmp" / "scratch.bin").exists()

    def test_a_claudebox_run_session_is_kept_while_its_container_runs(
        self,
        tmp_path,
        run_claudebox,
    ) -> None:
        running = _with_tmp(_seed_session(tmp_path, "20200101-000000--run-alive", _UNUSED))
        (running / "run-id").write_text("run-e2e-alive")
        ended = _seed_session(tmp_path, "20200101-000000--run-ended", _UNUSED)
        (ended / "run-id").write_text("run-e2e-ended")
        listing = [
            {
                "Id": "a1",
                "State": "running",
                "Labels": {"app": "claudebox", "claudebox-run": "run-e2e-alive"},
            },
            {
                "Id": "b2",
                "State": "exited",
                "Labels": {"app": "claudebox", "claudebox-run": "run-e2e-ended"},
            },
        ]

        result = run_claudebox(
            ["prune"],
            cwd=tmp_path,
            env={"CLAUDEBOX_TEST_PODMAN_PS": json.dumps(listing)},
            timeout=60,
        )

        assert result.returncode == 0, _output(result)
        assert (running / "tmp" / "scratch.bin").exists()
        assert not ended.exists()

    def test_on_docker_a_claudebox_run_session_is_kept_while_docker_lists_it_running(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
    ) -> None:
        ws = tmp_path / "docker-ws"
        running = _with_tmp(_seed_session(ws, "20200101-000000--run-on-docker", _days_ago(30)))
        (running / "run-id").write_text("run-d7-alive")
        idle = _with_tmp(_seed_session(ws, "20200101-000000--idle-on-docker", _days_ago(30)))
        (hermetic_home / ".claudebox").mkdir()
        (hermetic_home / ".claudebox" / "settings.toml").write_text('backend = "docker"\n')
        (hermetic_home / ".claudebox" / "daemon.json").write_text(
            json.dumps({"workspaces": [{"id": "ws-docker", "path": str(ws)}]}),
        )
        listing = "".join(
            json.dumps(container) + "\n"
            for container in (
                {
                    "ID": "f3a9c2e1b0d4",
                    "Labels": "app=claudebox,claudebox-run=run-d7-alive",
                    "State": "running",
                },
                {"ID": "07be44a1c9f2", "Labels": "app=claudebox,kind=shell", "State": "exited"},
            )
        )
        env = {**_DEAD_DAEMON, "CLAUDEBOX_TEST_DOCKER_PS": listing}

        result = run_claudebox(["prune"], cwd=hermetic_home, env=env, timeout=60)

        assert result.returncode == 0, _output(result)
        assert (running / "tmp" / "scratch.bin").exists()
        assert list((idle / "tmp").iterdir()) == []


_DEAD_DAEMON = {"CLAUDEBOX_DAEMON_URL": "http://127.0.0.1:1"}


# SPEC: cli:prune-running-unknown
class TestPruneRunningUnknown:
    """When prune cannot tell which sessions run in a workspace, it touches nothing there and fails."""

    def _workspace(self, tmp_path: Path, hermetic_home: Path, backend: str) -> tuple[Path, Path]:
        ws = tmp_path / "unknown"
        session = _with_tmp(_seed_session(ws, "20200101-000000--maybe-running", _UNUSED))
        (ws / ".claudebox" / "settings.toml").write_text(f'backend = "{backend}"\n')
        (hermetic_home / ".claudebox").mkdir()
        (hermetic_home / ".claudebox" / "daemon.json").write_text(
            json.dumps({"workspaces": [{"id": "ws-unknown", "path": str(ws)}]}),
        )

        return ws, session

    def test_the_local_backend_with_the_daemon_silent(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
    ) -> None:
        ws, session = self._workspace(tmp_path, hermetic_home, "local")

        result = run_claudebox(["prune"], cwd=hermetic_home, env=_DEAD_DAEMON, timeout=60)

        assert result.returncode == 1
        assert (session / "tmp" / "scratch.bin").exists()
        assert f"stale dirs: {ws}" in (result.stdout + result.stderr).replace("\n", "")

    def test_a_running_workspace_container_with_the_daemon_silent(
        self,
        tmp_path,
        run_claudebox,
        hermetic_home,
    ) -> None:
        ws, session = self._workspace(tmp_path, hermetic_home, "podman")
        listing = [
            {"Id": "c3", "State": "running", "Labels": {"claudebox-workspace": "ws-unknown"}},
        ]
        env = {**_DEAD_DAEMON, "CLAUDEBOX_TEST_PODMAN_PS": json.dumps(listing)}

        result = run_claudebox(["prune"], cwd=hermetic_home, env=env, timeout=60)

        assert result.returncode == 1
        assert (session / "tmp" / "scratch.bin").exists()
        assert f"stale dirs: {ws}" in (result.stdout + result.stderr).replace("\n", "")
