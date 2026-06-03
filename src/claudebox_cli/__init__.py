"""Claudebox CLI — verb-mode subparser dispatch + per-verb handlers."""

from . import (
    cmd_build,
    cmd_containers,
    cmd_daemon,
    cmd_doctor,
    cmd_logs,
    cmd_prune,
    cmd_run,
    cmd_shell,
    cmd_status,
    cmd_update,
    cmd_version,
    cmd_workspaces,
)


__all__ = [
    "cmd_build",
    "cmd_containers",
    "cmd_daemon",
    "cmd_doctor",
    "cmd_logs",
    "cmd_prune",
    "cmd_run",
    "cmd_shell",
    "cmd_status",
    "cmd_update",
    "cmd_version",
    "cmd_workspaces",
]
