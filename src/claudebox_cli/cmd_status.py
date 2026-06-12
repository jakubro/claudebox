"""Handler for the ``status`` verb - three-section state: daemon, containers, workspace."""

import argparse
import asyncio
import json
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from claudebox import Config, ContainerRuntime, console
from claudebox.constants import (
    WORKSPACE_MARKER,
    daemon_base_url,
    daemon_config_path,
    global_config_dir,
)


NAME = "status"
ORDER = 70
DESCRIPTION = "Show daemon + containers + workspace state"
EPILOG = """\
examples:
  claudebox status               three rows: DAEMON, CONTAINERS, WORKSPACE

DAEMON     running/stopped, with pid + uptime when running.
CONTAINERS aggregate counts across all registered workspaces.
WORKSPACE  resolved workspace for cwd (walks up for .workspace) plus
           registration state (id, or 'not yet registered').

degraded mode: when the daemon is not running, CONTAINERS falls back to
direct runtime queries and WORKSPACE reads ~/.claudebox/daemon.json
directly. Exit code is always 0 - status is a query.
"""


_DAEMON_UNIT = "claudebox-daemon.service"
_HTTP_TIMEOUT_SECONDS = 2.0
_SUBPROCESS_TIMEOUT_SECONDS = 5


@dataclass
class _DaemonState:
    """Resolved daemon snapshot: running flag, pid, formatted uptime."""

    running: bool
    pid: int | None
    uptime: str | None


def handle(args: argparse.Namespace) -> int:  # noqa: ARG001
    """Print DAEMON / CONTAINERS / WORKSPACE rows. Always exit 0 - status is a query."""

    daemon = _resolve_daemon()
    containers = _resolve_containers(daemon)
    workspace = _resolve_workspace()

    _render_daemon(daemon)
    _render_containers(containers)
    _render_workspace(workspace)

    return 0


def _resolve_daemon() -> _DaemonState:
    """Read MainPID + ActiveEnterTimestamp from systemctl show; degrade gracefully."""

    output = _systemctl_show()

    if output is None:
        return _DaemonState(running=False, pid=None, uptime=None)

    main_pid: int | None = None
    active_enter: datetime | None = None

    for line in output.splitlines():
        key, _, value = line.partition("=")
        value = value.strip()

        if key == "MainPID":
            try:
                main_pid = int(value)
            except ValueError:
                pass
        elif key == "ActiveEnterTimestamp" and value:
            active_enter = _parse_systemctl_timestamp(value)

    running = bool(main_pid)
    uptime = _format_uptime(active_enter) if running else None

    return _DaemonState(running=running, pid=main_pid, uptime=uptime)


def _resolve_containers(daemon: _DaemonState) -> tuple[int, int]:
    """Return (running, stopped) counts - HTTP if daemon up, else direct runtime."""

    if daemon.running:
        counts = _containers_via_http()

        if counts is not None:
            return counts

    return _containers_via_runtime()


def _resolve_workspace() -> tuple[Path, str | None]:
    """Return (workspace path, registered-id) - workspace path defaults to cwd."""

    cwd = Path.cwd()
    workspace_path = cwd

    for parent in [cwd, *cwd.parents]:
        if (parent / WORKSPACE_MARKER).exists():
            workspace_path = parent
            break

    registered_id = _lookup_registered_id(workspace_path)

    return workspace_path, registered_id


def _render_daemon(state: _DaemonState) -> None:
    """Format the DAEMON row - running with pid/uptime, or not running."""

    if not state.running:
        console.print("DAEMON     not running")

        return

    pid = state.pid or 0
    uptime = state.uptime or "?"
    console.print(f"DAEMON     running   pid {pid}   uptime {uptime}")


def _render_containers(counts: tuple[int, int]) -> None:
    """Format the CONTAINERS row from (running, stopped)."""

    running, stopped = counts
    console.print(f"CONTAINERS {running} running, {stopped} stopped")


def _render_workspace(resolved: tuple[Path, str | None]) -> None:
    """Format the WORKSPACE row with ~-substitution and registration state."""

    path, registered_id = resolved
    display = _shorten_home(path)
    suffix = f"(id: {registered_id})" if registered_id else "not yet registered"
    console.print(f"WORKSPACE  {display}  {suffix}")


def _systemctl_show() -> str | None:
    """``systemctl show --user -p MainPID,ActiveEnterTimestamp claudebox-daemon.service``."""

    try:
        result = subprocess.run(
            ["systemctl", "show", "-p", "MainPID,ActiveEnterTimestamp", "--user", _DAEMON_UNIT],
            capture_output=True,
            text=True,
            check=True,
            timeout=_SUBPROCESS_TIMEOUT_SECONDS,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return None

    return result.stdout


def _parse_systemctl_timestamp(value: str) -> datetime | None:
    """Parse ``Day YYYY-MM-DD HH:MM:SS TZ`` -> tz-aware datetime."""

    tokens = value.split(maxsplit=1)

    if len(tokens) != 2:
        return None

    try:
        return datetime.strptime(tokens[1], "%Y-%m-%d %H:%M:%S %Z").replace(tzinfo=UTC)
    except ValueError:
        return None


def _format_uptime(active_enter: datetime | None) -> str | None:
    """Render ``Xh Ym`` / ``Ym`` / ``Wd Xh`` - None when timestamp is unknown."""

    if active_enter is None:
        return None

    elapsed = datetime.now(UTC) - active_enter

    if elapsed < timedelta(0):
        return None

    total_minutes = int(elapsed.total_seconds() // 60)
    days, rem = divmod(total_minutes, 60 * 24)
    hours, minutes = divmod(rem, 60)

    if days:
        return f"{days}d {hours}h"
    elif hours:
        return f"{hours}h {minutes}m"
    else:
        return f"{minutes}m"


def _containers_via_http() -> tuple[int, int] | None:
    """Query per-workspace container endpoints; degrade to None on any error."""

    try:
        return asyncio.run(_containers_via_http_async())
    except Exception:
        return None


async def _containers_via_http_async() -> tuple[int, int] | None:
    """Concurrent GETs over per-workspace `/containers`; None on total failure."""

    workspace_ids = _list_registered_workspace_ids()

    if not workspace_ids:
        return 0, 0

    async with httpx.AsyncClient(verify=False, timeout=_HTTP_TIMEOUT_SECONDS) as client:

        async def _fetch_one(ws_id: str) -> list[dict] | None:
            try:
                resp = await client.get(f"{daemon_base_url()}/api/workspaces/{ws_id}/containers")
                resp.raise_for_status()
            except (httpx.RequestError, httpx.HTTPStatusError):
                return None

            return resp.json().get("containers", [])

        results = await asyncio.gather(*(_fetch_one(ws) for ws in workspace_ids))

    if all(r is None for r in results):
        return None

    containers: list[dict] = []

    for r in results:
        if r is not None:
            containers.extend(r)

    running = sum(1 for c in containers if c.get("status") == "running")
    stopped = sum(1 for c in containers if c.get("status") != "running")

    return running, stopped


def _list_registered_workspace_ids() -> list[str]:
    """Return all registered workspace IDs from ``~/.claudebox/daemon.json``."""

    config_path = daemon_config_path()

    if not config_path.exists():
        return []

    try:
        data = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError):
        return []

    return [entry["id"] for entry in data.get("workspaces", []) if entry.get("id")]


def _containers_via_runtime() -> tuple[int, int]:
    """Direct ``ContainerRuntime.list_containers`` query; degrade to (0, 0) on any error."""

    try:
        config = Config.load()
        runtime = ContainerRuntime(config)
        containers = runtime.list_containers(labels={"app": "claudebox"})
    except Exception:
        return 0, 0

    running = sum(1 for c in containers if c.get("State") == "running")
    stopped = sum(1 for c in containers if c.get("State") != "running")

    return running, stopped


def _lookup_registered_id(workspace_path: Path) -> str | None:
    """Read ``~/.claudebox/daemon.json`` and match by absolute path. Filesystem fallback."""

    config_path = daemon_config_path()

    if not config_path.exists():
        return None

    try:
        data = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None

    target = str(workspace_path.resolve())

    for entry in data.get("workspaces", []):
        entry_path = entry.get("path")

        if entry_path and str(Path(entry_path).resolve()) == target:
            return entry.get("id")

    return None


def _shorten_home(path: Path) -> str:
    """Replace the home prefix with ``~`` for display."""

    home = global_config_dir().parent  # ~/.claudebox -> ~

    try:
        relative = path.relative_to(home)
    except ValueError:
        return str(path)

    return f"~/{relative}" if str(relative) != "." else "~"
