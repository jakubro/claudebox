"""Ports domain exceptions."""

from __future__ import annotations

from ..errors import DaemonError


class PortRequestRefused(DaemonError):
    """A port answered for a session that cannot open one - spawned, a reply thread, or unknown."""

    status_code = 409
    error_key = "port_request_refused"


class PortSessionNotRunning(DaemonError):
    """A port approved for a session with no running container to reach it in."""

    status_code = 409
    error_key = "port_session_not_running"


class PortTunnelMissing(DaemonError):
    """A port approved for a session whose container was started before it had a tunnel."""

    status_code = 409
    error_key = "port_tunnel_missing"


class PortNotOpen(DaemonError):
    """A close named a port the session never opened."""

    status_code = 404
    error_key = "port_not_open"
