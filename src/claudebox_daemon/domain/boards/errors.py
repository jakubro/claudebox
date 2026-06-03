"""Board domain exceptions — daemon-specific and re-exported from extension."""

from claudebox.extensions.tickets import (  # noqa: F401
    BoardParseError,
    InvalidLabel,
    StateNotFound,
    SwimlaneNotFound,
    TicketNotFound,
)
from ..errors import DaemonError


class BoardNotFound(DaemonError):
    """Board ID does not match any discovered board.yaml."""

    status_code = 404
    error_key = "board_not_found"
