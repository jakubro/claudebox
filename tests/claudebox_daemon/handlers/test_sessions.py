"""Tests for claudebox_daemon.handlers.sessions - HTTP adapter responses."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.sessions.models import SessionInfo
from claudebox_daemon.handlers.sessions import router


def _build_app(session_service, workspace_path="/tmp/ws"):
    """Build a minimal FastAPI app with the sessions router and a workspace stub."""

    app = FastAPI()
    app.include_router(router)

    async def _fake_get_workspace(workspace_id: str):
        return SimpleNamespace(
            session_service=session_service,
            workspace=SimpleNamespace(path=workspace_path),
        )

    app.dependency_overrides[get_workspace] = _fake_get_workspace

    return app


def _patched_links_allow(patterns):
    """Patch Config.load so the handler sees a fixed links_allow without touching disk."""

    return patch(
        "claudebox_daemon.handlers.sessions.Config.load",
        return_value=SimpleNamespace(links_allow=patterns),
    )


def test_fork_session_forwards_parent_session_id_override():
    """Promotion's re-parent override rides the fork request body straight to the service."""

    session_service = MagicMock()
    session_service.fork = AsyncMock(return_value={"session_id": "promoted-1"})

    client = TestClient(_build_app(session_service))
    resp = client.post(
        "/api/workspaces/myws/sessions/side-1/fork",
        json={"parent_session_id": "main-1"},
    )

    assert resp.status_code == 200
    session_service.fork.assert_awaited_once_with(
        "side-1",
        None,
        reuse_container=False,
        share_container=False,
        parent_session_id="main-1",
    )


def test_fork_session_defaults_parent_session_id_to_none():
    """No override supplied - the service falls back to the source session itself."""

    session_service = MagicMock()
    session_service.fork = AsyncMock(return_value={"session_id": "fork-1"})

    client = TestClient(_build_app(session_service))
    resp = client.post("/api/workspaces/myws/sessions/s1/fork", json={})

    assert resp.status_code == 200
    session_service.fork.assert_awaited_once_with(
        "s1",
        None,
        reuse_container=False,
        share_container=False,
        parent_session_id=None,
    )


def test_new_session_with_no_body_behaves_as_before():
    """A body-less POST creates plainly - no allowlist consulted, no messages delivered."""

    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-1", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow(None):
        resp = client.post("/api/workspaces/myws/sessions/new")

    assert resp.status_code == 200
    session_service.create.assert_awaited_once()
    session_service.create_with_prompts.assert_not_called()
    assert resp.json()["undelivered_messages"] == []


def test_new_session_delivers_messages_matching_the_allowlist():
    session_service = MagicMock()
    session_service.create_with_prompts = AsyncMock(
        return_value=SessionInfo(session_id="s-2", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow([r"/scope \S+"]):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/scope claudebox"]},
        )

    assert resp.status_code == 200
    session_service.create_with_prompts.assert_awaited_once_with(["/scope claudebox"])
    assert resp.json()["undelivered_messages"] == []


def test_new_session_blocks_the_whole_batch_on_one_disallowed_message():
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-3", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow([r"/scope \S+"]):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/scope claudebox", "/danger"]},
        )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once()
    session_service.create_with_prompts.assert_not_called()
    assert resp.json()["undelivered_messages"] == ["/scope claudebox", "/danger"]


def test_new_session_with_no_allowlist_configured_blocks_everything():
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-4", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow(None):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/scope claudebox"]},
        )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once()
    assert resp.json()["undelivered_messages"] == ["/scope claudebox"]


def test_new_session_invalid_regex_does_not_take_down_the_endpoint():
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-5", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow([r"(unclosed"]):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/scope claudebox"]},
        )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once()
    assert resp.json()["undelivered_messages"] == ["/scope claudebox"]


def test_list_sessions_logs_the_measured_response_size_and_duration():
    """The byte count only exists once the response is built - the handler is the only place to measure it."""

    session_service = MagicMock()
    session_service.list_all = AsyncMock(return_value=[{"session_id": "s-1"}])

    client = TestClient(_build_app(session_service))
    resp = client.get("/api/workspaces/myws/sessions")

    assert resp.status_code == 200
    assert resp.json() == {"sessions": [{"session_id": "s-1"}]}
    session_service.log_listing_completed.assert_called_once()
    kw = session_service.log_listing_completed.call_args.kwargs
    assert kw["session_count"] == 1
    assert kw["response_bytes"] > 0
    assert kw["total_seconds"] >= 0
