"""Tests for claudebox_daemon.domain.boards.service.BoardService."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from claudebox.extensions.tickets import TicketNotFound
from claudebox_daemon.domain.boards.service import BoardService
from claudebox_daemon.domain.sessions.models import SessionInfo
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


def _make_service(tmp_path: Path) -> tuple[BoardService, MagicMock]:
    """Create a BoardService with mocked sessions/containers/events."""

    (tmp_path / ".workspace").touch()
    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    sessions = MagicMock()
    containers = MagicMock()
    containers.send = AsyncMock(return_value={})
    events = AsyncMock()

    svc = BoardService(ws, sessions, containers, events)
    # Replace watcher with a no-op to avoid filesystem watching in tests.
    svc._watcher = MagicMock()

    return svc, containers


class TestSendPromptSequence:
    """Test the prompt sequence delivery to a session's send endpoint."""

    @pytest.mark.anyio
    async def test_uses_prompt_field_matching_send_request_schema(self, tmp_path):
        """Payload must use the `prompt` key - `SendRequest` ignores other keys
        and defaults `prompt` to empty string, so any other key sends a blank
        message to the session.
        """

        svc, containers = _make_service(tmp_path)
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        await svc._send_prompt_sequence(
            result,
            ["/scope claudebox", "/implement {ticket}"],
            ["tickets/active/foo.md"],
        )

        # Two send calls - one per prompt template.
        assert containers.send.await_count == 2

        first_payload = containers.send.await_args_list[0].kwargs["payload"]
        second_payload = containers.send.await_args_list[1].kwargs["payload"]

        assert first_payload == {"prompt": "/scope claudebox"}
        assert second_payload == {"prompt": "/implement tickets/active/foo.md"}

    @pytest.mark.anyio
    async def test_substitutes_single_ticket_placeholder(self, tmp_path):
        svc, containers = _make_service(tmp_path)
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        await svc._send_prompt_sequence(
            result,
            ["/implement {ticket}"],
            ["path/to/ticket.md"],
        )

        payload = containers.send.await_args_list[0].kwargs["payload"]
        assert payload == {"prompt": "/implement path/to/ticket.md"}

    @pytest.mark.anyio
    async def test_substitutes_multi_ticket_placeholder_as_newline_list(self, tmp_path):
        """Multiple tickets render as ``\\n<p1>\\n<p2>`` - first path on its own line."""

        svc, containers = _make_service(tmp_path)
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        await svc._send_prompt_sequence(
            result,
            ["/implement {ticket}"],
            ["tickets/active/A.md", "tickets/active/B.md"],
        )

        payload = containers.send.await_args_list[0].kwargs["payload"]
        assert payload == {
            "prompt": "/implement\ntickets/active/A.md\ntickets/active/B.md",
        }

    @pytest.mark.anyio
    async def test_swallows_send_failures(self, tmp_path):
        """Failures in send must not abort the sequence (logged warning only)."""

        svc, containers = _make_service(tmp_path)
        containers.send = AsyncMock(side_effect=[RuntimeError("boom"), {}])
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        await svc._send_prompt_sequence(result, ["a", "b"], ["t.md"])

        assert containers.send.await_count == 2


class TestReadTicketContent:
    """Test BoardService.read_ticket_content typed-error contract."""

    def _setup_board(self, tmp_path: Path) -> tuple[BoardService, str]:
        """Create a workspace with one board.yaml and return (service, board_id)."""

        svc, _ = _make_service(tmp_path)
        board_dir = tmp_path / "docs"
        board_dir.mkdir()
        (board_dir / "board.yaml").write_text("name: test\nbacklog: []\n")
        # Trigger discovery so the board is registered.
        svc._discover()

        # board_id is the slugified relative dir path: "docs"
        return svc, "docs"

    def test_returns_content_for_existing_ticket(self, tmp_path):
        """Happy path: returns the file's text contents."""

        svc, board_id = self._setup_board(tmp_path)
        ticket_dir = tmp_path / "docs" / "tickets"
        ticket_dir.mkdir()
        (ticket_dir / "ok.md").write_text("# Existing ticket")

        content = svc.read_ticket_content(board_id, "tickets/ok.md")

        assert content == "# Existing ticket"

    def test_raises_ticket_not_found_for_missing_file(self, tmp_path):
        """Missing files must raise TicketNotFound (not FileNotFoundError)."""

        svc, board_id = self._setup_board(tmp_path)

        with pytest.raises(TicketNotFound):
            svc.read_ticket_content(board_id, "tickets/does-not-exist.md")

    def test_raises_ticket_not_found_for_path_escape(self, tmp_path):
        """Paths that resolve outside the workspace must raise TicketNotFound."""

        svc, board_id = self._setup_board(tmp_path)

        with pytest.raises(TicketNotFound):
            svc.read_ticket_content(board_id, "../../etc/passwd")

    def test_ticket_not_found_carries_context(self, tmp_path):
        """TicketNotFound must include board_id and ticket_path in its context."""

        svc, board_id = self._setup_board(tmp_path)

        with pytest.raises(TicketNotFound) as exc_info:
            svc.read_ticket_content(board_id, "tickets/missing.md")

        assert exc_info.value.context == {
            "board_id": board_id,
            "ticket_path": "tickets/missing.md",
        }
