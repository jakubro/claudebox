"""End-to-end tests for registering a directory through the daemon, then listing its sessions.

Real registry, daemon service and routes; the home directory holds a session of its own.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.core.fs import walk_up
from claudebox_daemon.app import handle_daemon_error
from claudebox_daemon.domain import DaemonError, DaemonService, get_daemon, get_workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.handlers.sessions import router as sessions_router
from claudebox_daemon.handlers.workspaces import router as workspaces_router


def _session(root: Path, session_id: str) -> None:
    directory = root / ".claudebox" / "sessions" / f"20260101-000000--{session_id}"
    directory.mkdir(parents=True)
    (directory / "session.json").write_text(
        json.dumps(
            {
                "session_id": session_id,
                "fork_point_cost_usd": 0.0,
                "num_turns": 1,
                "started_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
                "first_message": f"the first message of {session_id}",
            },
        ),
    )


@pytest.fixture
def home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: home))
    boundary = tmp_path.resolve()

    def bounded(start_dir=None):
        for directory in walk_up(start_dir):
            yield directory

            if directory == boundary:
                break

    monkeypatch.setattr("claudebox.paths.walk_up", bounded)
    _session(home, "s-home")

    return home


@pytest.fixture
def daemon(home):
    with patch("claudebox_daemon.domain.service.WorkspaceService") as workspace_service:
        workspace_service.side_effect = lambda workspace, *_: MagicMock(
            workspace=workspace,
            available=True,
            start=AsyncMock(),
            _container_service=MagicMock(list_all=MagicMock(return_value=[])),
        )
        daemon = DaemonService()

        yield daemon

    daemon._executors.shutdown()


@pytest.fixture
def client(daemon):
    def workspace(workspace_id: str) -> SimpleNamespace:
        return SimpleNamespace(
            session_service=SessionService(
                daemon._daemon_config.get_workspace(workspace_id),
                MagicMock(list_all=MagicMock(return_value=[])),
                AsyncMock(),
                agent="claude",
                executor=ObservedPool(1, name="listing"),
            ),
        )

    app = FastAPI()
    app.include_router(workspaces_router)
    app.include_router(sessions_router)
    app.add_exception_handler(DaemonError, handle_daemon_error)  # ty: ignore[invalid-argument-type]
    app.dependency_overrides[get_daemon] = lambda: daemon
    app.dependency_overrides[get_workspace] = workspace

    return TestClient(app)


# SPEC: workspace:register-marker
def test_a_registered_directory_lists_its_own_sessions_and_not_the_homes(tmp_path, client):
    project = tmp_path / "project"
    _session(project, "s-project")

    registered = client.post("/api/workspaces", json={"path": str(project)})
    listed = client.get(f"/api/workspaces/{registered.json()['id']}/sessions").json()["sessions"]

    assert registered.status_code == 200
    assert [s["session_id"] for s in listed] == ["s-project"]
    assert (project / ".workspace").is_file()


# SPEC: workspace:register
def test_a_home_relative_path_registers_the_directory_it_names(home, client):
    _session(home / "project", "s-project")

    registered = client.post("/api/workspaces", json={"path": "~/project"}).json()
    listed = client.get(f"/api/workspaces/{registered['id']}/sessions").json()["sessions"]

    assert registered["path"] == str((home / "project").resolve())
    assert [s["session_id"] for s in listed] == ["s-project"]


# SPEC: workspace:register-invalid-path
@pytest.mark.parametrize(
    ("path", "error_key"),
    [
        ("project", "workspace_path_relative"),
        ("{root}/nowhere", "workspace_path_missing"),
        ("{root}/notes.txt", "workspace_path_not_a_directory"),
    ],
    ids=["relative", "missing", "file"],
)
def test_a_path_that_names_no_directory_is_refused_and_nothing_registers(
    tmp_path,
    client,
    path,
    error_key,
):
    (tmp_path / "notes.txt").write_text("not a workspace")

    refused = client.post("/api/workspaces", json={"path": path.format(root=tmp_path)})

    assert (refused.status_code, refused.json()["error"]) == (400, error_key)
    assert refused.json()["message"]
    assert client.get("/api/workspaces").json()["workspaces"] == []


# SPEC: workspace:register-invalid-path
def test_a_directory_that_cannot_be_marked_is_refused_and_nothing_registers(
    tmp_path,
    client,
    monkeypatch,
):
    project = tmp_path / "project"
    project.mkdir()

    def refuse(path, *_args, **_kwargs):
        raise PermissionError(13, "Permission denied", str(path))

    monkeypatch.setattr("pathlib.Path.touch", refuse)

    refused = client.post("/api/workspaces", json={"path": str(project)})

    assert (refused.status_code, refused.json()["error"]) == (400, "workspace_marker_unwritable")
    assert client.get("/api/workspaces").json()["workspaces"] == []


# SPEC: workspace:register-idempotent
def test_registering_the_same_directory_again_says_it_is_already_registered(tmp_path, client):
    project = tmp_path / "project"
    project.mkdir()

    first = client.post("/api/workspaces", json={"path": str(project)}).json()
    again = client.post("/api/workspaces", json={"path": str(project)}).json()

    assert (first["already_registered"], again["already_registered"]) == (False, True)
    assert again["id"] == first["id"]
    assert [w["id"] for w in client.get("/api/workspaces").json()["workspaces"]] == [first["id"]]


# SPEC: workspace:register-needs-cli
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
def test_the_home_directory_registers_only_once_a_terminal_marked_it(
    tmp_path,
    home,
    client,
    spelling,
    resolved,
):
    (home / ".claudebox").mkdir(exist_ok=True)
    (tmp_path / "home-link").symlink_to(home)
    directory = Path(resolved.replace("<home>", str(home)).replace("<root>", str(tmp_path)))
    spelled = spelling.replace("<home>", str(home)).replace("<root>", str(tmp_path))

    refused = client.post("/api/workspaces", json={"path": spelled})

    assert (refused.status_code, refused.json()["error"]) == (400, "workspace_path_needs_cli")
    assert "claudebox workspaces register" in refused.json()["message"]
    assert not (directory / ".workspace").exists()
    assert client.get("/api/workspaces").json()["workspaces"] == []

    (directory / ".workspace").touch()
    accepted = client.post("/api/workspaces", json={"path": spelled})

    assert accepted.status_code == 200
    assert (accepted.json()["path"], accepted.json()["already_registered"]) == (
        str(directory.resolve()),
        False,
    )


# SPEC: workspace:register-needs-cli
def test_a_project_beside_the_refused_home_still_registers(tmp_path, home, client):
    refused = client.post("/api/workspaces", json={"path": str(home)})
    project = home / "code" / "app"
    project.mkdir(parents=True)

    accepted = client.post("/api/workspaces", json={"path": str(project)})

    assert refused.status_code == 400
    assert accepted.status_code == 200
    assert (project / ".workspace").is_file()
