"""Daemon domain exceptions - typed errors with HTTP status codes."""


class DaemonError(Exception):
    """Base exception for daemon domain errors.

    Subclasses define status_code and error_key as class attributes.
    The centralized FastAPI handler reads these to build JSON responses.
    Keyword arguments become context merged into the JSON body.

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


class DaemonNotReady(DaemonError):
    """Daemon context not yet initialized."""

    status_code = 503
    error_key = "daemon_not_ready"


class WorkspaceNotFound(DaemonError):
    """Workspace ID not in the daemon's active workspace map."""

    status_code = 404
    error_key = "workspace_not_found"


class WorkspaceUnavailable(DaemonError):
    """Workspace exists but is not available (config load failed, etc.)."""

    status_code = 503
    error_key = "workspace_unavailable"


class WorkspaceNotRegistered(DaemonError):
    """Workspace ID not present in daemon config file."""

    status_code = 404
    error_key = "workspace_not_registered"


class ValidationError(DaemonError):
    """Required field missing or invalid in request body."""

    status_code = 400

    def __init__(self, error_key: str, **context: str) -> None:
        self.error_key = error_key
        super().__init__(**context)
