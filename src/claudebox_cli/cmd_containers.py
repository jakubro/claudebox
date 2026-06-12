"""Handler for the ``containers`` noun-group - list / stop / kill across workspaces."""

import argparse
import asyncio
import json
from datetime import UTC, datetime

import httpx
from rich.table import Table

from claudebox import console
from claudebox.constants import daemon_base_url, daemon_config_path
from ._term import print_fail, print_ok


NAME = "containers"
ORDER = 110
DESCRIPTION = "Manage containers (list|stop|kill)"
EPILOG = """\
examples:
  claudebox containers list                  table across all workspaces
  claudebox containers stop abc123456789     SIGTERM by full id
  claudebox containers stop abc1             SIGTERM by unique prefix
  claudebox containers kill abc1             SIGKILL immediately
  claudebox containers stop all              graceful stop every running container
  claudebox containers kill all              hard-kill every running container

prefix resolution is CLI-side: an ambiguous prefix surfaces the matching rows
in containers-list format and exits non-zero. ``all`` filters to running
containers labeled app=claudebox and fans out via async POSTs (partial
failures reported per-container, command exits non-zero if any failed).
"""


def register(parser: argparse.ArgumentParser) -> None:
    """Add list/stop/kill nested actions."""

    actions = parser.add_subparsers(dest="action", metavar="<action>")
    actions.add_parser("list", help="Enumerate all containers across all workspaces")
    stop_action = actions.add_parser(
        "stop",
        help="SIGTERM a container (10s grace) - accepts <id>, prefix, or all",
    )
    stop_action.add_argument("target", help="container id, unique prefix, or 'all'")
    kill_action = actions.add_parser(
        "kill",
        help="SIGKILL a container immediately - accepts <id>, prefix, or all",
    )
    kill_action.add_argument("target", help="container id, unique prefix, or 'all'")


_HTTP_TIMEOUT = httpx.Timeout(10.0)


def handle(args: argparse.Namespace) -> int:
    """Dispatch on ``action``; bare invocation -> sub-help + exit 2."""

    action = getattr(args, "action", None)

    if action is None:
        _print_subhelp()

        return 2

    return asyncio.run(_run(action, args))


def _print_subhelp() -> None:
    """Print the containers noun-group help text - caller returns exit 2.

    Uses plain ``print`` so that literal ``[id]``/``[args]`` braces survive
    Rich's markup parsing.
    """

    print("usage: claudebox containers <action> [args]")
    print("")
    print("actions:")
    print("  list                       Enumerate all containers")
    print("  stop {<id>|all}            SIGTERM, container exits + auto-removed")
    print("  kill {<id>|all}            SIGKILL, container exits + auto-removed")


async def _run(action: str, args: argparse.Namespace) -> int:
    """Async dispatch under a single httpx.AsyncClient for all actions."""

    async with httpx.AsyncClient(verify=False, timeout=_HTTP_TIMEOUT) as client:
        containers, daemon_down = await _fetch_all(client)

        if daemon_down:
            return 1

        if action == "list":
            _render_list(containers)

            return 0

        target = getattr(args, "target", None)

        if not target:
            console.print(f"[red]error: 'containers {action}' requires <id> or 'all'[/red]")

            return 2
        elif target == "all":
            return await _stop_all(client, containers, action)
        else:
            return await _stop_one_by_prefix(client, containers, action, target)


async def _fetch_all(client: httpx.AsyncClient) -> tuple[list[dict], bool]:
    """Return (containers, daemon_down=True if daemon unreachable)."""

    workspace_ids = _list_registered_workspace_ids()

    if not workspace_ids:
        try:
            await client.get(f"{daemon_base_url()}/api/workspaces")
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            console.print(f"[red]error: daemon not reachable: {exc}[/red]")

            return [], True

        return [], False

    async def _fetch_one(ws_id: str) -> tuple[str, list[dict] | None]:
        try:
            response = await client.get(f"{daemon_base_url()}/api/workspaces/{ws_id}/containers")
            response.raise_for_status()
        except (httpx.RequestError, httpx.HTTPStatusError):
            return ws_id, None

        return ws_id, response.json().get("containers", [])

    results = await asyncio.gather(*(_fetch_one(ws) for ws in workspace_ids))

    if all(containers is None for _, containers in results):
        console.print("[red]error: daemon not reachable[/red]")

        return [], True

    containers: list[dict] = []

    for ws_id, ws_containers in results:
        if ws_containers is None:
            console.print(f"[yellow]warning: workspace {ws_id} unreachable[/yellow]")
            continue

        for c in ws_containers:
            c["workspace_id"] = ws_id
            containers.append(c)

    return containers, False


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


def _render_list(containers: list[dict]) -> None:
    """Render the ``containers list`` table - 12-char short IDs, ~-shortened paths."""

    table = Table(header_style="bold")
    table.add_column("ID")
    table.add_column("WORKSPACE")
    table.add_column("STATE")
    table.add_column("KIND")
    table.add_column("AGE")

    for c in containers:
        full_id = c.get("id") or "?"
        short_id = full_id[:12]
        workspace = _shorten_workspace(c.get("workspace_id"))
        state = c.get("status") or "?"
        kind = (c.get("labels") or {}).get("kind") or ""
        age = _format_age(c.get("created_at"))
        table.add_row(short_id, workspace, state, kind, age)

    console.print(table)


async def _stop_one_by_prefix(
    client: httpx.AsyncClient,
    containers: list[dict],
    action: str,
    prefix: str,
) -> int:
    """Resolve ``prefix`` against the aggregator response and signal the unique match."""

    matches = [c for c in containers if (c.get("id") or "").startswith(prefix)]

    if not matches:
        console.print(f'error: no container matches "{prefix}"')

        return 1

    if len(matches) > 1:
        console.print(f'error: prefix "{prefix}" is ambiguous; matches:')
        _render_list(matches)

        return 1

    container = matches[0]
    success = await _signal_container(client, container, action)

    if success:
        verb = {"stop": "stopped", "kill": "killed"}[action]
        print_ok(f"{verb} {container.get('id')}")

        return 0

    return 1


async def _stop_all(
    client: httpx.AsyncClient,
    containers: list[dict],
    action: str,
) -> int:
    """Filter to running containers and fan out via asyncio.gather (per GUIDELINES §2)."""

    running = [c for c in containers if c.get("status") == "running"]

    if not running:
        console.print(f"nothing to {action} (0 running containers)")

        return 0

    results = await asyncio.gather(*(_signal_container(client, c, action) for c in running))

    verb_ok = {"stop": "stopped", "kill": "killed"}[action]
    verb_fail = {"stop": "stop", "kill": "kill"}[action]

    any_failed = False

    for container, success in zip(running, results, strict=True):
        if success:
            print_ok(f"{verb_ok} {container.get('id')}")
        else:
            print_fail(f"failed to {verb_fail} {container.get('id')}")
            any_failed = True

    return 1 if any_failed else 0


async def _signal_container(
    client: httpx.AsyncClient,
    container: dict,
    action: str,
) -> bool:
    """POST the workspace-scoped ``stop`` or ``kill`` route; return True on success."""

    workspace_id = container.get("workspace_id")
    container_id = container.get("id")

    if not workspace_id or not container_id:
        return False

    url = f"{daemon_base_url()}/api/workspaces/{workspace_id}/containers/{container_id}/{action}"

    try:
        response = await client.post(url)
        response.raise_for_status()
    except (httpx.RequestError, httpx.HTTPStatusError):
        return False

    return True


def _shorten_workspace(workspace_id: str | None) -> str:
    """Display the workspace id (the daemon stores a slug already)."""

    return workspace_id or "?"


def _format_age(created_at: str | None) -> str:
    """Render a coarse age string from an ISO-8601 created_at; ``?`` on parse failure."""

    if not created_at:
        return "?"

    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return "?"

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)

    elapsed = datetime.now(UTC) - dt
    total_seconds = int(elapsed.total_seconds())

    if total_seconds < 60:
        return f"{total_seconds}s"

    minutes, _ = divmod(total_seconds, 60)

    if minutes < 60:
        return f"{minutes}m"

    hours, minutes = divmod(minutes, 60)

    if hours < 48:
        return f"{hours}h {minutes}m"

    days, hours = divmod(hours, 24)

    return f"{days}d {hours}h"
