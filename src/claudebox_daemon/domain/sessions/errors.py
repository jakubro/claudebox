"""Session domain exceptions."""

from ..errors import DaemonError


class SessionNotFound(DaemonError):
    """Session ID does not exist on workspace disk."""

    status_code = 404
    error_key = "session_not_found"


class SessionContainerUnavailable(DaemonError):
    """No running container for a session a shared-container operation needs."""

    status_code = 409
    error_key = "session_container_unavailable"
