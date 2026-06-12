"""Ticket domain exceptions - typed errors with status codes for HTTP mapping."""


class TicketError(Exception):
    """Base exception for ticket domain errors.

    Mirrors ``DaemonError`` interface so daemon error handlers work transparently.
    Subclasses define ``status_code`` and ``error_key`` as class attributes.

    Attributes:
        status_code: HTTP status code for the error response.
        error_key: Machine-readable error identifier for the JSON body.
        context: Extra key-value pairs included in the error response.
    """

    status_code: int = 500
    error_key: str = "internal_error"

    def __init__(self, **context: str) -> None:
        self.context = context
        super().__init__(self.error_key)


class BoardParseError(TicketError):
    """board.yaml could not be parsed as valid YAML."""

    status_code = 422
    error_key = "board_parse_error"


class TicketNotFound(TicketError):
    """Ticket path not found in the specified board."""

    status_code = 404
    error_key = "ticket_not_found"


class SwimlaneNotFound(TicketError):
    """Swimlane ID not found in the specified board."""

    status_code = 404
    error_key = "swimlane_not_found"


class StateNotFound(TicketError):
    """State (column) ID not found in the specified board."""

    status_code = 404
    error_key = "state_not_found"


class InvalidLabel(TicketError):
    """Label value rejected - empty/whitespace-only after trimming."""

    status_code = 422
    error_key = "invalid_label"
