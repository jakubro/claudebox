"""Board domain: board discovery, CRUD, ticket management, and file watching."""

from .errors import BoardNotFound, BoardParseError, SwimlaneNotFound, TicketNotFound
from .models import (
    Board,
    BoardSessionStatusEvent,
    BoardState,
    BoardSummary,
    BoardTicket,
    BoardUpdateEvent,
    Swimlane,
)
from .service import BoardService
