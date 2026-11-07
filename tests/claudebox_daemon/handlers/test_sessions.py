"""Tests for claudebox_daemon.handlers.sessions - HTTP adapter responses."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.models import RenderedListing, SessionInfo
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
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
    """A body-less POST creates plainly - no allowlist consulted, no opening messages returned."""

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
    assert (resp.json()["undelivered_messages"], resp.json()["bundle_messages"]) == ([], [])


def test_new_session_leaves_messages_matching_the_allowlist_to_the_browser():
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-2", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow([r"/greet \S+"]):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/greet ada"]},
        )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once_with(bundle=None)
    session_service.create_with_prompts.assert_not_called()
    session_service.deliver_prompt.assert_not_called()
    assert (resp.json()["undelivered_messages"], resp.json()["bundle_messages"]) == ([], [])


def test_new_session_blocks_the_whole_batch_on_one_disallowed_message():
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-3", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow([r"/greet \S+"]):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/greet ada", "/danger"]},
        )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once()
    session_service.create_with_prompts.assert_not_called()
    session_service.deliver_prompt.assert_not_called()
    assert resp.json()["undelivered_messages"] == ["/greet ada", "/danger"]


def test_new_session_with_no_allowlist_configured_blocks_everything():
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-4", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow(None):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/greet ada"]},
        )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once()
    assert resp.json()["undelivered_messages"] == ["/greet ada"]


def test_new_session_invalid_regex_does_not_take_down_the_endpoint():
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-5", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service))

    with _patched_links_allow([r"(unclosed"]):
        resp = client.post(
            "/api/workspaces/myws/sessions/new",
            json={"messages": ["/greet ada"]},
        )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once()
    assert resp.json()["undelivered_messages"] == ["/greet ada"]


def test_list_sessions_logs_the_measured_response_size_and_duration():
    """The byte count only exists once the response is built - the handler is the only place to measure it."""

    session_service = MagicMock()
    body = b'{"sessions": [{"session_id": "s-1"}]}'
    session_service.list_all = AsyncMock(
        return_value=RenderedListing(body=body, session_count=1),
    )

    client = TestClient(_build_app(session_service))
    resp = client.get("/api/workspaces/myws/sessions")

    assert resp.status_code == 200
    assert resp.content == body
    assert resp.headers["content-type"] == "application/json"
    session_service.log_listing_completed.assert_called_once()
    kw = session_service.log_listing_completed.call_args.kwargs
    assert kw["session_count"] == 1
    assert kw["response_bytes"] == len(body)
    assert kw["total_seconds"] >= 0


def test_list_schedules_serves_the_rendered_body_as_json():
    session_service = MagicMock()
    body = b'{"sessions": [{"session_id": "s-1", "responding_since": null, "events": []}]}'
    session_service.list_schedules = AsyncMock(
        return_value=RenderedListing(body=body, session_count=1),
    )

    client = TestClient(_build_app(session_service))
    resp = client.get("/api/workspaces/myws/sessions/schedules")

    assert resp.status_code == 200
    assert resp.content == body
    assert resp.headers["content-type"] == "application/json"
    assert session_service.log_listing_completed.call_args.kwargs["kind"] == "schedule"


def test_list_sessions_serves_every_record_field_from_a_real_workspace(tmp_path):
    """The wire shape the panel reads: every session field, timestamps as ISO strings."""

    (tmp_path / ".workspace").touch()
    record = tmp_path / ".claudebox" / "sessions" / "20260101-000000--s-1" / "session.json"
    record.parent.mkdir(parents=True)
    record.write_text(
        json.dumps(
            {
                "session_id": "s-1",
                "name": "named",
                "started_at": "2026-01-01T00:00:00+00:00",
                "num_turns": 3,
                "first_message": "hello",
                "commands": ["/review"],
                "activity": "waiting",
            },
        ),
    )
    containers = MagicMock()
    containers.list_all.return_value = []
    service = SessionService(
        RegisteredWorkspace(id="ws", path=tmp_path),
        containers,
        AsyncMock(),
        agent="claude",
        executor=ObservedPool(1, name="listing"),
    )

    resp = TestClient(_build_app(service, workspace_path=tmp_path)).get(
        "/api/workspaces/ws/sessions",
    )

    assert resp.json() == {
        "sessions": [
            {
                "session_id": "s-1",
                "fork_point_cost_usd": 0.0,
                "name": "named",
                "auto_name": None,
                "model": None,
                "runtime": None,
                "provider": None,
                "started_at": "2026-01-01T00:00:00+00:00",
                "updated_at": None,
                "num_turns": 3,
                "total_cost_usd": None,
                "first_message": "hello",
                "last_message": None,
                "parent_session_id": None,
                "session_dir": None,
                "is_side_thread": False,
                "is_promoted": False,
                "spawned_from_session_id": None,
                "bundle": None,
                "needs_user": None,
                "needs_user_replies": None,
                "activity": "waiting",
                "container_id": None,
                "workspace": None,
                "permission_mode": None,
                "effort_level": None,
                "failed_prompts": None,
                "failed_seeds": None,
            },
        ],
    }


def test_a_bundles_messages_skip_the_link_allowlist_and_come_back_for_the_browser(tmp_path):
    (tmp_path / ".workspace").touch()
    settings = tmp_path / ".claudebox" / "settings.toml"
    settings.parent.mkdir()
    settings.write_text(
        'root = true\n[links]\nallow = ["/greet \\\\S+"]\n'
        '[bundles.research]\nmessages = ["/danger opening", "second"]\n',
    )
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-4", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service, workspace_path=tmp_path))
    resp = client.post(
        "/api/workspaces/myws/sessions/new",
        json={"messages": ["/greet ada"], "bundle": "research"},
    )

    assert resp.status_code == 200
    session_service.create.assert_awaited_once_with(bundle="research")
    session_service.create_with_prompts.assert_not_called()
    session_service.deliver_prompt.assert_not_called()
    assert resp.json()["undelivered_messages"] == []
    assert resp.json()["bundle_messages"] == ["/danger opening", "second"]


def test_link_messages_are_still_filtered_beside_a_bundle(tmp_path):
    (tmp_path / ".workspace").touch()
    settings = tmp_path / ".claudebox" / "settings.toml"
    settings.parent.mkdir()
    settings.write_text(
        'root = true\n[links]\nallow = ["/greet \\\\S+"]\n[bundles.research]\nmessages = ["hi"]\n',
    )
    session_service = MagicMock()
    session_service.create = AsyncMock(
        return_value=SessionInfo(session_id="s-5", fork_point_cost_usd=0.0),
    )

    client = TestClient(_build_app(session_service, workspace_path=tmp_path))
    resp = client.post(
        "/api/workspaces/myws/sessions/new",
        json={"messages": ["/danger"], "bundle": "research"},
    )

    assert resp.json()["undelivered_messages"] == ["/danger"]
    assert resp.json()["bundle_messages"] == ["hi"]
    session_service.create.assert_awaited_once_with(bundle="research")
