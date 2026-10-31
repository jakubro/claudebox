"""Tests for claudebox_daemon.handlers.files - the confined image endpoint over a real workspace."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox_daemon.app import handle_daemon_error
from claudebox_daemon.domain import DaemonError, get_workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.files import FileService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.files import router


PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR-bytes"
SESSION_ID = "0f6c2d0e-5b1a-4a7e-9a55-7d1f2f0c9b11"


@pytest.fixture
def workspace(tmp_path):
    """A workspace with an image, a note, a sub-directory, and one session holding a temp image."""

    root = tmp_path / "ws"
    (root / "sub").mkdir(parents=True)
    (root / ".workspace").touch()
    (root / "a.png").write_bytes(PNG)
    (root / "notes.md").write_text("# notes")
    (tmp_path / "outside.png").write_bytes(PNG)
    (root / "escape.png").symlink_to(tmp_path / "outside.png")

    session_tmp = root / ".claudebox" / "sessions" / f"20260101-000000--{SESSION_ID}" / "tmp"
    session_tmp.mkdir(parents=True)
    (session_tmp / "plot.png").write_bytes(PNG)
    (session_tmp / "escape.png").symlink_to(tmp_path / "outside.png")

    return root


@pytest.fixture
def client(workspace):
    app = FastAPI()
    app.include_router(router)
    service = FileService(
        RegisteredWorkspace(id="ws", path=workspace),
        executor=ObservedPool(1, name="listing"),
    )

    async def _fake_get_workspace(workspace_id: str):
        return SimpleNamespace(file_service=service)

    app.dependency_overrides[get_workspace] = _fake_get_workspace
    app.add_exception_handler(DaemonError, handle_daemon_error)  # ty: ignore[invalid-argument-type]

    return TestClient(app)


def _get(client, path, session=None):
    params = {"path": path} | ({"session": session} if session else {})

    return client.get("/api/workspaces/ws/files/image", params=params)


@pytest.mark.parametrize("path", ["a.png", "./a.png", "sub/../a.png"])
def test_an_image_inside_the_workspace_is_served(client, path):
    resp = _get(client, path)

    assert resp.status_code == 200
    assert resp.content == PNG
    assert resp.headers["content-type"] == "image/png"
    assert resp.headers["cache-control"] == "no-cache"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in resp.headers["content-security-policy"]


@pytest.mark.parametrize("path", ["../outside.png", "escape.png", "sub", "missing.png"])
def test_anything_outside_or_absent_is_the_same_404(client, path):
    resp = _get(client, path)

    assert resp.status_code == 404
    assert resp.json() == {"error": "file_not_found"}


@pytest.mark.parametrize("path", ["", "/etc/hosts", "/tmp/plot.png", "a\x00.png"])
def test_an_unusable_path_is_400(client, path):
    resp = _get(client, path)

    assert resp.status_code == 400
    assert resp.json()["error"] == "invalid_path"


def test_a_file_that_is_not_an_image_is_415(client):
    resp = _get(client, "notes.md")

    assert resp.status_code == 415
    assert resp.json()["error"] == "unsupported_media_type"


def test_a_tmp_image_is_served_from_the_sessions_temp_directory(client):
    resp = _get(client, "/tmp/plot.png", session=SESSION_ID)

    assert resp.status_code == 200
    assert resp.content == PNG


@pytest.mark.parametrize(
    ("path", "session"),
    [
        ("/tmp/../a.png", SESSION_ID),
        ("/tmp/escape.png", SESSION_ID),
        ("/tmp/plot.png", "11111111-2222-3333-4444-555555555555"),
        ("/tmp/plot.png", "../../etc"),
    ],
)
def test_a_tmp_image_outside_the_temp_directory_or_session_is_404(client, path, session):
    resp = _get(client, path, session=session)

    assert resp.status_code == 404
    assert resp.json() == {"error": "file_not_found"}


def test_an_unknown_session_creates_no_session_directory(client, workspace):
    _get(client, "/tmp/plot.png", session="11111111-2222-3333-4444-555555555555")

    sessions = sorted(p.name for p in (workspace / ".claudebox" / "sessions").iterdir())
    assert sessions == [f"20260101-000000--{SESSION_ID}"]
