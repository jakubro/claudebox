"""Session domain exceptions."""

from ..errors import DaemonError


class SessionNotFound(DaemonError):
    """Session ID does not exist on workspace disk."""

    status_code = 404
    error_key = "session_not_found"
