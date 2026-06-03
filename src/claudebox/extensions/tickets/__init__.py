"""Ticket/board domain — pure parsing, models, and error types."""

from .errors import (
    BoardParseError,
    InvalidLabel,
    StateNotFound,
    SwimlaneNotFound,
    TicketError,
    TicketNotFound,
)
from .models import Board, BoardState, BoardSummary, BoardTicket, Swimlane
from .parser import (
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
