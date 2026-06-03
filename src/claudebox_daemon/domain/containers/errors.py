"""Container-specific domain errors."""

from ..errors import DaemonError


class ContainerNotFound(DaemonError):
    """Container ID not in the workspace registry."""

    status_code = 404
    error_key = "container_not_found"


class ContainerUnavailable(DaemonError):
    """Container is not reachable (connection refused)."""

    status_code = 502
    error_key = "container_unavailable"


class ContainerTimeout(DaemonError):
    """Container request timed out."""

    status_code = 504
    error_key = "container_timeout"
