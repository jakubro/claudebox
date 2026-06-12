"""Board service - board CRUD, ticket move, assign, archive."""

import re
from pathlib import Path
from typing import TYPE_CHECKING

from claudebox import Broadcaster, find_files, get_logger
from claudebox.extensions.tickets import (
    add_swimlane,
    archive_ticket,
    assign_ticket,
    board_id_from_path,
    board_summary,
    delete_swimlane,
    move_ticket,
    parse_board,
    rename_board,
    rename_state,
    rename_swimlane,
    reorder_states,
    reorder_swimlanes,
)
from .errors import BoardNotFound, TicketNotFound
from .models import Board, BoardState, BoardSummary, BoardUpdateEvent, Swimlane
from .watcher import BoardWatcher
from ...constants import BOARD_FILENAME


if TYPE_CHECKING:
    from ..containers import ContainerService
    from ..sessions import SessionService
    from ..workspaces import RegisteredWorkspace


class BoardService:
    """Manage boards within a single workspace.

    Discovers board.yaml files, provides CRUD operations on tickets and swimlanes,
    and orchestrates session assignment for tickets.

    Attributes:
        _workspace: The registered workspace this service is scoped to.
        _events: Broadcaster for publishing board events.
        _sessions: Session service for creating sessions during assignment.
        _watcher: File watcher for board.yaml changes.
        _boards: Cached map of board_id -> yaml_path for discovered boards.
    """

    def __init__(
        self,
        workspace: "RegisteredWorkspace",
        sessions: "SessionService",
        containers: "ContainerService",
        events: Broadcaster,
    ) -> None:
        self._logger = get_logger(__name__)

        self._workspace = workspace
        self._sessions = sessions
        self._containers = containers
        self._events = events

        self._watcher = BoardWatcher(
            workspace_id=workspace.id,
            workspace_root=Path(workspace.path),
            events=events,
        )

        self._boards: dict[str, Path] = {}

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Discover boards and start file watcher."""

        self._logger.debug("Starting board service...", **self._log_context)

        self._discover()
        await self._watcher.start()

        self._logger.info("Board service started", **self._log_context)

    async def stop(self) -> None:
        """Stop file watcher."""

        self._logger.debug("Stopping board service...", **self._log_context)

        await self._watcher.stop()

        self._logger.info("Board service stopped", **self._log_context)

    # Board Discovery
    # ----------------------------------------------------------------------------------------------

    def list_all(self) -> list[BoardSummary]:
        """List all discovered boards in the workspace."""

        self._discover()
        root = Path(self._workspace.path)

        return [board_summary(path, root) for path in self._boards.values()]

    def get(self, board_id: str) -> Board:
        """Get full board state by ID.

        Raises BoardNotFound if board_id doesn't match a discovered board.
        """

        yaml_path = self._resolve(board_id)
        root = Path(self._workspace.path)

        return parse_board(yaml_path, root)

    # Ticket Operations
    # ----------------------------------------------------------------------------------------------

    def rename(self, board_id: str, name: str) -> BoardSummary:
        """Rename a board by setting the name: field in its board.yaml."""

        yaml_path = self._resolve(board_id)
        rename_board(yaml_path, name)
        root = Path(self._workspace.path)

        return board_summary(yaml_path, root)

    def read_ticket_content(self, board_id: str, ticket_path: str) -> str:
        """Read raw markdown content of a ticket file."""

        yaml_path = self._resolve(board_id)
        board_dir = yaml_path.parent.resolve()
        root = Path(self._workspace.path).resolve()
        # ticket_path resolves relative to board.yaml's parent; the is_relative_to
        # guard rejects relative segments that escape workspace root.
        abs_path = (board_dir / ticket_path).resolve()

        if not abs_path.is_relative_to(root):
            raise TicketNotFound(board_id=board_id, ticket_path=ticket_path)

        try:
            return abs_path.read_text()
        except FileNotFoundError as exc:
            raise TicketNotFound(board_id=board_id, ticket_path=ticket_path) from exc

    def move(
        self,
        board_id: str,
        ticket_path: str,
        *,
        column: str | None = None,
        swimlane: str | None = None,
        index: int | None = None,
    ) -> dict:
        """Move a ticket between columns and/or swimlanes, optionally at a specific index."""

        yaml_path = self._resolve(board_id)

        return move_ticket(yaml_path, ticket_path, column=column, swimlane=swimlane, index=index)

    def archive(self, board_id: str, ticket_path: str) -> None:
        """Archive a ticket - remove from YAML, file stays on disk."""

        yaml_path = self._resolve(board_id)
        archive_ticket(yaml_path, ticket_path)

    async def assign(
        self,
        board_id: str,
        ticket_paths: list[str],
        *,
        parallel: bool = True,
    ) -> list[dict]:
        """Assign tickets to new sessions, returning {ticket_path, session_id} mappings."""

        yaml_path = self._resolve(board_id)
        root = Path(self._workspace.path)
        board = parse_board(yaml_path, root)
        prompt_sequence = board.prompt.get("sequence") or []

        # Find the active state for auto-move on assign
        active_state = next((s for s in board.states if s.active), None)

        results = []

        # parallel=True: one session per ticket. parallel=False: one shared session for all.
        if parallel:
            for ticket_path in ticket_paths:
                result = await self._sessions.create()
                assign_ticket(yaml_path, ticket_path, result.session_id)

                if active_state:
                    move_ticket(yaml_path, ticket_path, column=active_state.id)

                # Send prompt sequence to the new session
                await self._send_prompt_sequence(result, prompt_sequence, [ticket_path])

                results.append({"ticket_path": ticket_path, "session_id": result.session_id})
        else:
            # Shared: one session for all tickets.
            result = await self._sessions.create()

            for ticket_path in ticket_paths:
                assign_ticket(yaml_path, ticket_path, result.session_id)

                if active_state:
                    move_ticket(yaml_path, ticket_path, column=active_state.id)

            await self._send_prompt_sequence(result, prompt_sequence, ticket_paths)

            for ticket_path in ticket_paths:
                results.append({"ticket_path": ticket_path, "session_id": result.session_id})

        await self._broadcast_update(board_id)

        return results

    # Swimlane Operations
    # ----------------------------------------------------------------------------------------------

    def create_swimlane(self, board_id: str, name: str) -> Swimlane:
        """Create a new swimlane."""

        yaml_path = self._resolve(board_id)

        return add_swimlane(yaml_path, name)

    def update_swimlane(self, board_id: str, swimlane_id: str, name: str) -> Swimlane:
        """Rename an existing swimlane."""

        yaml_path = self._resolve(board_id)

        return rename_swimlane(yaml_path, swimlane_id, name)

    def remove_swimlane(self, board_id: str, swimlane_id: str) -> None:
        """Delete a swimlane. Tickets in it become unsorted."""

        yaml_path = self._resolve(board_id)
        delete_swimlane(yaml_path, swimlane_id)

    def reorder(self, board_id: str, ids: list[str]) -> list[Swimlane]:
        """Reorder swimlanes to match the given ID list."""

        yaml_path = self._resolve(board_id)

        return reorder_swimlanes(yaml_path, ids)

    def reorder_columns(self, board_id: str, keys: list[str]) -> list[BoardState]:
        """Reorder columns/states to match the given key list."""

        yaml_path = self._resolve(board_id)

        return reorder_states(yaml_path, keys)

    async def rename_state(self, board_id: str, state_id: str, label: str) -> BoardState:
        """Update the display label of a state (column). Folder name unchanged."""

        yaml_path = self._resolve(board_id)
        state = rename_state(yaml_path, state_id, label)
        await self._broadcast_update(board_id)

        return state

    # Internal
    # ----------------------------------------------------------------------------------------------

    def _discover(self) -> None:
        """Scan workspace for board.yaml files and update the cache."""

        root = Path(self._workspace.path)
        found: dict[str, Path] = {}

        for yaml_path in find_files(root, BOARD_FILENAME):
            bid = board_id_from_path(yaml_path, root)
            found[bid] = yaml_path

        self._boards = found
        self._watcher.sync_watches(list(found.values()))

    def _resolve(self, board_id: str) -> Path:
        """Resolve board_id to its yaml_path, raising BoardNotFound if missing."""

        if board_id not in self._boards:
            self._discover()

        if board_id not in self._boards:
            raise BoardNotFound(board_id=board_id)

        return self._boards[board_id]

    async def _send_prompt_sequence(
        self,
        session_result,
        prompt_sequence,
        ticket_paths: list[str],
    ) -> None:
        """Send prompt sequence messages to a newly created session, expanding ``{ticket}``."""

        single = len(ticket_paths) == 1

        for template in prompt_sequence:
            if single:
                # Single ticket: substituted as the path, preserving the
                # original ``/implement <path>`` shape.
                message = template.replace("{ticket}", ticket_paths[0])
            else:
                # Multi-ticket: newline-prefixed list (``/implement\n<p1>\n<p2>``),
                # matching how a human would batch-list tickets. Strip whitespace
                # before ``{ticket}`` so the list starts on its own line.
                ticket_ref = "\n" + "\n".join(ticket_paths)
                message = re.sub(r"[ \t]*\{ticket\}", ticket_ref, template)

            try:
                await self._containers.send(
                    container_id=session_result.container_id,
                    method="POST",
                    endpoint="api/send",
                    payload={"prompt": message},
                )
            except Exception:
                self._logger.warning(
                    "Failed to send prompt message",
                    message=message,
                    session_id=session_result.session_id,
                    **self._log_context,
                )

    async def _broadcast_update(self, board_id: str) -> None:
        """Broadcast that a board has been updated."""

        await self._events.broadcast(
            BoardUpdateEvent(
                workspace_id=self._workspace.id,
                board_id=board_id,
            ),
        )

    @property
    def _log_context(self) -> dict:
        return {
            "workspace": {"id": self._workspace.id, "path": self._workspace.path},
        }
