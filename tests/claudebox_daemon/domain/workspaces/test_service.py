"""Tests for claudebox_daemon.domain.workspaces.service - workspace management."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.rate_limits import RateLimitStore
from claudebox_daemon.domain.executors import DaemonExecutors
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.domain.workspaces.service import WorkspaceService


# --- Helpers ---


def _make_service(
    tmp_path: Path,
    *,
    available: bool = True,
) -> tuple[WorkspaceService, AsyncMock]:
    """Create a WorkspaceService with mocked sub-services; available=False leaves them None."""

    if available:
        ws_path = tmp_path
        (ws_path / ".workspace").touch()
    else:
        ws_path = tmp_path / "nonexistent"

    ws = RegisteredWorkspace(id="test-ws", path=ws_path)
    events = AsyncMock()
    executors = DaemonExecutors.create()

    with patch("claudebox_daemon.domain.workspaces.service.Config") as mock_config_cls:
        mock_config_cls.load.return_value = MagicMock()
        proxy = MagicMock()
        svc = WorkspaceService(ws, events, proxy, executors)

    # Mock sub-services via private fields (public properties raise for unavailable workspaces).
    if svc._container_service is not None:
        svc._container_service = AsyncMock()

    if svc._session_service is not None:
        svc._session_service = AsyncMock()

    if svc._board_service is not None:
        svc._board_service = AsyncMock()

    if svc._spawn_listener is not None:
        svc._spawn_listener = AsyncMock()

    return svc, events


# --- __init__ ---


class TestInit:
    """Test WorkspaceService initialization."""

    def test_available_workspace_initializes_sub_services(self, tmp_path):
        """All sub-services are set when workspace directory exists."""

        svc, _ = _make_service(tmp_path, available=True)

        assert svc.workspace.id == "test-ws"
        assert svc._ui_state is not None
        assert svc._container_service is not None
        assert svc._session_service is not None
        assert svc._board_service is not None
        assert svc._spawn_listener is not None

    def test_unavailable_workspace_leaves_sub_services_none(self, tmp_path):
        """Sub-services remain None when workspace directory is missing."""

        svc, _ = _make_service(tmp_path, available=False)

        assert svc.workspace.id == "test-ws"
        assert svc._ui_state is None
        assert svc._container_service is None
        assert svc._session_service is None
        assert svc._board_service is None
        assert svc._spawn_listener is None

    def test_property_access_on_unavailable_workspace_raises(self, tmp_path):
        """Accessing a sub-service property on an unavailable workspace raises."""

        svc, _ = _make_service(tmp_path, available=False)

        with pytest.raises(RuntimeError, match="unavailable"):
            _ = svc.container_service


# --- rate_limits ---


class TestRateLimits:
    """rate_limits is a plain value accessor, like config - never gated on availability."""

    def test_rooted_at_the_workspace_path(self, tmp_path):
        svc, _ = _make_service(tmp_path, available=True)

        assert isinstance(svc.rate_limits, RateLimitStore)
        assert svc.rate_limits._path == tmp_path / ".claudebox" / "rate-limits.json"

    def test_accessible_on_an_unavailable_workspace(self, tmp_path):
        svc, _ = _make_service(tmp_path, available=False)

        assert isinstance(svc.rate_limits, RateLimitStore)  # must not raise


# --- start ---


class TestStart:
    """Test workspace service startup."""

    @pytest.mark.anyio
    async def test_start_calls_sub_services_in_order(self, tmp_path):
        """Start delegates to container and session services."""

        svc, _ = _make_service(tmp_path, available=True)

        await svc.start()

        svc.container_service.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        svc.session_service.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_start_binds_the_spawn_listener(self, tmp_path):
        svc, _ = _make_service(tmp_path, available=True)

        await svc.start()

        svc._spawn_listener.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_start_survives_a_spawn_listener_bind_failure(self, tmp_path):
        """A spawn socket that fails to bind (e.g. AF_UNIX path too long) must not drop the
        rest of the workspace - sessions/ui-state/resume/board still start."""

        svc, _ = _make_service(tmp_path, available=True)
        svc._spawn_listener.start.side_effect = OSError("AF_UNIX path too long")  # ty: ignore[unresolved-attribute]

        await svc.start()  # must not raise

        svc.container_service.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        svc.session_service.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        svc.board_service.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]


# --- stop ---


class TestStop:
    """Test workspace service shutdown."""

    @pytest.mark.anyio
    async def test_stop_calls_sub_services_in_reverse_order(self, tmp_path):
        """Stop delegates to session and container services (reverse of start)."""

        svc, _ = _make_service(tmp_path, available=True)
        call_order = []
        svc.session_service.stop.side_effect = lambda: call_order.append("session")  # ty: ignore[unresolved-attribute]
        svc.container_service.stop.side_effect = lambda: call_order.append("container")  # ty: ignore[unresolved-attribute]

        await svc.stop()

        svc.session_service.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        svc.container_service.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        assert call_order == ["session", "container"]

    @pytest.mark.anyio
    async def test_stop_unbinds_the_spawn_listener_before_the_rest(self, tmp_path):
        """Stopped first: nothing should still be able to ask for a sibling session while the
        rest of the workspace is mid-teardown."""

        svc, _ = _make_service(tmp_path, available=True)
        call_order = []
        svc._spawn_listener.stop.side_effect = lambda: call_order.append("spawn_listener")  # ty: ignore[unresolved-attribute]
        svc.session_service.stop.side_effect = lambda: call_order.append("session")  # ty: ignore[unresolved-attribute]

        await svc.stop()

        svc._spawn_listener.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        assert call_order[0] == "spawn_listener"


# --- _log_context ---


class TestLogContext:
    """Test structured log context property."""

    def test_log_context_contains_workspace_id_and_path(self, tmp_path):
        """Log context dict includes workspace id and path."""

        svc, _ = _make_service(tmp_path, available=True)

        tag = svc._log_context

        assert tag["workspace"]["id"] == "test-ws"
        assert tag["workspace"]["path"] == tmp_path
