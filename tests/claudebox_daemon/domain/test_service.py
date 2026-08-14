"""Tests for claudebox_daemon.domain.service - daemon service orchestration."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox_daemon.domain.errors import WorkspaceNotRegistered
from claudebox_daemon.domain.service import DaemonService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


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
            config.get_workspace = MagicMock(side_effect=_config_get_workspace(config))  # ty: ignore[invalid-assignment]

            return config

        original_load.side_effect = reload_with_new_ws

        result = await svc.get_workspace("new-ws")

        MockWS = patched["WorkspaceService"]
        assert result is MockWS.return_value


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
        """The gap 75.87 left: alive, scheduling, and unable to answer anything."""

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
