"""Tests for claudebox_daemon.domain.health — container health monitoring."""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.health import HealthMonitor
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


def _make_container(
    status: ContainerStatus = ContainerStatus.RUNNING,
    port=8080,
    failure_count=0,
) -> Container:
    """Create a test container."""

    return Container(
        id="c1",
        backend_id="backend-1",
        port=port,
        status=status,
        failure_count=failure_count,
    )


def _make_workspace_service(containers=None, path=None):
    """Create a mock WorkspaceService with containers."""

    svc = MagicMock()
    svc.workspace = RegisteredWorkspace(id="ws1", path=path or Path("/nonexistent"))
    svc.container_service = MagicMock()
    svc.container_service.list_all.return_value = containers or []
    svc.container_service.update = AsyncMock()
    return svc


def _make_monitor(workspace_services=None):
    """Create a HealthMonitor with mocked DaemonService and proxy client."""

    daemon = MagicMock()
    daemon.list_workspaces = AsyncMock(return_value=workspace_services or [])
    daemon.proxy = MagicMock()
    daemon.proxy.send = AsyncMock()
    return HealthMonitor(daemon)


# --- _probe_container ---


class TestProbeContainer:
    """Test individual container health probing."""

    @pytest.mark.anyio
    async def test_success_resets_failure_count(self, tmp_path):
        container = _make_container(failure_count=2)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"status": "ok"}
        monitor._service.proxy.send = AsyncMock(return_value=mock_response)

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 0
        ws_svc.container_service.update.assert_awaited_once_with(
            container, status=ContainerStatus.RUNNING
        )

    @pytest.mark.anyio
    async def test_failure_increments_count(self, tmp_path):
        container = _make_container(failure_count=0)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        monitor._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 1
        ws_svc.container_service.update.assert_not_awaited()

    @pytest.mark.anyio
    async def test_max_failures_triggers_crashed(self, tmp_path):
        container = _make_container(failure_count=2)  # One more → 3 = MAX_FAILURES
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        monitor._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 3
        ws_svc.container_service.update.assert_awaited_once_with(
            container, status=ContainerStatus.CRASHED
        )

    @pytest.mark.anyio
    async def test_skips_stopped_container(self, tmp_path):
        container = _make_container(status=ContainerStatus.STOPPED)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        await monitor._probe_container(ws_svc, container)

        monitor._service.proxy.send.assert_not_awaited()

    @pytest.mark.anyio
    async def test_skips_crashed_container(self, tmp_path):
        container = _make_container(status=ContainerStatus.CRASHED)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        await monitor._probe_container(ws_svc, container)

        monitor._service.proxy.send.assert_not_awaited()

    @pytest.mark.anyio
    async def test_skips_zero_port(self, tmp_path):
        container = _make_container(port=0)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        await monitor._probe_container(ws_svc, container)

        monitor._service.proxy.send.assert_not_awaited()

    @pytest.mark.anyio
    async def test_probes_starting_container(self, tmp_path):
        container = _make_container(status=ContainerStatus.STARTING)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"status": "ok"}
        monitor._service.proxy.send = AsyncMock(return_value=mock_response)

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 0
        ws_svc.container_service.update.assert_awaited_once_with(
            container, status=ContainerStatus.RUNNING
        )

    @pytest.mark.anyio
    async def test_http_error_counts_as_failure(self, tmp_path):
        container = _make_container()
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500", request=MagicMock(), response=mock_response
        )
        monitor._service.proxy.send = AsyncMock(return_value=mock_response)

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 1


# --- start / stop lifecycle ---


class TestHealthMonitorLifecycle:
    """Test monitor start/stop."""

    @pytest.mark.anyio
    async def test_start_creates_task(self):
        monitor = _make_monitor()

        await monitor.start()

        assert monitor._task is not None

        # Clean up the real task to prevent "task was destroyed" warning
        monitor._task.cancel()
        try:
            await monitor._task
        except asyncio.CancelledError:
            pass

    @pytest.mark.anyio
    async def test_stop_cancels_task(self):
        monitor = _make_monitor()

        # Create a real cancellable task
        async def forever():
            await asyncio.sleep(999)

        monitor._task = asyncio.create_task(forever())

        await monitor.stop()

        assert monitor._task is None
