"""Tests for container lifecycle — service stop/kill/remove + DELETE composite + POST routes."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.config import Config
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.containers.errors import ContainerNotFound
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.containers.service import ContainerService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.containers import workspace_router as router


# Helpers
# ----------------------------------------------------------------------------------------------


def _make_service(tmp_path: Path) -> tuple[ContainerService, MagicMock]:
    """Create a ContainerService with mocked backend and real file I/O."""

    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    events = AsyncMock()

    config_dir = tmp_path / ".claudebox"
    config_dir.mkdir(parents=True, exist_ok=True)

    config = Config(
        work_dir=tmp_path,
        config_dir=config_dir,
        backend="podman",
    )

    proxy = MagicMock()
    svc = ContainerService(ws, events, config, proxy)
    svc._runtime._backend = MagicMock()
    return svc, events


def _build_app(container_service):
    """Build a minimal FastAPI app with the containers router and a stub workspace dependency."""

    app = FastAPI()
    app.include_router(router)

    async def _fake_get_workspace(workspace_id: str):
        return SimpleNamespace(container_service=container_service)

    app.dependency_overrides[get_workspace] = _fake_get_workspace
    return app


# Service: stop / kill
# ----------------------------------------------------------------------------------------------


class TestServiceStop:
    """`ContainerService.stop_container()` — SIGTERM with grace via runtime; ends STOPPED."""

    @pytest.mark.anyio
    async def test_default_grace_transitions_to_stopped(self, tmp_path):
        svc, events = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime.stop_container = MagicMock()

        await svc.stop_container("c1")

        svc._runtime.stop_container.assert_called_once_with("b1", grace_seconds=10)
        assert svc._containers["c1"].status == ContainerStatus.STOPPED
        assert events.broadcast.await_count == 2  # STOPPING + STOPPED

    @pytest.mark.anyio
    async def test_custom_grace_propagates(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime.stop_container = MagicMock()

        await svc.stop_container("c1", grace_seconds=5)

        svc._runtime.stop_container.assert_called_once_with("b1", grace_seconds=5)

    @pytest.mark.anyio
    async def test_runtime_failure_is_logged_not_raised(self, tmp_path):
        """Runtime errors during stop are swallowed so the registry stays consistent."""

        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime.stop_container = MagicMock(side_effect=RuntimeError("podman gone"))

        await svc.stop_container("c1")

        assert svc._containers["c1"].status == ContainerStatus.STOPPED

    @pytest.mark.anyio
    async def test_stop_nonexistent_raises(self, tmp_path):
        svc, _ = _make_service(tmp_path)

        with pytest.raises(ContainerNotFound):
            await svc.stop_container("nonexistent")


class TestServiceKill:
    """`ContainerService.kill_container()` — SIGKILL immediate via runtime; ends STOPPED."""

    @pytest.mark.anyio
    async def test_transitions_to_stopped(self, tmp_path):
        svc, events = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime.kill_container = MagicMock()

        await svc.kill_container("c1")

        svc._runtime.kill_container.assert_called_once_with("b1")
        assert svc._containers["c1"].status == ContainerStatus.STOPPED
        assert events.broadcast.await_count == 2

    @pytest.mark.anyio
    async def test_runtime_failure_is_logged_not_raised(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime.kill_container = MagicMock(side_effect=RuntimeError("podman gone"))

        await svc.kill_container("c1")

        assert svc._containers["c1"].status == ContainerStatus.STOPPED

    @pytest.mark.anyio
    async def test_kill_nonexistent_raises(self, tmp_path):
        svc, _ = _make_service(tmp_path)

        with pytest.raises(ContainerNotFound):
            await svc.kill_container("nonexistent")


# Service: remove
# ----------------------------------------------------------------------------------------------


class TestServiceRemove:
    """`ContainerService.remove()` — force-remove backend, pop registry."""

    @pytest.mark.anyio
    async def test_calls_backend_and_pops(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.STOPPED,
        )

        await svc.remove("c1")

        assert "c1" not in svc._containers
        svc._runtime._backend.remove_container.assert_called_once_with("b1")

    @pytest.mark.anyio
    async def test_swallows_backend_failure(self, tmp_path):
        """A runtime failure during force-remove is logged but does not abort the cleanup."""

        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.STOPPED,
        )
        svc._runtime._backend.remove_container.side_effect = RuntimeError("backend gone")

        await svc.remove("c1")

        assert "c1" not in svc._containers

    @pytest.mark.anyio
    async def test_remove_nonexistent_raises(self, tmp_path):
        svc, _ = _make_service(tmp_path)

        with pytest.raises(ContainerNotFound):
            await svc.remove("nonexistent")


# Handler: DELETE /containers/{id} (composite stop + remove)
# ----------------------------------------------------------------------------------------------


class TestDeleteRouteComposite:
    """DELETE keeps composite stop → remove for the web-UI tab-close path."""

    def test_invokes_stop_then_remove(self):
        container_service = MagicMock()
        container_service.stop_container = AsyncMock()
        container_service.remove = AsyncMock()

        client = TestClient(_build_app(container_service))
        response = client.delete("/api/workspaces/ws/containers/c1")

        assert response.status_code == 200
        assert response.json() == {"id": "c1", "status": "deleted"}

        container_service.stop_container.assert_awaited_once_with("c1")
        container_service.remove.assert_awaited_once_with("c1")

        # Order: stop completes before remove starts
        stop_call_index = next(
            i for i, c in enumerate(container_service.mock_calls) if c[0] == "stop_container"
        )
        remove_call_index = next(
            i for i, c in enumerate(container_service.mock_calls) if c[0] == "remove"
        )
        assert stop_call_index < remove_call_index


# Handler: POST /containers/{id}/stop
# ----------------------------------------------------------------------------------------------


class TestStopRoute:
    """POST /stop dispatches grace_seconds body to service.stop_container()."""

    def test_default_grace_via_empty_body(self):
        container_service = MagicMock()
        container_service.stop_container = AsyncMock()

        client = TestClient(_build_app(container_service))
        response = client.post("/api/workspaces/ws/containers/c1/stop", json={})

        assert response.status_code == 200
        assert response.json() == {"id": "c1", "status": "stopped"}
        container_service.stop_container.assert_awaited_once_with("c1", grace_seconds=10)

    def test_custom_grace_body(self):
        container_service = MagicMock()
        container_service.stop_container = AsyncMock()

        client = TestClient(_build_app(container_service))
        response = client.post(
            "/api/workspaces/ws/containers/c1/stop",
            json={"grace_seconds": 5},
        )

        assert response.status_code == 200
        container_service.stop_container.assert_awaited_once_with("c1", grace_seconds=5)


# Handler: POST /containers/{id}/kill
# ----------------------------------------------------------------------------------------------


class TestKillRoute:
    """POST /kill dispatches to service.kill_container() with no body."""

    def test_no_body_dispatches_kill(self):
        container_service = MagicMock()
        container_service.kill_container = AsyncMock()

        client = TestClient(_build_app(container_service))
        response = client.post("/api/workspaces/ws/containers/c1/kill")

        assert response.status_code == 200
        assert response.json() == {"id": "c1", "status": "stopped"}
        container_service.kill_container.assert_awaited_once_with("c1")
