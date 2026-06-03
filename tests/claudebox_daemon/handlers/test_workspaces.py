"""Tests for claudebox_daemon.handlers.workspaces — HTTP adapter responses."""

import dataclasses
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.agent_session.runtime_claude import ClaudeRuntime
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.handlers.workspaces import router


def _build_app(workspace_path: str):
    """Build a minimal FastAPI app with the workspaces router and a workspace stub."""

    app = FastAPI()
    app.include_router(router)

    async def _fake_get_workspace(workspace_id: str):
        workspace = MagicMock()
        workspace.path = workspace_path
        return SimpleNamespace(workspace=workspace)

    app.dependency_overrides[get_workspace] = _fake_get_workspace
    return app


def test_session_defaults_returns_framework_constants():
    """Happy path: returns workspace path + runtime defaults + available catalog lists + capability surface."""

    app = _build_app("/path/to/my-project")
    client = TestClient(app)

    response = client.get("/api/workspaces/my-project/session-defaults")

    assert response.status_code == 200
    body = response.json()
    assert body["workspace"] == "/path/to/my-project"
    assert body["runtime_name"] == "Claude"
    assert len(body["capabilities"]) == 15
    assert body["capabilities"]["supports_models"] is True
    assert body["model"] == ClaudeRuntime.DEFAULT_MODEL
    assert body["permission_mode"] == ClaudeRuntime.DEFAULT_PERMISSION_MODE
    assert body["effort_level"] == ClaudeRuntime.DEFAULT_EFFORT_LEVEL

    # Available lists track the runtime catalogs so the frontend can render
    # picker dropdowns on welcome before a container is reachable.
    assert {m["id"] for m in body["available_models"]} == {
        m.id for m in ClaudeRuntime.AVAILABLE_MODELS
    }
    assert {m["id"] for m in body["available_permission_modes"]} == {
        m.id for m in ClaudeRuntime.AVAILABLE_PERMISSION_MODES
    }
    assert {entry["id"] for entry in body["available_effort_levels"]} == {
        level.id for level in ClaudeRuntime.AVAILABLE_EFFORT_LEVELS
    }


def test_session_defaults_omits_catalogs_when_capability_false(monkeypatch):
    """When a catalog flag is False, both the default scalar and the available list are null."""

    gated = dataclasses.replace(
        ClaudeRuntime.CAPABILITIES,
        supports_models=False,
        supports_permission_modes=False,
        supports_effort_levels=False,
    )
    monkeypatch.setattr(ClaudeRuntime, "CAPABILITIES", gated)

    app = _build_app("/path/to/my-project")
    response = TestClient(app).get("/api/workspaces/my-project/session-defaults")

    assert response.status_code == 200
    body = response.json()
    assert body["model"] is None
    assert body["permission_mode"] is None
    assert body["effort_level"] is None
    assert body["available_models"] is None
    assert body["available_permission_modes"] is None
    assert body["available_effort_levels"] is None
    assert body["capabilities"]["supports_models"] is False


def test_session_defaults_resolves_per_workspace():
    """Sanity: the workspace path in the response reflects the resolved workspace, not a hardcode."""

    app_a = _build_app("/workspace/a")
    app_b = _build_app("/workspace/b")

    response_a = TestClient(app_a).get("/api/workspaces/a/session-defaults")
    response_b = TestClient(app_b).get("/api/workspaces/b/session-defaults")

    assert response_a.json()["workspace"] == "/workspace/a"
    assert response_b.json()["workspace"] == "/workspace/b"
