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
