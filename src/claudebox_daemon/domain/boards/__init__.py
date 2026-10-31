"""Board domain: board discovery, CRUD, ticket management, and file watching."""

from __future__ import annotations

from .errors import BoardNotFound, BoardParseError, SwimlaneNotFound, TicketNotFound
from .models import (
    Board,
    BoardState,
    BoardSummary,
    BoardTicket,
    BoardUpdateEvent,
    Swimlane,
)
from .service import BoardService
