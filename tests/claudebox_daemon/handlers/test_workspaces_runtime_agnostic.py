"""Workspace defaults endpoint resolves per the workspace's configured runtime.

A LangGraph workspace must return LangGraph's capability matrix + defaults,
not Claude's. These tests gate that: capability matrix, runtime name, and
catalog defaults all track the runtime resolved from the workspace's `agent`
TOML key; unknown agents 422.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.agent_session.runtime_claude import ClaudeRuntime
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.handlers.workspaces import router


def _build_app(workspace_path: str, *, agent: str):
    app = FastAPI()
    app.include_router(router)

    async def _fake_get_workspace(workspace_id: str):
        workspace = MagicMock()
        workspace.path = workspace_path
        config = SimpleNamespace(agent=agent)

        return SimpleNamespace(workspace=workspace, config=config)

    app.dependency_overrides[get_workspace] = _fake_get_workspace

    return app


def test_session_defaults_claude_unchanged():
    """Regression anchor: claude agent -> Claude matrix + Claude defaults (byte-shape stable)."""

    app = _build_app("/ws", agent="claude")
    response = TestClient(app).get("/api/workspaces/ws/session-defaults")

    assert response.status_code == 200
    body = response.json()
    assert body["runtime_name"] == "Claude"
    assert body["model"] == ClaudeRuntime.DEFAULT_MODEL
    assert body["permission_mode"] == ClaudeRuntime.DEFAULT_PERMISSION_MODE
    assert body["effort_level"] == ClaudeRuntime.DEFAULT_EFFORT_LEVEL
    assert body["capabilities"]["supports_skills"] is True


def test_session_defaults_langgraph_returns_langgraph_matrix():
    """LangGraph agent -> LangGraph capability matrix; control-plane flags False."""

    app = _build_app("/ws", agent="langgraph")
    response = TestClient(app).get("/api/workspaces/ws/session-defaults")

    assert response.status_code == 200
    body = response.json()
    assert body["runtime_name"] == "LangGraph"

    caps = body["capabilities"]
    assert caps["supports_skills"] is True
    assert caps["supports_set_model_mid_session"] is False
    assert caps["supports_set_permission_mode"] is False
    assert caps["supports_set_effort_level"] is False
    assert caps["supports_manual_compact"] is False
    assert caps["supports_mcp_delegation"] is False

    # The default-axis fields are still serialized for axes the runtime supports
    # (supports_models is True for LangGraph); empty string when no class-level
    # default exists.
    assert body["model"] == ""
    assert body["permission_mode"] is None  # supports_permission_modes False -> omitted
    assert body["effort_level"] is None


def test_session_defaults_langgraph_catalogs_empty_lists():
    """LangGraph workspace -> AVAILABLE_* catalogs are empty lists (not Claude's)."""

    app = _build_app("/ws", agent="langgraph")
    response = TestClient(app).get("/api/workspaces/ws/session-defaults")
    body = response.json()

    assert body["available_models"] == LangGraphRuntime.AVAILABLE_MODELS
    assert body["available_permission_modes"] is None
    assert body["available_effort_levels"] is None


def test_session_defaults_unknown_agent_returns_422():
    """Unknown `agent` value in workspace TOML -> HTTP 422 with actionable error body."""

    app = _build_app("/ws", agent="bogus")
    response = TestClient(app).get("/api/workspaces/ws/session-defaults")

    assert response.status_code == 422
    assert "bogus" in response.json()["detail"]
    assert "unknown runtime" in response.json()["detail"]


def test_session_defaults_claude_versus_langgraph_capability_diff():
    """Claude and LangGraph workspaces return distinct capability matrices for the same endpoint."""

    claude_body = (
        TestClient(_build_app("/ws", agent="claude"))
        .get("/api/workspaces/ws/session-defaults")
        .json()
    )
    langgraph_body = (
        TestClient(_build_app("/ws", agent="langgraph"))
        .get("/api/workspaces/ws/session-defaults")
        .json()
    )

    assert claude_body["runtime_name"] != langgraph_body["runtime_name"]
    # supports_set_model_mid_session is a clean Claude-vs-LangGraph divergence
    # (model bound at graph construction under LangGraph, runtime-mutable under Claude).
    assert claude_body["capabilities"]["supports_set_model_mid_session"] is True
    assert langgraph_body["capabilities"]["supports_set_model_mid_session"] is False
