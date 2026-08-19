"""Tests for claudebox_daemon.handlers.boards - HTTP adapter responses."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from claudebox.extensions.tickets import TicketError, TicketNotFound
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.handlers.boards import router


def _build_app(board_service):
    """Build a minimal FastAPI app with the boards router, workspace stub, and TicketError handler."""

    app = FastAPI()
    app.include_router(router)

    async def _fake_get_workspace(workspace_id: str):
        return SimpleNamespace(board_service=board_service)

    app.dependency_overrides[get_workspace] = _fake_get_workspace

    async def _handle_ticket_error(_request, exc: TicketError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.error_key, **exc.context},
        )

    # Starlette narrows the handler param to BaseException; ours accepts TicketError specifically.
    app.add_exception_handler(TicketError, _handle_ticket_error)  # ty: ignore[invalid-argument-type]

    return app


def test_get_ticket_content_returns_markdown_on_success():
    """Happy path: returns the markdown body verbatim with text/markdown content type."""

    board_service = MagicMock()
    board_service.read_ticket_content.return_value = "# Hello\n\nbody"

    client = TestClient(_build_app(board_service))
    resp = client.get("/api/workspaces/myws/boards/docs/tickets/x.md/content")

    assert resp.status_code == 200
    assert resp.text == "# Hello\n\nbody"
    assert resp.headers["content-type"].startswith("text/markdown")
    board_service.read_ticket_content.assert_called_once_with("docs", "x.md")


def test_get_ticket_content_returns_typed_404_for_missing_ticket():
    """Missing ticket surfaces as 404 with `error: ticket_not_found` envelope (not raw HTTPException detail)."""

    board_service = MagicMock()
    board_service.read_ticket_content.side_effect = TicketNotFound(
        board_id="docs",
        ticket_path="missing.md",
    )

    client = TestClient(_build_app(board_service))
    resp = client.get("/api/workspaces/myws/boards/docs/tickets/missing.md/content")

    assert resp.status_code == 404
    body = resp.json()
    assert body["error"] == "ticket_not_found"
    assert body["board_id"] == "docs"
    assert body["ticket_path"] == "missing.md"


def test_list_boards_logs_the_measured_response_size_and_duration():
    """The byte count only exists once the response is built - the handler is the only place to measure it."""

    board_service = MagicMock()
    board_service.list_all = AsyncMock(return_value=[{"name": "My Board"}])

    client = TestClient(_build_app(board_service))
    resp = client.get("/api/workspaces/myws/boards")

    assert resp.status_code == 200
    assert resp.json() == {"boards": [{"name": "My Board"}]}
    board_service.log_listing_completed.assert_called_once()
    kw = board_service.log_listing_completed.call_args.kwargs
    assert kw["board_count"] == 1
    assert kw["response_bytes"] > 0
    assert kw["total_seconds"] >= 0
