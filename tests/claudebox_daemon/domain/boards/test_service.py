"""Tests for claudebox_daemon.domain.boards.service.BoardService."""

from __future__ import annotations

import asyncio
import threading
import time
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

import claudebox_daemon.domain.boards.service as service_module
from claudebox.extensions.tickets import TicketNotFound
from claudebox_daemon.domain.boards.service import BoardService
from claudebox_daemon.domain.errors import ListingTimeout
from claudebox_daemon.domain.executors import ObservedPool
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
    executor = ObservedPool(1, name="listing")

    svc = BoardService(ws, sessions, containers, events, executor)
    # Replace watcher with a no-op to avoid filesystem watching in tests.
    svc._watcher = MagicMock()

    return svc, containers


class TestListAll:
    """Test list_all()'s dispatch of the workspace walk to the daemon executor, off the event loop."""

    @pytest.mark.anyio
    async def test_returns_discovered_boards(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        board_dir = tmp_path / "docs"
        board_dir.mkdir()
        (board_dir / "board.yaml").write_text("name: My Board\nbacklog: []\n")

        result = await svc.list_all()

        assert len(result) == 1
        assert result[0].name == "My Board"

    @pytest.mark.anyio
    async def test_runs_on_the_daemon_executor_not_the_default_pool(self, tmp_path, monkeypatch):
        """The default pool is shared by other daemon-side blocking work, so using it here would queue behind that work."""

        svc, _ = _make_service(tmp_path)
        seen_thread = []
        original_discover = svc._discover

        def _spy_discover():
            seen_thread.append(threading.current_thread().name)

            return original_discover()

        monkeypatch.setattr(svc, "_discover", _spy_discover)

        await svc.list_all()

        assert seen_thread[0] != threading.current_thread().name
        assert asyncio.get_running_loop()._default_executor is None  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_a_hung_workspace_walk_raises_listing_timeout_instead_of_blocking_forever(
        self,
        tmp_path,
        monkeypatch,
    ):
        """Offloading to the executor doesn't fix a genuine hang - the call must still time out, or a stuck worker starves the shared pool."""

        monkeypatch.setattr(service_module, "DISK_LISTING_TIMEOUT", timedelta(seconds=0.05))
        svc, _ = _make_service(tmp_path)
        monkeypatch.setattr(svc, "_discover", lambda: time.sleep(0.3))

        with pytest.raises(ListingTimeout):
            await svc.list_all()

    @pytest.mark.anyio
    async def test_concurrent_listings_share_one_walk(self, tmp_path, monkeypatch):
        """Every open tab refetches on the same broadcast - N walks would occupy N workers to answer one question."""

        svc, _ = _make_service(tmp_path)
        walks = []
        original_discover = svc._discover

        def _slow_discover():
            walks.append(1)
            time.sleep(0.05)

            return original_discover()

        monkeypatch.setattr(svc, "_discover", _slow_discover)

        await asyncio.gather(*[svc.list_all() for _ in range(10)])

        assert len(walks) == 1

    @pytest.mark.anyio
    async def test_a_successful_walk_logs_queue_and_scan_seconds(self, tmp_path):
        """A slow-but-successful walk must still say where its time went."""

        svc, _ = _make_service(tmp_path)
        logged = []
        svc._logger = MagicMock()
        svc._logger.info = lambda event, **kw: logged.append((event, kw))

        await svc.list_all()

        scanned = next(kw for event, kw in logged if event == "board_listing_scanned")
        assert scanned["queued_seconds"] >= 0
        assert scanned["scan_seconds"] >= 0
        assert "pool" in scanned
        assert scanned["workspace"]["id"] == "test-ws"

    def test_log_listing_completed_reports_the_handler_measured_fields(self, tmp_path):
        """The byte count and end-to-end duration only exist in the handler - this is where they land."""

        svc, _ = _make_service(tmp_path)
        logged = []
        svc._logger = MagicMock()
        svc._logger.info = lambda event, **kw: logged.append((event, kw))

        svc.log_listing_completed(board_count=2, response_bytes=256, total_seconds=0.5)

        event, kw = logged[0]
        assert event == "board_listing_completed"
        assert kw["board_count"] == 2
        assert kw["response_bytes"] == 256
        assert kw["total_seconds"] == pytest.approx(0.5)
        assert kw["workspace"]["id"] == "test-ws"


class TestSendPromptSequence:
    """Test the prompt sequence delivery to a session's send endpoint."""

    @pytest.mark.anyio
    async def test_uses_prompt_field_matching_send_request_schema(self, tmp_path):
        """Payload must use the `prompt` key - `SendRequest` defaults other keys to a blank message."""

        svc, containers = _make_service(tmp_path)
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        failed = await svc._send_prompt_sequence(
            result,
            ["review the board", "start on {ticket}"],
            ["tickets/active/foo.md"],
        )

        assert containers.send.await_count == 2
        assert failed == []

        first_payload = containers.send.await_args_list[0].kwargs["payload"]
        second_payload = containers.send.await_args_list[1].kwargs["payload"]

        assert first_payload == {"prompt": "review the board"}
        assert second_payload == {"prompt": "start on tickets/active/foo.md"}

    @pytest.mark.anyio
    async def test_substitutes_single_ticket_placeholder(self, tmp_path):
        svc, containers = _make_service(tmp_path)
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        await svc._send_prompt_sequence(
            result,
            ["start on {ticket}"],
            ["path/to/ticket.md"],
        )

        payload = containers.send.await_args_list[0].kwargs["payload"]
        assert payload == {"prompt": "start on path/to/ticket.md"}

    @pytest.mark.anyio
    async def test_substitutes_multi_ticket_placeholder_as_newline_list(self, tmp_path):
        r"""Multiple tickets render as ``\n<p1>\n<p2>`` - first path on its own line."""

        svc, containers = _make_service(tmp_path)
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        await svc._send_prompt_sequence(
            result,
            ["start on {ticket}"],
            ["tickets/active/A.md", "tickets/active/B.md"],
        )

        payload = containers.send.await_args_list[0].kwargs["payload"]
        assert payload == {
            "prompt": "start on\ntickets/active/A.md\ntickets/active/B.md",
        }

    @pytest.mark.anyio
    async def test_swallows_send_failures_and_reports_which_messages_failed(self, tmp_path):
        """A send failure must not abort the sequence (logged warning only), and must name
        which rendered message did not arrive."""

        svc, containers = _make_service(tmp_path)
        containers.send = AsyncMock(side_effect=[RuntimeError("boom"), {}])
        result = SessionInfo(session_id="sess-1", fork_point_cost_usd=0.0, container_id="ctr-1")

        failed = await svc._send_prompt_sequence(result, ["a", "b"], ["t.md"])

        assert containers.send.await_count == 2
        assert failed == ["a"]


class TestAssign:
    """Test assign()'s per-ticket delivery-outcome reporting."""

    @staticmethod
    def _setup_board(
        tmp_path: Path,
        *,
        tickets: list[str],
    ) -> tuple[BoardService, str, MagicMock]:
        """Create a workspace with one board.yaml carrying a prompt sequence and given tickets."""

        svc, containers = _make_service(tmp_path)
        board_dir = tmp_path / "docs"
        board_dir.mkdir()
        backlog = "\n".join(f"  - path: {t}" for t in tickets)
        (board_dir / "board.yaml").write_text(
            "states:\n"
            "  - id: backlog\n"
            "    label: Backlog\n"
            "    folder: backlog/\n"
            "  - id: in-progress\n"
            "    label: In Progress\n"
            "    folder: in-progress/\n"
            "    active: true\n"
            "prompt:\n"
            "  sequence:\n"
            '    - "start on {ticket}"\n'
            "backlog:\n" + backlog + "\n"
            "in-progress: []\n",
        )
        svc._discover()

        return svc, "docs", containers

    @pytest.mark.anyio
    async def test_delivery_succeeds_unchanged(self, tmp_path):
        svc, board_id, containers = self._setup_board(tmp_path, tickets=["tickets/t1.md"])
        svc._sessions.create = AsyncMock(
            return_value=SessionInfo(
                session_id="sess-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
            ),
        )

        results = await svc.assign(board_id, ["tickets/t1.md"])

        assert results == [
            {
                "ticket_path": "tickets/t1.md",
                "session_id": "sess-1",
                "failed_prompts": [],
                "move_refused": None,
            },
        ]
        containers.send.assert_awaited_once()

    @pytest.mark.anyio
    async def test_delivery_failure_reported_without_failing_the_assignment(self, tmp_path):
        """The session still exists and the ticket is still assigned to it - only the outcome
        field shows the prompt never arrived."""

        svc, board_id, containers = self._setup_board(tmp_path, tickets=["tickets/t1.md"])
        svc._sessions.create = AsyncMock(
            return_value=SessionInfo(
                session_id="sess-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
            ),
        )
        containers.send = AsyncMock(side_effect=RuntimeError("refused"))

        results = await svc.assign(board_id, ["tickets/t1.md"])

        assert results == [
            {
                "ticket_path": "tickets/t1.md",
                "session_id": "sess-1",
                "failed_prompts": ["start on tickets/t1.md"],
                "move_refused": None,
            },
        ]

    @pytest.mark.anyio
    async def test_shared_session_failure_applies_to_every_ticket_in_the_batch(self, tmp_path):
        """parallel=False delivers one prompt sequence to one shared session - a failure there
        is not any single ticket's fault, so every ticket's own result reflects it."""

        svc, board_id, containers = self._setup_board(
            tmp_path,
            tickets=["tickets/t1.md", "tickets/t2.md"],
        )
        svc._sessions.create = AsyncMock(
            return_value=SessionInfo(
                session_id="sess-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
            ),
        )
        containers.send = AsyncMock(side_effect=RuntimeError("refused"))

        results = await svc.assign(
            board_id,
            ["tickets/t1.md", "tickets/t2.md"],
            parallel=False,
        )

        assert len(results) == 2
        assert all(r["session_id"] == "sess-1" for r in results)
        assert all(r["failed_prompts"] for r in results)


class TestAssignReopenedTicket:
    """A ticket reopened from a closed column is assigned under the path its move gives it."""

    @staticmethod
    def _setup_board(tmp_path: Path) -> tuple[BoardService, MagicMock, AsyncMock]:
        svc, containers = _make_service(tmp_path)
        board_dir = tmp_path / "docs"
        (board_dir / "completed").mkdir(parents=True)
        (board_dir / "completed" / "y-1.md").write_text("# Reopened\n")
        (board_dir / "completed" / "y-2.md").write_text("# Also reopened\n")
        (board_dir / "board.yaml").write_text(
            "states:\n"
            "  - id: in-progress\n"
            "    label: In Progress\n"
            "    folder: active/\n"
            "    active: true\n"
            "  - id: done\n"
            "    label: Done\n"
            "    folder: completed/\n"
            "    terminal: true\n"
            "prompt:\n"
            "  sequence:\n"
            '    - "start on {ticket}"\n'
            "in-progress: []\n"
            "done:\n"
            "  - path: completed/y-1.md\n"
            "  - path: completed/y-2.md\n",
        )
        svc._discover()
        create = AsyncMock(
            return_value=SessionInfo(
                session_id="sess-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
            ),
        )
        svc._sessions.create = create

        return svc, containers, create

    @pytest.mark.anyio
    async def test_the_opening_message_names_the_path_the_move_produced(self, tmp_path):
        svc, containers, _ = self._setup_board(tmp_path)

        await svc.assign("docs", ["completed/y-1.md"])

        assert (tmp_path / "docs" / "active" / "y-1.md").exists()
        assert containers.send.await_args.kwargs["payload"] == {"prompt": "start on active/y-1.md"}

    @pytest.mark.anyio
    async def test_a_shared_sessions_opening_message_names_every_moved_path(self, tmp_path):
        svc, containers, _ = self._setup_board(tmp_path)

        await svc.assign("docs", ["completed/y-1.md", "completed/y-2.md"], parallel=False)

        assert containers.send.await_args.kwargs["payload"] == {
            "prompt": "start on\nactive/y-1.md\nactive/y-2.md",
        }

    @pytest.mark.anyio
    @pytest.mark.parametrize("parallel", [True, False], ids=["one-session-each", "shared-session"])
    async def test_a_ticket_named_twice_is_assigned_once(self, tmp_path, parallel):
        svc, containers, create = self._setup_board(tmp_path)

        results = await svc.assign(
            "docs",
            ["completed/y-1.md", "completed/y-1.md"],
            parallel=parallel,
        )

        create.assert_awaited_once()
        assert [r["ticket_path"] for r in results] == ["completed/y-1.md"]
        assert containers.send.await_args.kwargs["payload"] == {"prompt": "start on active/y-1.md"}

    @pytest.mark.anyio
    @pytest.mark.parametrize("parallel", [True, False], ids=["one-session-each", "shared-session"])
    async def test_a_ticket_the_board_no_longer_holds_is_refused_before_any_session(
        self,
        tmp_path,
        parallel,
    ):
        svc, containers, create = self._setup_board(tmp_path)
        board_before = (tmp_path / "docs" / "board.yaml").read_text()

        with pytest.raises(TicketNotFound) as excinfo:
            await svc.assign("docs", ["completed/y-1.md", "active/y-2.md"], parallel=parallel)

        assert excinfo.value.context["ticket_path"] == "active/y-2.md"
        create.assert_not_awaited()
        containers.send.assert_not_awaited()
        assert (tmp_path / "docs" / "board.yaml").read_text() == board_before


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


class TestAssignMoveRefusal:
    """An assignment whose file move is refused keeps the assignment and says why."""

    @pytest.mark.anyio
    async def test_a_refused_move_keeps_the_assignment_and_reports_it(self, tmp_path):
        svc, board_id, _containers = TestAssign._setup_board(tmp_path, tickets=["backlog/t1.md"])
        (tmp_path / "docs" / "backlog").mkdir()
        (tmp_path / "docs" / "backlog" / "t1.md").write_text("mine")
        (tmp_path / "docs" / "in-progress").mkdir()
        (tmp_path / "docs" / "in-progress" / "t1.md").write_text("someone else's")
        svc._sessions.create = AsyncMock(
            return_value=SessionInfo(
                session_id="sess-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
            ),
        )
        svc._send_prompt_sequence = AsyncMock(return_value=[])

        results = await svc.assign(board_id, ["backlog/t1.md"])

        assert results[0]["session_id"] == "sess-1"
        assert results[0]["move_refused"] == "destination_exists"
        assert (tmp_path / "docs" / "backlog" / "t1.md").read_text() == "mine"
        assert (tmp_path / "docs" / "in-progress" / "t1.md").read_text() == "someone else's"
        board = (tmp_path / "docs" / "board.yaml").read_text()
        assert "session: sess-1" in board
        assert board.index("backlog/t1.md") < board.index("in-progress:")


class TestWatchedFiles:
    """The watcher is handed every board.yaml and the ticket files of each board served."""

    @staticmethod
    def _board(tmp_path: Path, name: str, tickets: list[str]) -> Path:
        board_dir = tmp_path / name
        board_dir.mkdir()

        for ticket in tickets:
            (board_dir / ticket).write_text(f"# {ticket}\n")

        entries = "".join(f"  - path: {ticket}\n" for ticket in tickets)
        (board_dir / "board.yaml").write_text(
            f"name: {name}\nstates:\n  - id: backlog\n    label: Backlog\n    folder: .\nbacklog:\n{entries}",
        )

        return board_dir

    @staticmethod
    def _owners(svc, root: Path) -> dict:
        owners = svc._watcher.sync.call_args.args[0]

        return {str(Path(path).relative_to(root)): bid for path, bid in owners.items()}

    @pytest.mark.anyio
    async def test_discover_maps_every_board_yaml_to_its_id(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        self._board(tmp_path, "alpha", [])
        self._board(tmp_path, "beta", [])

        await svc.list_all()

        assert self._owners(svc, tmp_path) == {
            "alpha/board.yaml": "alpha",
            "beta/board.yaml": "beta",
        }

    @pytest.mark.anyio
    async def test_get_hands_the_boards_ticket_files_to_the_watcher(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        self._board(tmp_path, "alpha", ["t1.md", "t2.md"])
        await svc.list_all()

        svc.get("alpha")

        assert self._owners(svc, tmp_path) == {
            "alpha/board.yaml": "alpha",
            "alpha/t1.md": "alpha",
            "alpha/t2.md": "alpha",
        }

    @pytest.mark.anyio
    async def test_a_board_removed_from_disk_loses_its_ticket_files(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        board_dir = self._board(tmp_path, "alpha", ["t1.md"])
        self._board(tmp_path, "beta", [])
        await svc.list_all()
        svc.get("alpha")

        (board_dir / "board.yaml").unlink()
        await svc.list_all()

        assert self._owners(svc, tmp_path) == {"beta/board.yaml": "beta"}
