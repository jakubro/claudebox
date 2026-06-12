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
    "claudebox_daemon.domain.service.Broadcaster",
    "claudebox_daemon.domain.service.HealthMonitor",
    "claudebox_daemon.domain.service.SessionMutationObserver",
    "claudebox_daemon.domain.service.WorkspaceService",
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
    """Create a DaemonService with mocked dependencies to avoid real I/O.

    Accepts the dict of active patches from the test so mocks remain
    active for the full test lifetime.
    """

    MockConfig = mocks["DaemonConfig"]
    MockHealth = mocks["HealthMonitor"]
    MockMutation = mocks["SessionMutationObserver"]
    MockProxy = mocks["ContainerProxyClient"]

    # HealthMonitor async methods
    health_instance = MockHealth.return_value
    health_instance.start = AsyncMock()
    health_instance.stop = AsyncMock()

    # SessionMutationObserver async methods
    mutation_instance = MockMutation.return_value
    mutation_instance.start = AsyncMock()
    mutation_instance.stop = AsyncMock()

    # ContainerProxyClient async methods
    proxy_instance = MockProxy.return_value
    proxy_instance.close = AsyncMock()

    # DaemonConfig
    config_instance = MockConfig.load.return_value
    config_instance.workspaces = workspaces or []
    config_instance.get_workspace = MagicMock(side_effect=_config_get_workspace(config_instance))

    # WorkspaceService async methods
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
        patch(_PATCHES[5]) as m_ws,
    ):
        yield {
            "DaemonConfig": m_config,
            "ContainerProxyClient": m_proxy,
            "Broadcaster": m_broadcaster,
            "HealthMonitor": m_health,
            "SessionMutationObserver": m_mutation,
            "WorkspaceService": m_ws,
        }


# --- start / stop lifecycle ---


class TestStart:
    """Test daemon service startup."""

    @pytest.mark.anyio
    async def test_start_syncs_state_and_starts_health_monitor(self, patched):
        svc = _make_service(mocks=patched)

        await svc.start()

        svc._health_monitor.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        # Verify the health monitor instance is set on the service
        assert svc._health_monitor is not None

    @pytest.mark.anyio
    async def test_start_loads_registered_workspaces(self, tmp_path, patched):
        ws_path = tmp_path / "my-project"
        ws_path.mkdir()
        ws = _make_workspace("my-project", ws_path)

        svc = _make_service(workspaces=[ws], mocks=patched)

        await svc.start()

        MockWS = patched["WorkspaceService"]
        MockWS.assert_called_once_with(ws, svc.events, svc.proxy)
        MockWS.return_value.start.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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

        svc._health_monitor.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        svc.proxy.close.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        # Verify workspaces dict is empty after stop
        assert len(svc._workspaces) == 0

    @pytest.mark.anyio
    async def test_stop_stops_all_workspace_services(self, patched):
        svc = _make_service(mocks=patched)

        ws1 = AsyncMock()
        ws2 = AsyncMock()
        svc._workspaces = {"ws1": ws1, "ws2": ws2}

        await svc.stop()

        ws1.stop.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        ws2.stop.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    @pytest.mark.anyio
    async def test_stop_with_no_workspaces(self, patched):
        svc = _make_service(mocks=patched)

        # Should not raise
        await svc.stop()

        svc._health_monitor.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        # Verify service has no workspaces after stop
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
        MockWS.return_value.start.assert_awaited()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
            config.get_workspace = MagicMock(side_effect=_config_get_workspace(config))  # ty: ignore[invalid-assignment]  # MagicMock structurally replaces real method for the test.

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
