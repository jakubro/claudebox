"""Daemon domain exceptions - typed errors with HTTP status codes."""


class DaemonError(Exception):
    """Base exception for daemon domain errors.

    Subclasses set status_code and error_key; the FastAPI handler builds the JSON response
    and merges in keyword args as context.
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


class WorkspaceUnavailable(DaemonError):
    """Workspace exists but is not available (config load failed, etc.)."""

    status_code = 503
    error_key = "workspace_unavailable"


class WorkspaceNotRegistered(DaemonError):
    """Workspace ID not present in daemon config file."""

    status_code = 404
    error_key = "workspace_not_registered"


class LockTimeout(DaemonError):
    """A FileLock acquisition exceeded its bound rather than blocking forever."""

    status_code = 423
    error_key = "lock_timeout"


class ListingTimeout(DaemonError):
    """A disk listing (boards, sessions) exceeded its bound rather than blocking forever."""

    status_code = 504
    error_key = "listing_timeout"


class ValidationError(DaemonError):
    """Required field missing or invalid in request body."""

    status_code = 400

    def __init__(self, error_key: str, **context: str) -> None:
        self.error_key = error_key
        super().__init__(**context)
