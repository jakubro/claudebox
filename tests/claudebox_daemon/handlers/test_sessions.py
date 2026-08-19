"""Tests for claudebox_daemon.handlers.sessions - HTTP adapter responses."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox_daemon.domain import get_workspace
from claudebox_daemon.handlers.sessions import router


def _build_app(session_service):
    """Build a minimal FastAPI app with the sessions router and a workspace stub."""

    app = FastAPI()
    app.include_router(router)

    async def _fake_get_workspace(workspace_id: str):
        return SimpleNamespace(session_service=session_service)

    app.dependency_overrides[get_workspace] = _fake_get_workspace

    return app


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
