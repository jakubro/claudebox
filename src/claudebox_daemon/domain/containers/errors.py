"""Container-specific domain errors."""

from __future__ import annotations

from ..errors import DaemonError


class ContainerNotFound(DaemonError):
    """Container ID not in the workspace registry."""

    status_code = 404
    error_key = "container_not_found"


class ContainerUnavailable(DaemonError):
    """Container is not reachable (connection refused)."""

    status_code = 502
    error_key = "container_unavailable"


class BundleNotDeclared(DaemonError):
    """A session names a bundle the workspace's settings no longer declare."""

    status_code = 409
    error_key = "bundle_not_declared"


class ContainerTmpMountConflict(DaemonError):
    """The workspace or a mount lives under /tmp, which a session start would delete."""

    status_code = 409
    error_key = "container_tmp_mount_conflict"


class NetworkModeUnsupported(DaemonError):
    """The network mode a session would start under discards the publish the daemon reaches it on."""

    status_code = 409
    error_key = "network_mode_unsupported"


class ContainerTimeout(DaemonError):
    """Container request timed out."""

    status_code = 504
    error_key = "container_timeout"
