"""End-to-end board moves through the real routes, board service and board.yaml, onto disk."""

from __future__ import annotations

import urllib.parse
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.extensions.tickets import TicketError
from claudebox_daemon.app import handle_daemon_error, handle_ticket_error
from claudebox_daemon.domain import DaemonError, get_workspace
from claudebox_daemon.domain.boards.service import BoardService
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.boards import router as boards_router


TICKET = "tickets/active/x-1.md"


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    (tmp_path / ".workspace").touch()
    (tmp_path / "plan" / "tickets" / "active").mkdir(parents=True)
    (tmp_path / "plan" / TICKET).write_text("# X-1\n")

    return tmp_path


@pytest.fixture
def client(workspace: Path):
    service = BoardService(
        RegisteredWorkspace(id="ws", path=workspace),
        MagicMock(),
        MagicMock(),
        AsyncMock(),
        ObservedPool(1, name="listing"),
    )
    service._watcher = MagicMock()
    app = FastAPI()
    app.include_router(boards_router)
    app.add_exception_handler(DaemonError, handle_daemon_error)  # ty: ignore[invalid-argument-type]
    app.add_exception_handler(TicketError, handle_ticket_error)  # ty: ignore[invalid-argument-type]
    app.dependency_overrides[get_workspace] = lambda workspace_id: SimpleNamespace(
        board_service=service,
    )

    return TestClient(app)


def _board(workspace: Path, source: str, target: str) -> None:
    (workspace / "plan" / "board.yaml").write_text(
        "states:\n"
        f"- id: in-progress\n  label: In Progress\n  folder: {source}\n"
        f"- id: done\n  label: Done\n  folder: {target}\n  terminal: true\n"
        f"in-progress:\n- path: {TICKET}\n"
        "done: []\n",
    )


def _move(client: TestClient):
    ticket = urllib.parse.quote(TICKET, safe="")

    return client.patch(
        f"/api/workspaces/ws/boards/plan/tickets/{ticket}/move",
        json={"column": "done"},
    )


# SPEC: board:folder-under-board
@pytest.mark.parametrize(
    ("source", "target"),
    [("./tickets/active/", "tickets/active"), ("tickets//active", "tickets/./active/")],
    ids=["leading-dot-and-no-slash", "doubled-slash-and-inner-dot"],
)
def test_two_spellings_of_one_directory_move_the_card_and_not_the_file(
    workspace,
    client,
    source,
    target,
):
    _board(workspace, source, target)

    response = _move(client)

    assert response.status_code == 200
    assert response.json()["path"] == TICKET
    assert (workspace / "plan" / TICKET).read_text() == "# X-1\n"


# SPEC: board:folder-under-board
def test_a_folder_written_from_the_board_receives_the_file(workspace, client):
    _board(workspace, "tickets/active/", "tickets/completed/")

    response = _move(client)

    assert response.json()["path"] == "tickets/completed/x-1.md"
    assert (workspace / "plan" / "tickets" / "completed" / "x-1.md").read_text() == "# X-1\n"
    assert not (workspace / "plan" / TICKET).exists()


# SPEC: board:move-outside-folder-refused
@pytest.mark.parametrize("target", ["completed/", "tickets/completed/"], ids=["bare", "mixed"])
def test_a_bare_folder_names_the_boards_own_subdirectory_and_the_move_is_refused(
    workspace,
    client,
    target,
):
    _board(workspace, "active/", target)

    response = _move(client)

    assert response.status_code == 409
    assert response.json()["reason"] == "not_in_column_folder"
    assert (workspace / "plan" / TICKET).read_text() == "# X-1\n"
    assert not (workspace / "plan" / "tickets" / "tickets").exists()
