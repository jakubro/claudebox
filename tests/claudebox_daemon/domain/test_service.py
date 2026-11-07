"""Tests for claudebox_daemon.domain.service - daemon service orchestration."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox_daemon.domain.config import DaemonConfig
from claudebox_daemon.domain.errors import ValidationError, WorkspaceNotRegistered
from claudebox_daemon.domain.service import DaemonService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from ...conftest import bounded_walk_up


# --- Helpers ---


_PATCHES = (
    "claudebox_daemon.domain.service.DaemonConfig",
    "claudebox_daemon.domain.service.ContainerProxyClient",
    "claudebox_daemon.domain.service.DaemonBroadcaster",
    "claudebox_daemon.domain.service.HealthMonitor",
    "claudebox_daemon.domain.service.SessionMutationObserver",
    "claudebox_daemon.domain.service.DaemonWatchdog",
    "claudebox_daemon.domain.service.WorkspaceService",
    "claudebox_daemon.domain.service.ServingProbe",
)


def _config_get_workspace(config):
    """Return a side_effect function that looks up workspaces on the config instance."""

    def _lookup(workspace_id: str) -> RegisteredWorkspace:
        for ws in config.workspaces:
            if ws.id == workspace_id:
                return ws

        raise WorkspaceNotRegistered(workspace_id=workspace_id)

    return _lookup


def _make_service(
    workspaces: list[RegisteredWorkspace] | None = None,
    *,
    mocks: dict,
) -> DaemonService:
    """Create a DaemonService with mocked deps; keep the patches dict alive for the test."""

    MockConfig = mocks["DaemonConfig"]
    MockHealth = mocks["HealthMonitor"]
    MockMutation = mocks["SessionMutationObserver"]
    MockWatchdog = mocks["DaemonWatchdog"]
    MockProxy = mocks["ContainerProxyClient"]

    health_instance = MockHealth.return_value
    health_instance.probe_once = AsyncMock()
    health_instance.start = AsyncMock()
    health_instance.stop = AsyncMock()

    mutation_instance = MockMutation.return_value
    mutation_instance.start = AsyncMock()
    mutation_instance.stop = AsyncMock()

    watchdog_instance = MockWatchdog.return_value
    watchdog_instance.start = AsyncMock()
    watchdog_instance.stop = AsyncMock()

    serving_instance = mocks["ServingProbe"].return_value
    serving_instance.start = AsyncMock()
    serving_instance.stop = AsyncMock()
    serving_instance.healthy = True
    serving_instance.failing = []
    serving_instance.last_latency_seconds = {}

    proxy_instance = MockProxy.return_value
    proxy_instance.close = AsyncMock()

    config_instance = MockConfig.load.return_value
    config_instance.workspaces = workspaces or []
    config_instance.get_workspace = MagicMock(side_effect=_config_get_workspace(config_instance))

    MockWS = mocks["WorkspaceService"]
    ws_instance = AsyncMock()
    MockWS.return_value = ws_instance

    svc = DaemonService()

    return svc


def _make_workspace(workspace_id: str, path: Path) -> RegisteredWorkspace:
    """Create a RegisteredWorkspace pointing at a real directory."""

    return RegisteredWorkspace(id=workspace_id, path=path)


@pytest.fixture
def patched():
    """Activate all DaemonService dependency patches for the test lifetime."""

    with (
        patch(_PATCHES[0]) as m_config,
        patch(_PATCHES[1]) as m_proxy,
        patch(_PATCHES[2]) as m_broadcaster,
        patch(_PATCHES[3]) as m_health,
        patch(_PATCHES[4]) as m_mutation,
        patch(_PATCHES[5]) as m_watchdog,
        patch(_PATCHES[6]) as m_ws,
        patch(_PATCHES[7]) as m_serving,
    ):
        yield {
            "DaemonConfig": m_config,
            "ContainerProxyClient": m_proxy,
            "DaemonBroadcaster": m_broadcaster,
            "HealthMonitor": m_health,
            "SessionMutationObserver": m_mutation,
            "DaemonWatchdog": m_watchdog,
            "WorkspaceService": m_ws,
            "ServingProbe": m_serving,
        }


# --- executor ownership ---


class TestExecutorOwnership:
    """Test DaemonService's dedicated pools, one per class of blocking work."""

    def test_constructs_a_bounded_pool_per_concern(self, patched):
        from concurrent.futures import ThreadPoolExecutor

        from claudebox_daemon.domain.executors import (
            LISTING_WORKERS,
            PODMAN_WORKERS,
            STATE_WORKERS,
        )

        svc = _make_service(mocks=patched)
        pools = svc._executors

        assert isinstance(pools.listing, ThreadPoolExecutor)
        assert isinstance(pools.podman, ThreadPoolExecutor)
        assert isinstance(pools.state, ThreadPoolExecutor)
        assert pools.listing._max_workers == LISTING_WORKERS
        assert pools.podman._max_workers == PODMAN_WORKERS
        assert pools.state._max_workers == STATE_WORKERS

    def test_the_pools_are_distinct_objects(self, patched):
        """Sharing one pool is what let a listing backlog stop podman dispatch and registry writes."""

        svc = _make_service(mocks=patched)
        pools = svc._executors

        assert len({id(pools.listing), id(pools.podman), id(pools.state)}) == 3


# --- start / stop lifecycle ---


class TestStart:
    """Test daemon service startup."""

    @pytest.mark.anyio
    async def test_start_syncs_state_and_starts_health_monitor(self, patched):
        svc = _make_service(mocks=patched)

        await svc.start()

        svc._health_monitor.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        assert svc._health_monitor is not None

    @pytest.mark.anyio
    async def test_start_runs_one_health_pass_before_the_monitor_starts(self, patched):
        svc = _make_service(mocks=patched)
        order = MagicMock()
        order.attach_mock(svc._health_monitor.probe_once, "probe_once")  # ty: ignore[invalid-argument-type]
        order.attach_mock(svc._health_monitor.start, "start")  # ty: ignore[invalid-argument-type]

        await svc.start()

        assert [c[0] for c in order.mock_calls] == ["probe_once", "start"]

    @pytest.mark.anyio
    async def test_start_starts_the_watchdog(self, patched):
        svc = _make_service(mocks=patched)

        await svc.start()

        svc.watchdog.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_start_loads_registered_workspaces(self, tmp_path, patched):
        ws_path = tmp_path / "my-project"
        ws_path.mkdir()
        ws = _make_workspace("my-project", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)

        await svc.start()

        MockWS = patched["WorkspaceService"]
        MockWS.assert_called_once_with(ws, svc.events, svc.proxy, svc._executors)
        MockWS.return_value.start.assert_awaited_once()
        assert "my-project" in svc._workspaces

    @pytest.mark.anyio
    async def test_start_skips_workspace_on_load_failure(self, tmp_path, patched):
        ws = _make_workspace("broken", tmp_path / "broken")

        svc = _make_service(workspaces=[ws], mocks=patched)

        MockWS = patched["WorkspaceService"]
        MockWS.side_effect = RuntimeError("config load failed")

        # Should not raise - logs and continues
        await svc.start()

        assert "broken" not in svc._workspaces


class TestStop:
    """Test daemon service shutdown."""

    @pytest.mark.anyio
    async def test_stop_stops_health_monitor_and_proxy(self, patched):
        svc = _make_service(mocks=patched)

        await svc.stop()

        svc._health_monitor.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        svc.proxy.close.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        assert len(svc._workspaces) == 0

    @pytest.mark.anyio
    async def test_stop_stops_the_watchdog(self, patched):
        svc = _make_service(mocks=patched)

        await svc.stop()

        svc.watchdog.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_stop_releases_every_daemon_pool(self, patched):
        svc = _make_service(mocks=patched)
        pools = [svc._executors.listing, svc._executors.podman, svc._executors.state]

        await svc.stop()

        for pool in pools:
            with pytest.raises(RuntimeError):
                pool.submit(lambda: None)

    @pytest.mark.anyio
    async def test_stop_stops_all_workspace_services(self, patched):
        svc = _make_service(mocks=patched)

        ws1 = AsyncMock()
        ws2 = AsyncMock()
        svc._workspaces = {"ws1": ws1, "ws2": ws2}

        await svc.stop()

        ws1.stop.assert_awaited_once()
        ws2.stop.assert_awaited_once()

    @pytest.mark.anyio
    async def test_stop_with_no_workspaces(self, patched):
        svc = _make_service(mocks=patched)

        # Should not raise
        await svc.stop()

        svc._health_monitor.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        assert svc._workspaces == {}


# --- get_workspace ---


class TestGetWorkspace:
    """Test workspace lazy-loading via get_workspace."""

    @pytest.mark.anyio
    async def test_lazy_loads_from_config_on_cache_miss(self, tmp_path, patched):
        ws_path = tmp_path / "lazy-ws"
        ws_path.mkdir()
        ws = _make_workspace("lazy-ws", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)

        result = await svc.get_workspace("lazy-ws")

        MockWS = patched["WorkspaceService"]
        assert result is MockWS.return_value
        MockWS.return_value.start.assert_awaited()
        assert "lazy-ws" in svc._workspaces

    @pytest.mark.anyio
    async def test_raises_not_registered_for_unknown_workspace(self, patched):
        svc = _make_service(mocks=patched)

        with pytest.raises(WorkspaceNotRegistered):
            await svc.get_workspace("nonexistent")

    @pytest.mark.anyio
    async def test_rebuilds_a_cached_workspace_whose_directory_has_returned(
        self,
        tmp_path,
        patched,
    ):
        """A stale, snapshotted-unavailable entry is replaced once the directory exists again -
        recovery on the next request, not only on the next sync."""

        ws_path = tmp_path / "returned"
        ws = _make_workspace("returned", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)

        MockWS = patched["WorkspaceService"]
        stale = AsyncMock()
        stale.workspace = ws
        stale.available = False
        fresh = AsyncMock()
        fresh.workspace = ws
        fresh.available = True
        MockWS.side_effect = [stale, fresh]

        result1 = await svc.get_workspace("returned")
        assert result1 is stale

        ws_path.mkdir()

        result2 = await svc.get_workspace("returned")
        assert result2 is fresh
        assert svc._workspaces["returned"] is fresh

    @pytest.mark.anyio
    async def test_does_not_rebuild_a_cached_workspace_that_is_still_available(
        self,
        tmp_path,
        patched,
    ):
        ws_path = tmp_path / "fine"
        ws_path.mkdir()
        ws = _make_workspace("fine", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)

        MockWS = patched["WorkspaceService"]
        cached = AsyncMock()
        cached.workspace = ws
        cached.available = True
        MockWS.return_value = cached

        result1 = await svc.get_workspace("fine")
        result2 = await svc.get_workspace("fine")

        assert result1 is cached
        assert result2 is cached
        MockWS.assert_called_once()

    @pytest.mark.anyio
    async def test_reloads_config_on_cache_miss(self, tmp_path, patched):
        ws_path = tmp_path / "new-ws"
        ws_path.mkdir()
        ws = _make_workspace("new-ws", ws_path)

        svc = _make_service(mocks=patched)

        # Simulate workspace added to config after daemon started
        config = svc._daemon_config
        original_load = patched["DaemonConfig"].load

        def reload_with_new_ws():
            config.workspaces = [ws]
            config.get_workspace = MagicMock(side_effect=_config_get_workspace(config))

            return config

        original_load.side_effect = reload_with_new_ws

        result = await svc.get_workspace("new-ws")

        MockWS = patched["WorkspaceService"]
        assert result is MockWS.return_value


# --- concurrent loads ---


def _suspending_services(mocks, *, fail: bool = False) -> list:
    """Make each WorkspaceService built a distinct instance whose start suspends three times."""

    built = []

    def build(workspace, *_args):
        svc = MagicMock()
        svc.workspace = workspace
        svc.available = True

        async def start():
            for _ in range(3):
                await asyncio.sleep(0)

            if fail:
                raise RuntimeError("network creation failed")

        svc.start = start
        svc.stop = AsyncMock()
        built.append(svc)

        return svc

    mocks["WorkspaceService"].side_effect = build

    return built


class TestConcurrentLoads:
    """Every load of one workspace joins the load already in flight."""

    @pytest.mark.anyio
    async def test_concurrent_requests_on_a_miss_share_one_service(self, tmp_path, patched):
        ws_path = tmp_path / "ws"
        ws_path.mkdir()
        svc = _make_service(workspaces=[_make_workspace("ws", ws_path)], mocks=patched)
        built = _suspending_services(patched)

        results = await asyncio.gather(*(svc.get_workspace("ws") for _ in range(5)))

        assert len(built) == 1
        assert all(result is built[0] for result in results)

    @pytest.mark.anyio
    async def test_a_returned_directory_is_rebuilt_once(self, tmp_path, patched):
        ws_path = tmp_path / "ws"
        ws = _make_workspace("ws", ws_path)
        svc = _make_service(workspaces=[ws], mocks=patched)
        stale = MagicMock(workspace=ws, available=False)
        svc._workspaces["ws"] = stale
        ws_path.mkdir()
        built = _suspending_services(patched)

        results = await asyncio.gather(*(svc.get_workspace("ws") for _ in range(5)))

        assert len(built) == 1
        assert all(result is built[0] for result in results)

    @pytest.mark.anyio
    async def test_a_registration_racing_a_listing_loads_once(self, tmp_path, patched):
        ws_path = tmp_path / "ws"
        ws_path.mkdir()
        ws = _make_workspace("ws", ws_path)
        svc = _make_service(mocks=patched)
        config = svc._daemon_config

        def register(_path):
            config.workspaces = [ws]

            return ws

        config.find_workspace = MagicMock(return_value=None)
        config.register_workspace = MagicMock(side_effect=register)
        built = _suspending_services(patched)

        await asyncio.gather(svc.register_workspace(ws_path), svc.list_workspaces(sync=True))

        assert len(built) == 1
        assert svc._workspaces["ws"] is built[0]

    @pytest.mark.anyio
    async def test_a_deregistration_during_a_load_stops_what_it_built(self, tmp_path, patched):
        ws_path = tmp_path / "ws"
        ws_path.mkdir()
        svc = _make_service(workspaces=[_make_workspace("ws", ws_path)], mocks=patched)
        svc._daemon_config.deregister_workspace = MagicMock(return_value=True)
        built = _suspending_services(patched)

        load = asyncio.ensure_future(svc.get_workspace("ws"))
        await asyncio.sleep(0)
        await svc.deregister_workspace("ws")
        await load

        assert "ws" not in svc._workspaces
        built[0].stop.assert_awaited_once()

    @pytest.mark.anyio
    async def test_a_load_whose_caller_left_is_still_stored(self, tmp_path, patched):
        ws_path = tmp_path / "ws"
        ws_path.mkdir()
        svc = _make_service(workspaces=[_make_workspace("ws", ws_path)], mocks=patched)
        built = _suspending_services(patched)

        caller = asyncio.ensure_future(svc.get_workspace("ws"))
        await asyncio.sleep(0)
        caller.cancel()

        async with asyncio.timeout(5):
            while "ws" in svc._loads:
                await asyncio.sleep(0.01)

        assert svc._workspaces["ws"] is built[0]

    @pytest.mark.anyio
    async def test_a_failed_load_reaches_every_caller_and_the_next_request_retries(
        self,
        tmp_path,
        patched,
    ):
        ws_path = tmp_path / "ws"
        ws_path.mkdir()
        svc = _make_service(workspaces=[_make_workspace("ws", ws_path)], mocks=patched)
        built = _suspending_services(patched, fail=True)

        results = await asyncio.gather(
            *(svc.get_workspace("ws") for _ in range(3)),
            return_exceptions=True,
        )

        assert len(built) == 1
        assert all(isinstance(result, RuntimeError) for result in results)

        _suspending_services(patched)
        assert (await svc.get_workspace("ws")).available


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    """A home of its own under tmp_path, with no workspace marker above tmp_path."""

    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: home))
    monkeypatch.setattr("claudebox.paths.walk_up", bounded_walk_up(tmp_path))

    return tmp_path


def _registering_service(tmp_path, mocks) -> DaemonService:
    svc = _make_service(mocks=mocks)
    svc._daemon_config = DaemonConfig(path=tmp_path / "daemon.json")

    return svc


class TestRegisterWorkspace:
    """Registering a directory makes it a workspace of its own, or refuses it whole."""

    @pytest.mark.anyio
    async def test_a_directory_without_a_marker_gets_one(self, isolated, patched):
        project = isolated / "my-project"
        project.mkdir()
        svc = _registering_service(isolated, patched)

        workspace, already_registered = await svc.register_workspace(str(project))

        assert (project / ".workspace").is_file()
        assert (workspace.id, workspace.path, already_registered) == ("my-project", project, False)
        assert [w.path for w in svc._daemon_config.workspaces] == [project]

    @pytest.mark.anyio
    async def test_a_home_relative_path_registers_the_directory_it_names(self, isolated, patched):
        (isolated / "home" / "my-project").mkdir()
        svc = _registering_service(isolated, patched)

        workspace, _ = await svc.register_workspace("~/my-project")

        assert workspace.path == isolated / "home" / "my-project"
        assert (isolated / "home" / "my-project" / ".workspace").is_file()

    @pytest.mark.anyio
    async def test_a_repeat_says_it_was_already_registered(self, isolated, patched):
        project = isolated / "my-project"
        project.mkdir()
        svc = _registering_service(isolated, patched)

        first, _ = await svc.register_workspace(str(project))
        again, already_registered = await svc.register_workspace(str(isolated / "." / "my-project"))

        assert (again, already_registered) == (first, True)
        assert len(svc._daemon_config.workspaces) == 1

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("path", "error_key", "message"),
        [
            ("my-project", "workspace_path_relative", "Not an absolute path: my-project"),
            ("~no-such-user/x", "workspace_path_relative", "Not an absolute path: ~no-such-user/x"),
            ("{root}/nowhere", "workspace_path_missing", "No directory at {root}/nowhere"),
            (
                "{root}/notes.txt",
                "workspace_path_not_a_directory",
                "Not a directory: {root}/notes.txt",
            ),
        ],
        ids=["relative", "unknown-user", "missing", "file"],
    )
    async def test_a_path_that_names_no_directory_is_refused(
        self,
        isolated,
        patched,
        path,
        error_key,
        message,
    ):
        (isolated / "notes.txt").write_text("not a workspace")
        svc = _registering_service(isolated, patched)

        with pytest.raises(ValidationError) as excinfo:
            await svc.register_workspace(path.format(root=isolated))

        assert excinfo.value.error_key == error_key
        assert excinfo.value.context["message"] == message.format(root=isolated)
        assert svc._daemon_config.workspaces == []

    @pytest.mark.anyio
    async def test_a_directory_that_cannot_be_marked_is_refused(
        self,
        isolated,
        patched,
        monkeypatch,
    ):
        project = isolated / "read-only"
        project.mkdir()
        svc = _registering_service(isolated, patched)

        def refuse(path, *_args, **_kwargs):
            raise PermissionError(13, "Permission denied", str(path))

        monkeypatch.setattr("pathlib.Path.touch", refuse)

        with pytest.raises(ValidationError) as excinfo:
            await svc.register_workspace(str(project))

        assert excinfo.value.error_key == "workspace_marker_unwritable"
        assert excinfo.value.context["message"] == (
            f"Cannot create the .workspace marker in {project}: Permission denied"
        )
        assert svc._daemon_config.workspaces == []

    @pytest.mark.anyio
    async def test_a_path_that_cannot_be_examined_is_refused(self, isolated, patched):
        too_long = isolated / ("a" * 300)
        svc = _registering_service(isolated, patched)

        with pytest.raises(ValidationError) as excinfo:
            await svc.register_workspace(str(too_long))

        assert excinfo.value.error_key == "workspace_marker_unwritable"
        assert svc._daemon_config.workspaces == []

    @pytest.mark.anyio
    async def test_a_repeat_answers_with_the_entry_it_found(self, isolated, patched):
        (isolated / "a" / "app").mkdir(parents=True)
        (isolated / "b" / "app").mkdir(parents=True)
        svc = _registering_service(isolated, patched)
        await svc.register_workspace(str(isolated / "a" / "app"))
        second, _ = await svc.register_workspace(str(isolated / "b" / "app"))
        await svc.deregister_workspace("app")

        again, already_registered = await svc.register_workspace(str(isolated / "b" / "app"))

        assert (again, already_registered) == (second, True)
        assert [w.path for w in svc._daemon_config.workspaces] == [isolated / "b" / "app"]

    @pytest.mark.anyio
    async def test_a_marker_written_now_rebuilds_the_already_loaded_workspace(
        self,
        isolated,
        patched,
    ):
        project = isolated / "my-project"
        project.mkdir()
        svc = _registering_service(isolated, patched)
        await svc.register_workspace(str(project))
        stale = svc._workspaces["my-project"]
        (project / ".workspace").unlink()
        built = _suspending_services(patched)

        await svc.register_workspace(str(project))

        stale.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        assert svc._workspaces["my-project"] is built[0]

    @pytest.mark.anyio
    async def test_a_repeat_with_its_marker_in_place_keeps_the_loaded_workspace(
        self,
        isolated,
        patched,
    ):
        project = isolated / "my-project"
        project.mkdir()
        svc = _registering_service(isolated, patched)
        await svc.register_workspace(str(project))
        loaded = svc._workspaces["my-project"]

        await svc.register_workspace(str(project))

        loaded.stop.assert_not_awaited()  # ty: ignore[unresolved-attribute]
        assert svc._workspaces["my-project"] is loaded


class TestRegisterTheHomeDirectory:
    """A directory holding the home directory or Claudebox's own files registers only once marked."""

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("spelling", "resolved"),
        [
            ("<home>", "<home>"),
            ("<root>", "<root>"),
            ("<home>/.claudebox", "<home>/.claudebox"),
            ("<root>/home-link", "<home>"),
        ],
        ids=["home", "above-home", "own-folder", "link-to-home"],
    )
    async def test_an_unmarked_one_is_refused_and_left_unmarked(
        self,
        isolated,
        patched,
        spelling,
        resolved,
    ):
        home = isolated / "home"
        (home / ".claudebox").mkdir()
        (isolated / "home-link").symlink_to(home)
        svc = _registering_service(isolated, patched)

        with pytest.raises(ValidationError) as excinfo:
            await svc.register_workspace(_spelled(spelling, home=home, root=isolated))

        directory = Path(_spelled(resolved, home=home, root=isolated))
        assert excinfo.value.error_key == "workspace_path_needs_cli"
        assert f"claudebox workspaces register {directory}" in excinfo.value.context["message"]
        assert not (directory / ".workspace").exists()
        assert svc._daemon_config.workspaces == []

    @pytest.mark.anyio
    async def test_the_refusal_quotes_a_path_holding_a_space(self, tmp_path, patched, monkeypatch):
        home = tmp_path / "my home"
        home.mkdir()
        monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: home))
        monkeypatch.setattr("claudebox.paths.walk_up", bounded_walk_up(tmp_path))
        svc = _registering_service(tmp_path, patched)

        with pytest.raises(ValidationError) as excinfo:
            await svc.register_workspace(str(home))

        assert (
            f"claudebox workspaces register '{home}'` in a terminal"
            in excinfo.value.context["message"]
        )

    @pytest.mark.anyio
    async def test_a_marked_one_registers(self, isolated, patched):
        home = isolated / "home"
        (home / ".workspace").touch()
        svc = _registering_service(isolated, patched)

        workspace, already_registered = await svc.register_workspace(str(home))
        _, again = await svc.register_workspace(str(home))

        assert (workspace.path, already_registered, again) == (home, False, True)


def _spelled(template: str, *, home: Path, root: Path) -> str:
    return template.replace("<home>", str(home)).replace("<root>", str(root))


class TestMarkerRepair:
    """Loading a registration whose sessions resolve outside it gives it its own marker."""

    @pytest.mark.anyio
    @pytest.mark.parametrize("enclosing", [True, False], ids=["inside-a-workspace", "nowhere"])
    async def test_a_registration_resolving_elsewhere_gets_its_marker(
        self,
        isolated,
        patched,
        enclosing,
    ):
        project = isolated / "outer" / "project"
        project.mkdir(parents=True)

        if enclosing:
            (isolated / "outer" / ".workspace").touch()

        svc = _make_service(workspaces=[_make_workspace("project", project)], mocks=patched)

        await svc.list_workspaces(sync=True)

        assert (project / ".workspace").is_file()

    @pytest.mark.anyio
    async def test_the_home_directory_is_left_without_a_marker(self, isolated, patched):
        home = isolated / "home"
        svc = _make_service(workspaces=[_make_workspace("home", home)], mocks=patched)

        await svc.list_workspaces(sync=True)

        assert not (home / ".workspace").exists()

    @pytest.mark.anyio
    async def test_a_directory_above_home_is_loaded_without_a_marker(self, isolated, patched):
        svc = _make_service(workspaces=[_make_workspace("above", isolated)], mocks=patched)

        await svc.list_workspaces(sync=True)

        assert "above" in svc._workspaces
        assert not (isolated / ".workspace").exists()

    @pytest.mark.anyio
    async def test_a_missing_directory_still_loads(self, isolated, patched):
        gone = isolated / "gone"
        svc = _make_service(workspaces=[_make_workspace("gone", gone)], mocks=patched)

        await svc.list_workspaces(sync=True)

        assert "gone" in svc._workspaces
        assert not gone.exists()


# --- list_workspaces ---


class TestListWorkspaces:
    """Test workspace listing."""

    @pytest.mark.anyio
    async def test_returns_empty_list_when_no_workspaces(self, patched):
        svc = _make_service(mocks=patched)

        result = await svc.list_workspaces(sync=False)

        assert result == []

    @pytest.mark.anyio
    async def test_sync_loads_new_workspaces_from_config(self, tmp_path, patched):
        ws_path = tmp_path / "synced"
        ws_path.mkdir()
        ws = _make_workspace("synced", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)

        result = await svc.list_workspaces(sync=True)

        assert len(result) == 1

    @pytest.mark.anyio
    async def test_sync_rebuilds_a_workspace_whose_directory_has_returned(self, tmp_path, patched):
        ws_path = tmp_path / "returned"
        ws = _make_workspace("returned", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)

        MockWS = patched["WorkspaceService"]
        stale = AsyncMock()
        stale.workspace = ws
        stale.available = False
        fresh = AsyncMock()
        fresh.workspace = ws
        fresh.available = True
        MockWS.side_effect = [stale, fresh]

        await svc._sync_state()
        assert svc._workspaces["returned"] is stale

        ws_path.mkdir()

        await svc._sync_state()
        assert svc._workspaces["returned"] is fresh

    @pytest.mark.anyio
    async def test_sync_never_reloads_a_still_available_workspace(self, tmp_path, patched):
        ws_path = tmp_path / "fine"
        ws_path.mkdir()
        ws = _make_workspace("fine", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)
        MockWS = patched["WorkspaceService"]
        cached = AsyncMock()
        cached.workspace = ws
        cached.available = True
        MockWS.return_value = cached

        await svc._sync_state()
        await svc._sync_state()

        MockWS.assert_called_once()

    @pytest.mark.anyio
    async def test_sync_never_reloads_a_still_missing_workspace(self, tmp_path, patched):
        ws = _make_workspace("gone", tmp_path / "gone")

        svc = _make_service(workspaces=[ws], mocks=patched)
        MockWS = patched["WorkspaceService"]
        stale = AsyncMock()
        stale.workspace = ws
        stale.available = False
        MockWS.return_value = stale

        await svc._sync_state()
        await svc._sync_state()

        MockWS.assert_called_once()


class TestListWorkspacesWithCounts:
    """One unavailable workspace must not stop the others from listing."""

    @pytest.mark.anyio
    async def test_an_unavailable_workspace_reports_zero_counts_without_raising(
        self,
        tmp_path,
        patched,
    ):
        ws = _make_workspace("gone", tmp_path / "gone")

        svc = _make_service(workspaces=[ws], mocks=patched)
        MockWS = patched["WorkspaceService"]
        stale = AsyncMock()
        stale.workspace = ws
        stale.available = False
        stale._container_service = None
        MockWS.return_value = stale

        entries = await svc.list_workspaces_with_counts()

        assert entries == [
            {
                "id": "gone",
                "path": str(tmp_path / "gone"),
                "containers": {"running": 0, "stopped": 0},
            },
        ]

    @pytest.mark.anyio
    async def test_an_available_workspace_still_lists_beside_an_unavailable_one(
        self,
        tmp_path,
        patched,
    ):
        ok_path = tmp_path / "ok"
        ok_path.mkdir()
        ok_ws = _make_workspace("ok", ok_path)
        gone_ws = _make_workspace("gone", tmp_path / "gone")

        svc = _make_service(workspaces=[ok_ws, gone_ws], mocks=patched)

        MockWS = patched["WorkspaceService"]
        ok_svc = AsyncMock()
        ok_svc.workspace = ok_ws
        ok_svc.available = True
        ok_svc._container_service = MagicMock()
        ok_svc._container_service.list_all.return_value = []

        gone_svc = AsyncMock()
        gone_svc.workspace = gone_ws
        gone_svc.available = False
        gone_svc._container_service = None

        MockWS.side_effect = [ok_svc, gone_svc]

        entries = await svc.list_workspaces_with_counts()

        assert {e["id"] for e in entries} == {"ok", "gone"}


# --- frontend error reporting ---


class TestReportFrontendError:
    """Test DaemonService.report_frontend_error - logging only, no business logic."""

    def test_logs_every_field_at_warning_level(self, patched):
        svc = _make_service(mocks=patched)
        svc._logger = MagicMock()

        svc.report_frontend_error(
            kind="render-failure",
            message="boom",
            stack_trace="at Component",
            app_version="1.2.3",
            client_timestamp="2026-08-09T00:00:00Z",
        )

        svc._logger.warning.assert_called_once_with(
            "frontend_error",
            kind="render-failure",
            message="boom",
            stack_trace="at Component",
            app_version="1.2.3",
            client_timestamp="2026-08-09T00:00:00Z",
        )

    def test_optional_fields_log_as_none(self, patched):
        svc = _make_service(mocks=patched)
        svc._logger = MagicMock()

        svc.report_frontend_error(
            kind="persistence-failure",
            message="quota exceeded",
            stack_trace=None,
            app_version=None,
            client_timestamp="2026-08-09T00:00:00Z",
        )

        _, kwargs = svc._logger.warning.call_args
        assert kwargs["stack_trace"] is None
        assert kwargs["app_version"] is None


# --- health aggregation ---


class TestHealth:
    """Health must answer "can this daemon serve a request", not only "is the loop scheduling"."""

    def test_reports_ok_when_every_signal_is_healthy(self, patched):
        svc = _make_service(mocks=patched)
        svc.watchdog.healthy = True
        svc.serving.healthy = True

        report = svc.health()

        assert report["status"] == "ok"
        assert report["degraded"] == []
        assert report["signals"] == {"event_loop": "ok", "serving": "ok"}

    def test_a_lagging_loop_names_the_event_loop(self, patched):
        svc = _make_service(mocks=patched)
        svc.watchdog.healthy = False
        svc.serving.healthy = True

        report = svc.health()

        assert report["status"] == "degraded"
        assert report["degraded"] == ["event_loop"]

    def test_a_daemon_that_cannot_serve_names_the_serving_signal(self, patched):
        """A daemon that is alive and scheduling but unable to answer anything."""

        svc = _make_service(mocks=patched)
        svc.watchdog.healthy = True
        svc.serving.healthy = False
        svc.serving.failing = ["listing"]

        report = svc.health()

        assert report["status"] == "degraded"
        assert report["degraded"] == ["serving"]
        assert report["serving"]["unanswered_pools"] == ["listing"]

    def test_carries_pool_numbers_so_the_failure_explains_itself(self, patched):
        svc = _make_service(mocks=patched)

        report = svc.health()

        assert set(report["pools"]) == {"listing", "podman", "state"}
        assert "queued" in report["pools"]["listing"]

    def test_answers_without_dispatching_to_any_pool(self, patched):
        """A health check that queues behind the saturation it reports is useless."""

        import threading
        import time

        svc = _make_service(mocks=patched)
        release = threading.Event()

        try:
            for pool in (svc._executors.listing, svc._executors.podman, svc._executors.state):
                for _ in range(pool._max_workers + 2):
                    pool.submit(release.wait)

            started = time.monotonic()
            report = svc.health()
            elapsed = time.monotonic() - started

            assert elapsed < 0.5
            assert report["pools"]["listing"]["queued"] >= 1
        finally:
            release.set()


class TestHealthCommit:
    """Health carries the commit the daemon started from, read once - null when git cannot say."""

    def test_the_commit_read_at_start_is_reported_without_asking_again(self, patched):
        with patch(
            "claudebox_daemon.domain.service.library_commit",
            return_value="4a82dc0",
        ) as lookup:
            svc = _make_service(mocks=patched)

            reports = [svc.health(), svc.health()]

        assert [report["commit"] for report in reports] == ["4a82dc0", "4a82dc0"]
        lookup.assert_called_once()

    def test_an_unreadable_commit_is_null(self, patched):
        with patch("claudebox_daemon.domain.service.library_commit", return_value=None):
            svc = _make_service(mocks=patched)

        assert svc.health()["commit"] is None
