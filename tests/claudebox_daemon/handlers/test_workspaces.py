"""Tests for claudebox_daemon.handlers.workspaces - HTTP adapter responses."""

from __future__ import annotations

import dataclasses
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.agent_session.runtime_claude import ClaudeRuntime
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.handlers.workspaces import router


def _build_app(
    workspace_path: str,
    *,
    agent: str = "claude",
    editor_url_template: str | None = None,
    rate_limits: list[dict] | None = None,
):
    """Build a minimal FastAPI app with the workspaces router and a workspace stub."""

    app = FastAPI()
    app.include_router(router)

    async def _fake_get_workspace(workspace_id: str):
        workspace = MagicMock()
        workspace.path = workspace_path
        config = SimpleNamespace(agent=agent, editor_url_template=editor_url_template)
        rate_limit_store = SimpleNamespace(get=lambda: rate_limits or [])

        return SimpleNamespace(workspace=workspace, config=config, rate_limits=rate_limit_store)

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
    assert body["editor_url_template"] is None
    assert body["rate_limits"] == []
    assert len(body["capabilities"]) == 15
    assert body["capabilities"]["supports_models"] is True
    assert body["model"] == ClaudeRuntime.DEFAULT_MODEL
    assert body["permission_mode"] == ClaudeRuntime.DEFAULT_PERMISSION_MODE
    assert body["effort_level"] == ClaudeRuntime.DEFAULT_EFFORT_LEVEL

    # Available lists mirror runtime catalogs so the frontend can render pickers pre-container.
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


def test_session_defaults_includes_editor_url_template_when_configured():
    """The configured editor URI template passes through verbatim."""

    app = _build_app(
        "/path/to/my-project",
        editor_url_template="jetbrains://idea/navigate/reference?path={path}",
    )
    response = TestClient(app).get("/api/workspaces/my-project/session-defaults")

    assert response.status_code == 200
    assert (
        response.json()["editor_url_template"] == "jetbrains://idea/navigate/reference?path={path}"
    )


def test_session_defaults_passes_through_stored_rate_limits():
    """The workspace's live plan-limit entries ride the same response - the welcome-screen path."""

    entries = [
        {
            "rate_limit_type": "seven_day",
            "status": "allowed_warning",
            "resets_at": None,
            "utilization": 0.82,
        },
    ]
    app = _build_app("/path/to/my-project", rate_limits=entries)
    response = TestClient(app).get("/api/workspaces/my-project/session-defaults")

    assert response.status_code == 200
    assert response.json()["rate_limits"] == entries


def test_session_defaults_resolves_per_workspace():
    """Sanity: the workspace path in the response reflects the resolved workspace, not a hardcode."""

    app_a = _build_app("/workspace/a")
    app_b = _build_app("/workspace/b")

    response_a = TestClient(app_a).get("/api/workspaces/a/session-defaults")
    response_b = TestClient(app_b).get("/api/workspaces/b/session-defaults")

    assert response_a.json()["workspace"] == "/workspace/a"
    assert response_b.json()["workspace"] == "/workspace/b"


def test_session_defaults_lists_bundles_in_order_with_only_what_each_declared(tmp_path):
    (tmp_path / ".workspace").touch()
    settings = tmp_path / ".claudebox" / "settings.toml"
    settings.parent.mkdir()
    settings.write_text(
        "root = true\n"
        '[bundles.zeta]\nmodel = "claude-sonnet-5"\n[bundles.zeta.env]\nKEY = "v"\n'
        '[bundles.alpha]\neffort_level = "max"\nmessages = ["hi"]\n'
        '[bundles.bare.mounts]\n"/srv/a" = "/a"\n',
    )
    app = _build_app(str(tmp_path))

    body = TestClient(app).get("/api/workspaces/my-project/session-defaults").json()

    assert body["bundle_names"] == ["zeta", "alpha", "bare"]
    assert body["bundles"] == {
        "zeta": {"declared": {"model": "claude-sonnet-5"}, "keys": ["env", "model"]},
        "alpha": {"declared": {"effort_level": "max"}, "keys": ["effort_level", "messages"]},
        "bare": {"declared": {}, "keys": ["mounts"]},
    }


def test_session_defaults_reads_bundles_fresh_on_every_request(tmp_path):
    (tmp_path / ".workspace").touch()
    settings = tmp_path / ".claudebox" / "settings.toml"
    settings.parent.mkdir()
    settings.write_text("root = true\n")
    client = TestClient(_build_app(str(tmp_path)))

    assert client.get("/api/workspaces/my-project/session-defaults").json()["bundle_names"] == []

    settings.write_text('root = true\n[bundles.late]\nmodel = "m"\n')

    assert client.get("/api/workspaces/my-project/session-defaults").json()["bundle_names"] == [
        "late",
    ]


def _workspace(tmp_path, settings: str = ""):
    (tmp_path / ".workspace").touch()
    settings_file = tmp_path / ".claudebox" / "settings.toml"
    settings_file.parent.mkdir(exist_ok=True)
    settings_file.write_text("root = true\n" + settings)

    return TestClient(_build_app(str(tmp_path)))


def _logged_in(client: TestClient):
    return client.get("/api/workspaces/my-project/session-defaults").json()["logged_in"]


def test_session_defaults_reports_no_login_without_credentials(tmp_path):
    assert _logged_in(_workspace(tmp_path)) is False


def test_session_defaults_reports_a_login_once_the_workspace_holds_credentials(tmp_path):
    client = _workspace(tmp_path)
    credentials = tmp_path / ".claudebox" / "fs" / "root" / ".claude" / ".credentials.json"
    credentials.parent.mkdir(parents=True)
    credentials.write_text("{}")

    assert _logged_in(client) is True


@pytest.mark.parametrize(
    "key",
    [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
    ],
)
def test_session_defaults_counts_a_key_in_settings_as_a_login(tmp_path, key):
    assert _logged_in(_workspace(tmp_path, f'[env]\n{key} = "1"\n')) is True


def test_session_defaults_ignores_unrelated_settings_env(tmp_path):
    assert _logged_in(_workspace(tmp_path, '[env]\nOTHER_TOKEN = "1"\n')) is False


def test_session_defaults_has_no_login_state_for_a_langgraph_workspace(tmp_path):
    assert _logged_in(_workspace(tmp_path, 'agent = "langgraph"\n')) is None


def test_session_defaults_local_backend_reads_the_daemons_agent_config(tmp_path, monkeypatch):
    agent_config = tmp_path / "agent-config"
    agent_config.mkdir()
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(agent_config))
    workspace = tmp_path / "ws"
    workspace.mkdir()
    client = _workspace(workspace, 'backend = "local"\n')

    assert _logged_in(client) is False

    (agent_config / ".credentials.json").write_text("{}")

    assert _logged_in(client) is True
