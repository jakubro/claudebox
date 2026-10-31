"""Tests for claudebox_daemon.domain.mutation_observer - session mutation detection."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.mutation_observer import SessionMutationObserver
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


def _make_container(
    status: ContainerStatus = ContainerStatus.RUNNING,
    port=8080,
    session_id: str | None = None,
    members: list[str] | None = None,
    live_session_ids: list[str] | None = None,
) -> Container:
    """Create a test container."""

    return Container(
        id="c1",
        backend_id="backend-1",
        port=port,
        status=status,
        session_id=session_id,
        members=members or [],
        live_session_ids=live_session_ids or [],
    )


def _make_workspace_service(containers=None, path=None):
    """Create a mock WorkspaceService with containers."""

    svc = MagicMock()
    svc.workspace = RegisteredWorkspace(id="ws1", path=path or Path("/nonexistent"))
    svc.available = True
    svc.container_service = MagicMock()
    svc.container_service.list_all.return_value = containers or []
    svc.session_service = MagicMock()
    svc.session_service._broadcast_sessions_changed = AsyncMock()

    return svc


def _make_observer(workspace_services=None):
    """Create a SessionMutationObserver with mocked DaemonService and proxy client."""

    daemon = MagicMock()
    daemon.list_workspaces = AsyncMock(return_value=workspace_services or [])
    daemon.proxy = MagicMock()
    daemon.proxy.send = AsyncMock()

    return SessionMutationObserver(daemon)


# --- _check_container ---


class TestCheckContainer:
    """Test session metadata change detection."""

    @pytest.mark.anyio
    async def test_detects_change_after_baseline(self):
        """Returns True when updated_at changes after initial observation."""

        container = _make_container()
        observer = _make_observer()

        # First call: baseline
        mock_response_1 = MagicMock()
        mock_response_1.raise_for_status = MagicMock()
        mock_response_1.json.return_value = {"updated_at": "2026-01-01T00:00:00Z"}

        # Second call: changed
        mock_response_2 = MagicMock()
        mock_response_2.raise_for_status = MagicMock()
        mock_response_2.json.return_value = {"updated_at": "2026-01-01T00:01:00Z"}

        observer._service.proxy.send = AsyncMock(side_effect=[mock_response_1, mock_response_2])

        result1 = await observer._check_container(container)
        assert result1 is False  # First observation is baseline

        result2 = await observer._check_container(container)
        assert result2 is True

    @pytest.mark.anyio
    async def test_no_change_returns_false(self):
        """Returns False when updated_at is unchanged."""

        container = _make_container()
        observer = _make_observer()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"updated_at": "2026-01-01T00:00:00Z"}
        observer._service.proxy.send = AsyncMock(return_value=mock_response)

        await observer._check_container(container)  # baseline
        result = await observer._check_container(container)  # same
        assert result is False

    @pytest.mark.anyio
    async def test_skips_non_running_container(self):
        """Returns False for stopped containers without making HTTP call."""

        container = _make_container(status=ContainerStatus.STOPPED)
        observer = _make_observer()

        result = await observer._check_container(container)

        assert result is False
        observer._service.proxy.send.assert_not_awaited()

    @pytest.mark.anyio
    async def test_skips_zero_port(self):
        """Returns False for containers with no port."""

        container = _make_container(port=0)
        observer = _make_observer()

        result = await observer._check_container(container)

        assert result is False
        observer._service.proxy.send.assert_not_awaited()

    @pytest.mark.anyio
    async def test_handles_http_error_gracefully(self):
        """Returns False on HTTP error without raising."""

        container = _make_container()
        observer = _make_observer()

        observer._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        result = await observer._check_container(container)

        assert result is False

    @pytest.mark.anyio
    async def test_handles_missing_updated_at(self):
        """Returns False when response has no updated_at field."""

        container = _make_container()
        observer = _make_observer()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {}
        observer._service.proxy.send = AsyncMock(return_value=mock_response)

        result = await observer._check_container(container)

        assert result is False


class TestCheckMembers:
    """A live side thread's own changes raise the signal, as its container's primary's do."""

    @staticmethod
    def _answers(stamps: dict) -> AsyncMock:
        def _send(*, endpoint, **_kwargs):
            response = MagicMock()
            response.raise_for_status = MagicMock()
            response.json.return_value = {"updated_at": stamps[endpoint].pop(0)}

            return response

        return AsyncMock(side_effect=_send)

    @pytest.mark.anyio
    async def test_a_live_members_change_is_a_change(self):
        container = _make_container(
            session_id="primary",
            members=["thread"],
            live_session_ids=["primary", "thread"],
        )
        observer = _make_observer()
        observer._service.proxy.send = self._answers(
            {
                "api/sessions/current": ["p1", "p1"],
                "api/sessions/current?session_id=thread": ["m1", "m2"],
            },
        )

        assert await observer._check_container(container) is False
        assert await observer._check_container(container) is True

    @pytest.mark.anyio
    async def test_a_member_no_longer_live_is_not_polled(self):
        container = _make_container(
            session_id="primary",
            members=["gone"],
            live_session_ids=["primary"],
        )
        observer = _make_observer()
        observer._service.proxy.send = self._answers({"api/sessions/current": ["p1"]})

        await observer._check_container(container)

        endpoints = [
            call.kwargs["endpoint"] for call in observer._service.proxy.send.await_args_list
        ]
        assert endpoints == ["api/sessions/current"]


class TestPoll:
    """_poll iterates every workspace; one raising must not stop it reaching the rest."""

    @pytest.mark.anyio
    async def test_skips_an_unavailable_workspace(self, tmp_path):
        ws_svc = _make_workspace_service(path=tmp_path)
        ws_svc.available = False
        observer = _make_observer([ws_svc])

        await observer._poll()

        ws_svc.container_service.list_all.assert_not_called()

    @pytest.mark.anyio
    async def test_one_workspaces_failure_does_not_stop_the_others_from_being_checked(
        self,
        tmp_path,
    ):
        failing = _make_workspace_service(path=tmp_path)
        failing.container_service.list_all.side_effect = RuntimeError("boom")

        container = _make_container()
        healthy = _make_workspace_service([container], path=tmp_path)

        observer = _make_observer([failing, healthy])
        observer._service.proxy.send = AsyncMock(side_effect=httpx.ConnectError("refused"))

        await observer._poll()  # must not raise

        healthy.container_service.list_all.assert_called_once()


# --- start / stop lifecycle ---


class TestSessionMutationObserverLifecycle:
    """Test observer start/stop."""

    @pytest.mark.anyio
    async def test_start_creates_task(self):
        observer = _make_observer()

        await observer.start()

        assert observer._task is not None

        # Clean up the real task to prevent "task was destroyed" warning
        observer._task.cancel()

        try:
            await observer._task
        except asyncio.CancelledError:
            pass

    @pytest.mark.anyio
    async def test_stop_cancels_task(self):
        observer = _make_observer()

        # Create a real cancellable task
        async def forever():
            await asyncio.sleep(999)

        observer._task = asyncio.create_task(forever())

        await observer.stop()

        assert observer._task is None
