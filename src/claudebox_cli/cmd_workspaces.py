"""Handler for the ``workspaces`` noun-group — list / register / deregister."""

import argparse
import asyncio
from pathlib import Path

import httpx
from rich.table import Table

from claudebox import console
from claudebox.constants import DAEMON_PORT, WORKSPACE_MARKER, global_config_dir
from ._term import print_fail, print_info, print_ok


NAME = "workspaces"
ORDER = 120
DESCRIPTION = "Manage registered workspaces (list|register|deregister)"
EPILOG = """\
examples:
  claudebox workspaces list                  table of all registered workspaces
  claudebox workspaces register              register cwd as a workspace
  claudebox workspaces register ~/dev/bar    register a specific path
  claudebox workspaces deregister foo        remove from the daemon's registry

register creates the .workspace marker file if absent, then POSTs to the daemon.
Re-registering an already-registered path is idempotent — surfaced as
  ``○ already registered: <path> (id: <id>)``
and exits 0. Basename collisions are disambiguated by the daemon via an
8-char path-hash suffix on the id.

deregister removes the workspace from the daemon's registry. The .workspace
marker file on disk is PRESERVED — only the daemon-side registration is
removed.

bare ``claudebox workspaces`` prints this list and exits non-zero.
"""


def register(parser: argparse.ArgumentParser) -> None:
    """Add list/register/deregister nested actions."""

    actions = parser.add_subparsers(dest="action", metavar="<action>")
    actions.add_parser("list", help="Enumerate registered workspaces")
    register_action = actions.add_parser(
        "register",
        help="Register a workspace (defaults to cwd); creates .workspace marker if missing",
    )
    register_action.add_argument(
        "path",
        nargs="?",
        default=None,
        help="Workspace path (defaults to cwd)",
    )
    deregister_action = actions.add_parser(
        "deregister",
        help="Remove a workspace from the daemon's registry (.workspace marker preserved)",
    )
    deregister_action.add_argument("id", help="Workspace id to deregister")


_DAEMON_URL = f"https://localhost:{DAEMON_PORT}"
_HTTP_TIMEOUT = httpx.Timeout(10.0)


def handle(args: argparse.Namespace) -> int:
    """Dispatch on ``action``; bare invocation → sub-help + exit 2."""

    action = getattr(args, "action", None)
    if action is None:
        _print_subhelp()
        return 2

    return asyncio.run(_run(action, args))


def _print_subhelp() -> None:
    """Print the workspaces noun-group help text (literal brackets via plain print)."""

    print("usage: claudebox workspaces <action> [args]")
    print("")
    print("actions:")
    print("  list                       Enumerate registered workspaces")
    print("  register [<path>]          Register a workspace (defaults to cwd)")
    print("  deregister <id>            Remove a workspace from the daemon's registry")


async def _run(action: str, args: argparse.Namespace) -> int:
    """Async dispatch under a single httpx client for all three actions."""

    async with httpx.AsyncClient(verify=False, timeout=_HTTP_TIMEOUT) as client:
        if action == "list":
            return await _list_(client)
        if action == "register":
            return await _register(client, args)
        if action == "deregister":
            return await _deregister(client, args)
        raise ValueError(f"unhandled workspaces action: {action!r}")


async def _list_(client: httpx.AsyncClient) -> int:
    """Fetch GET /api/workspaces and render a rich table."""

    try:
        response = await client.get(f"{_DAEMON_URL}/api/workspaces")
        response.raise_for_status()
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        console.print(f"[red]error: daemon not reachable: {exc}[/red]")
        return 1

    data = response.json()
    workspaces = data.get("workspaces", [])

    table = Table(header_style="bold")
    table.add_column("ID")
    table.add_column("PATH")
    table.add_column("CONTAINERS")

    for ws in workspaces:
        path = _shorten_home(Path(ws.get("path") or "?"))
        counts = ws.get("containers") or {}
        running = counts.get("running", 0)
        stopped = counts.get("stopped", 0)
        table.add_row(
            ws.get("id") or "?",
            path,
            f"{running} running, {stopped} stopped",
        )

    console.print(table)
    return 0


async def _register(client: httpx.AsyncClient, args: argparse.Namespace) -> int:
    """Resolve target path, create .workspace marker, POST /api/workspaces."""

    raw_path = getattr(args, "path", None)
    target = Path(raw_path).expanduser().resolve() if raw_path else Path.cwd()

    # Marker creation is filesystem-side and happens unconditionally before the POST.
    marker = target / WORKSPACE_MARKER
    if not marker.exists():
        try:
            marker.touch()
        except OSError as exc:
            print_fail(f"failed to create .workspace marker at {marker}: {exc}")
            return 1

    # Pre-check idempotency: look up by absolute path.
    existing_id = await _lookup_by_path(client, target)
    if existing_id is not None:
        print_info(f"already registered: {_shorten_home(target)} (id: {existing_id})")
        return 0

    # Daemon call.
    try:
        response = await client.post(
            f"{_DAEMON_URL}/api/workspaces",
            json={"path": str(target)},
        )
        response.raise_for_status()
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        console.print(f"[red]error: daemon not reachable: {exc}[/red]")
        console.print("(suggest: claudebox daemon start)")
        return 1

    data = response.json()
    print_ok(f"registered {_shorten_home(target)} (id: {data.get('id', '?')})")
    return 0


async def _deregister(client: httpx.AsyncClient, args: argparse.Namespace) -> int:
    """DELETE /api/workspaces/{id}; surface 404 as a clean error. .workspace marker preserved."""

    workspace_id = getattr(args, "id", None)
    if not workspace_id:
        console.print("[red]error: 'workspaces deregister' requires <id>[/red]")
        return 2

    try:
        response = await client.delete(f"{_DAEMON_URL}/api/workspaces/{workspace_id}")
    except httpx.RequestError as exc:
        console.print(f"[red]error: daemon not reachable: {exc}[/red]")
        return 1

    if response.status_code == 404:
        console.print(f'error: workspace "{workspace_id}" not registered')
        return 1

    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        console.print(f"[red]error: daemon returned {response.status_code}: {exc}[/red]")
        return 1

    print_ok(f"deregistered {workspace_id}")
    return 0


async def _lookup_by_path(client: httpx.AsyncClient, target: Path) -> str | None:
    """Return the existing workspace id for ``target`` (resolved abs path), or None."""

    try:
        response = await client.get(f"{_DAEMON_URL}/api/workspaces")
        response.raise_for_status()
    except (httpx.RequestError, httpx.HTTPStatusError):
        return None

    resolved = str(target)
    for ws in response.json().get("workspaces", []):
        entry_path = ws.get("path")
        if entry_path and str(Path(entry_path).resolve()) == resolved:
            return ws.get("id")
    return None


def _shorten_home(path: Path) -> str:
    """Render ``~/relative`` form when path is under HOME, else the absolute string."""

    home = global_config_dir().parent  # ~/.claudebox → ~
    try:
        relative = path.relative_to(home)
    except ValueError:
        return str(path)
    return f"~/{relative}" if str(relative) != "." else "~"
