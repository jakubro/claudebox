"""Tests for top-level workspaces CRUD routes (GET / POST / DELETE /api/workspaces)."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from claudebox_daemon.domain import DaemonError, DaemonService, get_daemon
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.errors import WorkspaceNotRegistered
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.workspaces import router


# Helpers
# ----------------------------------------------------------------------------------------------


def _container(container_id: str, *, status: ContainerStatus) -> Container:
    return Container(id=container_id, backend_id=f"b-{container_id}", port=0, status=status)


def _workspace_stub(workspace_id: str, path: Path, *, containers=(), available=True):
    """Build a stub WorkspaceService exposing workspace + container_service."""

    container_service = MagicMock()
    container_service.list_all.return_value = list(containers)

    workspace = SimpleNamespace(id=workspace_id, path=path, available=available)

    return SimpleNamespace(workspace=workspace, container_service=container_service)


def _build_app(daemon: MagicMock):
    """Build a FastAPI app with the workspaces router and a stub daemon dependency."""

    app = FastAPI()
    app.include_router(router)

    async def _fake_get_daemon():
        return daemon

    app.dependency_overrides[get_daemon] = _fake_get_daemon

    async def _handle_daemon_error(_request, exc: DaemonError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.error_key, **exc.context},
        )

    app.add_exception_handler(DaemonError, _handle_daemon_error)  # ty: ignore[invalid-argument-type]  # Starlette type narrows to BaseException-handler; our handler accepts the specific subclass.

    return app


def _make_daemon(workspaces=(), *, register_returns=None, register_raises=None):
    """Build a DaemonService stub with list_workspaces/register/deregister wired.

    Uses a real DaemonService instance with bypass-init so the aggregation
    methods (``list_workspaces_with_counts`` etc.) execute their real logic.
    """

    daemon = DaemonService.__new__(DaemonService)
    daemon._logger = MagicMock()
    daemon.list_workspaces = AsyncMock(return_value=list(workspaces))

    if register_raises is not None:
        daemon.register_workspace = AsyncMock(side_effect=register_raises)
    else:
        daemon.register_workspace = AsyncMock(return_value=register_returns)

    daemon.deregister_workspace = AsyncMock()

    return daemon


# GET /api/workspaces
# ----------------------------------------------------------------------------------------------


class TestListWorkspaces:
    """GET enumerates registered workspaces with container counts."""

    def test_returns_entries_with_running_stopped_counts(self, tmp_path):
        ws_a = _workspace_stub(
            "a",
            tmp_path / "a",
            containers=[
                _container("c1", status=ContainerStatus.RUNNING),
                _container("c2", status=ContainerStatus.RUNNING),
                _container("c3", status=ContainerStatus.STOPPED),
            ],
        )
        ws_b = _workspace_stub("b", tmp_path / "b", containers=[])

        daemon = _make_daemon(workspaces=[ws_a, ws_b])
        client = TestClient(_build_app(daemon))

        response = client.get("/api/workspaces")

        assert response.status_code == 200
        body = response.json()
        by_id = {w["id"]: w for w in body["workspaces"]}
        assert by_id["a"]["containers"] == {"running": 2, "stopped": 1}
        assert by_id["b"]["containers"] == {"running": 0, "stopped": 0}
        assert by_id["a"]["path"] == str(tmp_path / "a")

    def test_unavailable_workspace_contributes_zero_counts(self, tmp_path):
        ws = _workspace_stub("dead", tmp_path / "dead", containers=[], available=False)

        daemon = _make_daemon(workspaces=[ws])
        client = TestClient(_build_app(daemon))

        response = client.get("/api/workspaces")

        assert response.status_code == 200
        [entry] = response.json()["workspaces"]
        assert entry["containers"] == {"running": 0, "stopped": 0}

    def test_empty_list_when_no_workspaces(self):
        daemon = _make_daemon(workspaces=[])
        client = TestClient(_build_app(daemon))

        response = client.get("/api/workspaces")

        assert response.status_code == 200
        assert response.json() == {"workspaces": []}


# POST /api/workspaces
# ----------------------------------------------------------------------------------------------


class TestRegisterWorkspace:
    """POST registers a workspace; idempotent - re-register surfaces existing entry."""

    def test_registers_new(self, tmp_path):
        new = RegisteredWorkspace(id="myproj", path=tmp_path / "myproj")
        daemon = _make_daemon(register_returns=new)

        client = TestClient(_build_app(daemon))
        response = client.post("/api/workspaces", json={"path": str(tmp_path / "myproj")})

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == "myproj"
        assert body["path"] == str(tmp_path / "myproj")
        daemon.register_workspace.assert_awaited_once_with(str(tmp_path / "myproj"))

    def test_idempotent_returns_existing_entry(self, tmp_path):
        existing = RegisteredWorkspace(id="myproj", path=tmp_path / "myproj")
        daemon = _make_daemon(register_returns=existing)

        client = TestClient(_build_app(daemon))
        first = client.post("/api/workspaces", json={"path": str(tmp_path / "myproj")})
        second = client.post("/api/workspaces", json={"path": str(tmp_path / "myproj")})

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json() == second.json()

    def test_basename_collision_disambiguates_id(self, tmp_path):
        """Two paths sharing basename get distinct ids - handler surfaces the daemon's choice."""

        disambiguated = RegisteredWorkspace(id="myapp-a1b2c3d4", path=tmp_path / "other/myapp")
        daemon = _make_daemon(register_returns=disambiguated)

        client = TestClient(_build_app(daemon))
        response = client.post("/api/workspaces", json={"path": str(tmp_path / "other/myapp")})

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == "myapp-a1b2c3d4"
        assert body["id"].startswith("myapp-")


# DELETE /api/workspaces/{id}
# ----------------------------------------------------------------------------------------------


class TestDeregisterWorkspace:
    """DELETE removes a workspace; 404 if absent."""

    def test_success(self):
        daemon = _make_daemon()
        client = TestClient(_build_app(daemon))

        response = client.delete("/api/workspaces/myproj")

        assert response.status_code == 200
        assert response.json() == {"id": "myproj", "status": "deregistered"}
        daemon.deregister_workspace.assert_awaited_once_with("myproj")

    def test_unknown_id_returns_404(self):
        daemon = _make_daemon()
        daemon.deregister_workspace = AsyncMock(
            side_effect=WorkspaceNotRegistered(workspace_id="ghost")
        )

        client = TestClient(_build_app(daemon))
        response = client.delete("/api/workspaces/ghost")

        assert response.status_code == 404
        body = response.json()
        assert body["error"] == "workspace_not_registered"
        assert body["workspace_id"] == "ghost"


# Workspace-scoped routes preserved (URLs unchanged after rebase)
# ----------------------------------------------------------------------------------------------


class TestWorkspaceScopedRoutesPreserved:
    """Existing /{workspace_id}/session-defaults and /{workspace_id}/commands still resolve."""

    def test_session_defaults_route_resolves(self, tmp_path):
        """Verifies the rebased prefix didn't break workspace-scoped session-defaults URL."""

        from claudebox_daemon.domain import get_workspace

        app = FastAPI()
        app.include_router(router)

        async def _fake_get_workspace(workspace_id: str):
            workspace = MagicMock()
            workspace.path = tmp_path / workspace_id
            config = SimpleNamespace(agent="claude")

            return SimpleNamespace(workspace=workspace, config=config)

        app.dependency_overrides[get_workspace] = _fake_get_workspace

        client = TestClient(app)
        response = client.get("/api/workspaces/myproj/session-defaults")

        assert response.status_code == 200
        body = response.json()
        assert body["workspace"] == str(tmp_path / "myproj")

    def test_commands_route_resolves(self, tmp_path):
        """Verifies the rebased prefix didn't break workspace-scoped commands URL."""

        from claudebox_daemon.domain import get_workspace

        app = FastAPI()
        app.include_router(router)

        async def _fake_get_workspace(workspace_id: str):
            workspace_service = MagicMock()
            workspace_service.list_workspace_commands.return_value = {
                "custom": [],
                "mcp": [],
                "builtin": [],
            }

            return workspace_service

        app.dependency_overrides[get_workspace] = _fake_get_workspace

        client = TestClient(app)
        response = client.get("/api/workspaces/myproj/commands")

        assert response.status_code == 200
        assert response.json() == {"custom": [], "mcp": [], "builtin": []}


# Wiring sanity
# ----------------------------------------------------------------------------------------------


def test_register_body_validation():
    """Missing `path` in the body produces a 422 validation error."""

    daemon = _make_daemon()
    client = TestClient(_build_app(daemon))

    response = client.post("/api/workspaces", json={})

    assert response.status_code == 422
