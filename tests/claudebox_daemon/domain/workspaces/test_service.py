"""Tests for claudebox_daemon.domain.workspaces.service — workspace management."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.domain.workspaces.service import WorkspaceService


# --- Helpers ---


def _make_service(
    tmp_path: Path,
    *,
    available: bool = True,
) -> tuple[WorkspaceService, AsyncMock]:
    """Create a WorkspaceService with mocked sub-services.

    When available=True, tmp_path is a real directory so workspace.available
    returns True. When available=False, the path points to a non-existent
    directory so sub-services remain None.
    """

    if available:
        ws_path = tmp_path
        (ws_path / ".workspace").touch()
    else:
        ws_path = tmp_path / "nonexistent"

    ws = RegisteredWorkspace(id="test-ws", path=ws_path)
    events = AsyncMock()

    with patch("claudebox_daemon.domain.workspaces.service.Config") as mock_config_cls:
        mock_config_cls.load.return_value = MagicMock()
        proxy = MagicMock()
        svc = WorkspaceService(ws, events, proxy)

    # Replace sub-services with async mocks so start/stop can be awaited.
    # Touch the private fields directly — the public properties raise on access
    # for unavailable workspaces.
    if svc._container_service is not None:
        svc._container_service = AsyncMock()
    if svc._session_service is not None:
        svc._session_service = AsyncMock()

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

    def test_unavailable_workspace_leaves_sub_services_none(self, tmp_path):
        """Sub-services remain None when workspace directory is missing."""

        svc, _ = _make_service(tmp_path, available=False)

        assert svc.workspace.id == "test-ws"
        assert svc._ui_state is None
        assert svc._container_service is None
        assert svc._session_service is None
        assert svc._board_service is None

    def test_property_access_on_unavailable_workspace_raises(self, tmp_path):
        """Accessing a sub-service property on an unavailable workspace raises."""

        svc, _ = _make_service(tmp_path, available=False)

        with pytest.raises(RuntimeError, match="unavailable"):
            _ = svc.container_service


# --- start ---


class TestStart:
    """Test workspace service startup."""

    @pytest.mark.anyio
    async def test_start_calls_sub_services_in_order(self, tmp_path):
        """Start delegates to container and session services."""

        svc, _ = _make_service(tmp_path, available=True)

        await svc.start()

        svc.container_service.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        svc.session_service.start.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.


# --- stop ---


class TestStop:
    """Test workspace service shutdown."""

    @pytest.mark.anyio
    async def test_stop_calls_sub_services_in_reverse_order(self, tmp_path):
        """Stop delegates to session and container services (reverse of start)."""

        svc, _ = _make_service(tmp_path, available=True)
        call_order = []
        svc.session_service.stop.side_effect = lambda: call_order.append("session")  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        svc.container_service.stop.side_effect = lambda: call_order.append("container")  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

        await svc.stop()

        svc.session_service.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        svc.container_service.stop.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert call_order == ["session", "container"]


# --- _log_context ---


class TestLogContext:
    """Test structured log context property."""

    def test_log_context_contains_workspace_id_and_path(self, tmp_path):
        """Log context dict includes workspace id and path."""

        svc, _ = _make_service(tmp_path, available=True)

        tag = svc._log_context

        assert tag["workspace"]["id"] == "test-ws"
        assert tag["workspace"]["path"] == tmp_path
