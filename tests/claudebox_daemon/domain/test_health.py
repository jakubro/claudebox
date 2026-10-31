"""Tests for claudebox_daemon.domain.health - container health monitoring."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from claudebox.config import Config
from claudebox_daemon.constants import CONTAINER_HEALTH_MAX_FAILURES
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.containers.service import ContainerService
from claudebox_daemon.domain.health import HealthMonitor
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


def _make_container(
    status: ContainerStatus = ContainerStatus.RUNNING,
    port=8080,
    failure_count=0,
    booting=False,
    session_id="owner-1",
) -> Container:
    """Create a test container; `booting` places it inside its startup budget, not past it."""

    age = timedelta() if booting else timedelta(hours=1)

    return Container(
        id="c1",
        backend_id="backend-1",
        port=port,
        status=status,
        failure_count=failure_count,
        created_at=datetime.now(UTC) - age,
        session_id=session_id,
    )


def _make_workspace_service(containers=None, path=None):
    """Create a mock WorkspaceService with containers."""

    svc = MagicMock()
    svc.workspace = RegisteredWorkspace(id="ws1", path=path or Path("/nonexistent"))
    svc.available = True
    svc.container_service = MagicMock()
    svc.container_service.list_all.return_value = containers or []
    svc.container_service.update = AsyncMock()
    svc.container_service.sync_state = AsyncMock()
    svc.container_service.consume_fresh_adoption.return_value = False
    svc.container_service.reap_orphan = AsyncMock(return_value=False)

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

        monitor._service.proxy.send = AsyncMock(return_value=_ok({"status": "ok"}))

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 0
        ws_svc.container_service.update.assert_awaited_once_with(
            container,
            status=ContainerStatus.RUNNING,
            live_session_ids=[],
        )

    @pytest.mark.anyio
    async def test_success_threads_live_session_ids_through(self, tmp_path):
        container = _make_container()
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {
            "status": "ok",
            "session_id": "primary-1",
            "live_session_ids": ["primary-1", "side-1"],
        }
        monitor._service.proxy.send = AsyncMock(return_value=mock_response)

        await monitor._probe_container(ws_svc, container)

        ws_svc.container_service.update.assert_awaited_once_with(
            container,
            status=ContainerStatus.RUNNING,
            session_id="primary-1",
            live_session_ids=["primary-1", "side-1"],
        )

    @pytest.mark.anyio
    async def test_a_side_thread_no_longer_live_stays_a_member(self, tmp_path):
        container = _make_container()
        container.members = ["side-1"]
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        monitor._service.proxy.send = AsyncMock(
            return_value=_ok({"status": "ok", "live_session_ids": ["owner-1"]}),
        )

        await monitor._probe_container(ws_svc, container)

        assert "members" not in ws_svc.container_service.update.await_args.kwargs
        assert container.members == ["side-1"]

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
        container = _make_container(failure_count=2)  # One more -> 3 = MAX_FAILURES
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        monitor._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 3
        ws_svc.container_service.update.assert_awaited_once_with(
            container,
            status=ContainerStatus.CRASHED,
            live_session_ids=[],
        )

    @pytest.mark.anyio
    async def test_crash_clears_a_stale_live_set(self, tmp_path):
        """A dead member shown as live is the failure that matters - clear it on crash."""

        container = _make_container(failure_count=2)
        container.live_session_ids = ["primary-1", "side-1"]
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        monitor._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await monitor._probe_container(ws_svc, container)

        ws_svc.container_service.update.assert_awaited_once_with(
            container,
            status=ContainerStatus.CRASHED,
            live_session_ids=[],
        )

    @pytest.mark.anyio
    async def test_skips_stopped_container(self, tmp_path):
        container = _make_container(status=ContainerStatus.STOPPED)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        await monitor._probe_container(ws_svc, container)

        monitor._service.proxy.send.assert_not_awaited()

    @pytest.mark.anyio
    async def test_keeps_probing_a_crashed_container(self, tmp_path):
        """Crashed would be absorbing otherwise - nothing else ever asks the container again."""

        container = _make_container(status=ContainerStatus.CRASHED)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await monitor._probe_container(ws_svc, container)

        monitor._service.proxy.send.assert_awaited_once()

    @pytest.mark.anyio
    async def test_a_crashed_container_that_answers_returns_to_running(self, tmp_path):
        container = _make_container(status=ContainerStatus.CRASHED, failure_count=7)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        monitor._service.proxy.send = AsyncMock(return_value=_ok({"status": "ok"}))

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 0
        ws_svc.container_service.update.assert_awaited_once_with(
            container,
            status=ContainerStatus.RUNNING,
            live_session_ids=[],
        )

    @pytest.mark.anyio
    async def test_a_booting_container_is_not_crashed(self, tmp_path):
        """Never answered is a different state from stopped answering; the startup wait owns it."""

        container = _make_container(status=ContainerStatus.STARTING, failure_count=2, booting=True)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 3
        ws_svc.container_service.update.assert_not_awaited()

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

        monitor._service.proxy.send = AsyncMock(return_value=_ok({"status": "ok"}))

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 0
        ws_svc.container_service.update.assert_awaited_once_with(
            container,
            status=ContainerStatus.RUNNING,
            live_session_ids=[],
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
            "500",
            request=MagicMock(),
            response=mock_response,
        )
        monitor._service.proxy.send = AsyncMock(return_value=mock_response)

        await monitor._probe_container(ws_svc, container)

        assert container.failure_count == 1


class TestPoll:
    """_poll iterates every workspace; one raising must not stop it reaching the rest."""

    @pytest.mark.anyio
    async def test_skips_an_unavailable_workspace(self, tmp_path):
        ws_svc = _make_workspace_service(path=tmp_path)
        ws_svc.available = False
        monitor = _make_monitor([ws_svc])

        await monitor._poll()

        ws_svc.container_service.sync_state.assert_not_called()

    @pytest.mark.anyio
    async def test_one_workspaces_failure_does_not_stop_the_others_from_being_probed(
        self,
        tmp_path,
    ):
        failing = _make_workspace_service(path=tmp_path)
        failing.container_service.sync_state = AsyncMock(side_effect=RuntimeError("boom"))

        container = _make_container()
        healthy = _make_workspace_service([container], path=tmp_path)

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"status": "ok"}

        monitor = _make_monitor([failing, healthy])
        monitor._service.proxy.send = AsyncMock(return_value=mock_response)

        await monitor._poll()  # must not raise

        healthy.container_service.update.assert_awaited_once()


class TestProbeOnce:
    """The startup pass reconciles owners with what containers report, within one interval."""

    @pytest.mark.anyio
    async def test_a_recorded_owner_the_container_contradicts_is_replaced(self, tmp_path):
        container = _make_container()
        container.session_id = "fork-1"
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        monitor._service.proxy.send = AsyncMock(
            return_value=_ok({"session_id": "src-1", "live_session_ids": ["src-1"]}),
        )

        await monitor.probe_once()

        ws_svc.container_service.update.assert_awaited_once_with(
            container,
            status=ContainerStatus.RUNNING,
            session_id="src-1",
            live_session_ids=["src-1"],
        )

    @pytest.mark.anyio
    async def test_a_probe_that_never_returns_does_not_hold_the_start(self, tmp_path):
        ws_svc = _make_workspace_service([_make_container()], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        async def _hang(**_):
            await asyncio.Event().wait()

        monitor._service.proxy.send = _hang

        with patch(
            "claudebox_daemon.domain.health.CONTAINER_HEALTH_MONITOR_INTERVAL",
            timedelta(milliseconds=50),
        ):
            await asyncio.wait_for(monitor.probe_once(), 1)

        ws_svc.container_service.update.assert_not_called()


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


# --- stale verdicts and fresh adoption ---


def _ok(report: dict) -> MagicMock:
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = report

    return response


class TestProbeVerdictFreshness:
    """A verdict computed before a stop landed describes a container that is gone."""

    @pytest.mark.anyio
    @pytest.mark.parametrize("answers", [True, False])
    async def test_a_stop_during_the_probe_discards_its_verdict(self, tmp_path, answers):
        container = _make_container(failure_count=CONTAINER_HEALTH_MAX_FAILURES - 1)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        async def probe(**_kwargs):
            container.status = ContainerStatus.STOPPED

            if answers:
                return _ok({"status": "ok"})

            raise httpx.ConnectError("refused")

        monitor._service.proxy.send = AsyncMock(side_effect=probe)

        await monitor._probe_container(ws_svc, container)

        assert container.status == ContainerStatus.STOPPED
        ws_svc.container_service.update.assert_not_awaited()


class TestFreshAdoptionMembers:
    """A container adopted with no registry entry takes its side threads from its first report."""

    @staticmethod
    def _service(tmp_path):
        ws = RegisteredWorkspace(id="ws1", path=tmp_path)
        config_dir = tmp_path / ".claudebox"
        config_dir.mkdir(parents=True, exist_ok=True)
        config = Config(work_dir=tmp_path, config_dir=config_dir, backend="podman")
        executor = ThreadPoolExecutor(max_workers=2)
        service = ContainerService(ws, AsyncMock(), config, MagicMock(), executor, executor)
        service._runtime._backend = MagicMock()
        service._runtime._backend.list_containers.return_value = [
            {
                "Id": "b1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "ws1"},
            },
        ]
        service._runtime._backend.get_host_port.return_value = 8080

        return service

    @pytest.mark.anyio
    async def test_members_are_rebuilt_from_the_first_report(self, tmp_path):
        service = self._service(tmp_path)
        await service.sync_state()
        ws_svc = _make_workspace_service(path=tmp_path)
        ws_svc.container_service = service
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(
            return_value=_ok({"session_id": "owner", "live_session_ids": ["owner", "side-1"]}),
        )

        await monitor._probe_container(ws_svc, service.get("c1"))

        container = service.get("c1")
        assert container.session_id == "owner"
        assert container.members == ["side-1"]
        assert (await service.find_by_session("side-1")).id == "c1"

    @pytest.mark.anyio
    async def test_a_known_container_keeps_its_members(self, tmp_path):
        service = self._service(tmp_path)
        service._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
            session_id="owner",
            members=["side-1"],
        )
        await service.sync_state()
        ws_svc = _make_workspace_service(path=tmp_path)
        ws_svc.container_service = service
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(
            return_value=_ok(
                {"session_id": "owner", "live_session_ids": ["owner", "side-1", "side-2"]},
            ),
        )

        await monitor._probe_container(ws_svc, service.get("c1"))

        assert service.get("c1").members == ["side-1"]


class TestOrphanReapOffer:
    """The probe offers the reap only on evidence no session will ever come: its own fresh answer."""

    @pytest.mark.anyio
    async def test_an_answer_naming_nothing_offers_the_reap(self, tmp_path):
        container = _make_container(session_id=None)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(return_value=_ok({"status": "ok"}))

        await monitor._probe_container(ws_svc, container)

        ws_svc.container_service.reap_orphan.assert_awaited_once_with("c1")

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "report",
        [{"session_id": "late-owner"}, {"live_session_ids": ["side-1"]}],
        ids=["primary", "live"],
    )
    async def test_an_answer_naming_a_session_never_offers_it(self, tmp_path, report):
        container = _make_container(session_id=None)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(return_value=_ok(report))

        await monitor._probe_container(ws_svc, container)

        ws_svc.container_service.reap_orphan.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_failing_probe_never_offers_it(self, tmp_path):
        container = _make_container(session_id=None, failure_count=CONTAINER_HEALTH_MAX_FAILURES)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await monitor._probe_container(ws_svc, container)

        ws_svc.container_service.reap_orphan.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_stopped_container_is_offered_it_without_a_request(self, tmp_path):
        container = _make_container(status=ContainerStatus.STOPPED, session_id=None)
        ws_svc = _make_workspace_service([container], path=tmp_path)
        monitor = _make_monitor([ws_svc])

        await monitor._probe_container(ws_svc, container)

        ws_svc.container_service.reap_orphan.assert_awaited_once_with("c1")
        monitor._service.proxy.send.assert_not_awaited()


class TestOrphanReapIntegration:
    """A restart's leftover: a persisted ownerless entry whose container answers with no session."""

    @pytest.mark.anyio
    async def test_one_poll_removes_it(self, tmp_path):
        service = TestFreshAdoptionMembers._service(tmp_path)
        service._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.STARTING,
            created_at=datetime.now(UTC) - timedelta(hours=1),
        )
        ws_svc = _make_workspace_service(path=tmp_path)
        ws_svc.container_service = service
        monitor = _make_monitor([ws_svc])
        monitor._service.proxy.send = AsyncMock(return_value=_ok({"status": "ok"}))

        await monitor._poll()

        assert service.list_all() == []
        service._runtime._backend.remove_container.assert_called_once_with("b1")
