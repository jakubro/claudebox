"""Board domain models - daemon-specific events and re-exported from extension."""

from dataclasses import dataclass

from claudebox import DataClass
from claudebox.extensions.tickets import (  # noqa: F401
    Board,
    BoardState,
    BoardSummary,
    BoardTicket,
    Swimlane,
)


@dataclass
class BoardUpdateEvent(DataClass):
    """SSE event emitted when a board.yaml changes on disk.

    Attributes:
        workspace_id: Workspace containing the board.
        board_id: Identifier of the changed board.
    """

    workspace_id: str
    board_id: str
    type: str = "board_update"


@dataclass
class BoardSessionStatusEvent(DataClass):
    """SSE event emitted when an assigned session's status changes.

    Attributes:
        workspace_id: Workspace containing the board.
        board_id: Identifier of the board.
        ticket_path: Path of the ticket whose session changed.
        session_id: Session ID that changed.
        status: New session status (running, stopped).
    """

    workspace_id: str
    board_id: str
    ticket_path: str
    session_id: str
    status: str
    type: str = "board_session_status"
