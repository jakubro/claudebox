"""Handler for the ``logs`` verb - tail daemon log (default) or multiplex daemon + containers (``all``)."""

import argparse
import asyncio
import json
import subprocess
import sys
import time
from collections import deque
from pathlib import Path

import httpx

from claudebox import console, render_event
from claudebox.constants import DAEMON_PORT, daemon_base_url, daemon_config_path, daemon_log_dir


NAME = "logs"
ORDER = 60
DESCRIPTION = "Stream logs (daemon | all)"
EPILOG = """\
examples:
  claudebox logs                    tail daemon log, then follow
  claudebox logs daemon             same as above (explicit target)
  claudebox logs --tail 50          backfill 50 lines, then follow
  claudebox logs --tail 50 --no-follow   backfill 50 lines and exit
  claudebox logs all                multiplex daemon log + every container's stream
  claudebox logs all --no-follow    backfill across daemon + containers, then exit

prefixing on the ``all`` target:
  [daemon]            cyan prefix for daemon-log lines
  [container <id>]    magenta prefix for container lines (12-char short id)

logs reads ``~/.claudebox/logs/daemon-<port>.log``. When the daemon is not
running, the backfill prints and the command exits (no live follow).
When the log file is missing entirely, the command prints
``no daemon logs available`` and exits 0.

each record is rendered on one line with an ISO8601 date+time, the level,
the logger name, and any extra fields. Errors appear red, warnings yellow,
regular lines default (suppressed under ``NO_COLOR`` or non-TTY).
"""


def register(parser: argparse.ArgumentParser) -> None:
    """Add target, --tail, --no-follow."""

    parser.add_argument(
        "target",
        nargs="?",
        choices=["daemon", "all"],
        default="daemon",
        help="Log source (default: daemon)",
    )
    parser.add_argument(
        "--tail",
        type=int,
        default=100,
        help="Number of trailing lines to backfill before following (default: 100)",
    )
    parser.add_argument(
        "--no-follow",
        action="store_true",
        help="Print the backfilled lines and exit instead of following",
    )


_HTTP_TIMEOUT = httpx.Timeout(5.0, read=None)
_FOLLOW_POLL_SECONDS = 0.2
_PREFIX_DAEMON = "[cyan][daemon][/cyan]"


def handle(args: argparse.Namespace) -> int:
    """Dispatch on ``target``; ``all`` multiplexes daemon log + container SSE streams."""

    target = getattr(args, "target", None) or "daemon"

    if target == "all":
        return asyncio.run(_run_all(args))

    return _tail_daemon(args)


def _render_line(line: str) -> str:
    """Parse a JSON log line and render it; pass through unchanged when not JSON."""

    line = line.rstrip("\n")

    try:
        record = json.loads(line)
    except (json.JSONDecodeError, TypeError):
        return line

    if not isinstance(record, dict):
        return line

    return render_event(record).rstrip("\n")


def _stream_end_message(container: dict, exc: BaseException | None) -> str:
    """Render a cause-bearing message when a container log stream ends.

    Clean EOF reads as a dim notice; httpx exceptions surface the class name +
    underlying message; HTTP errors include status + reason from the body's
    first line. The default ``warning: container <id> stream ended`` line is
    never emitted - every stream-end line carries its cause.
    """

    short_id = (container.get("id") or "?")[:12]

    if exc is None:
        return f"[dim]container {short_id} stream ended[/dim]"
    elif isinstance(exc, httpx.HTTPStatusError):
        body_first = ""

        if exc.response is not None:
            try:
                body_first = (exc.response.text or "").splitlines()[0][:120]
            except Exception:
                body_first = ""

        suffix = f" {body_first}" if body_first else ""

        return f"[red]container {short_id}: HTTP {exc.response.status_code}{suffix}[/red]"
    else:
        return f"[red]container {short_id}: {type(exc).__name__}: {exc}[/red]"


def _tail_daemon(args: argparse.Namespace) -> int:
    """Backfill the last ``--tail N`` lines from the daemon log, optionally follow."""

    log_path = _daemon_log_path()
    tail_n = args.tail
    follow = not args.no_follow

    if not log_path.exists():
        if not daemon_config_path().exists():
            console.print("no daemon logs available")

            return 0

        console.print("no daemon logs available")

        return 0

    daemon_running = _daemon_is_running()
    _print_tail(log_path, tail_n)

    if not follow:
        return 0
    elif not daemon_running:
        return 0
    else:
        return _follow(log_path)


def _print_tail(log_path: Path, n: int) -> None:
    """Print the last ``n`` lines of ``log_path``, parsed and rendered through ConsoleRenderer."""

    if n <= 0:
        return

    with log_path.open("r", errors="replace") as fp:
        for line in deque(fp, maxlen=n):
            console.print(_render_line(line), highlight=False)


def _follow(log_path: Path) -> int:
    """Tail-follow ``log_path``; exit cleanly on KeyboardInterrupt."""

    try:
        with log_path.open("r", errors="replace") as fp:
            fp.seek(0, 2)

            while True:
                line = fp.readline()

                if line:
                    console.print(_render_line(line), highlight=False)
                else:
                    sys.stdout.flush()
                    time.sleep(_FOLLOW_POLL_SECONDS)
    except KeyboardInterrupt:
        return 0


def _daemon_log_path() -> Path:
    """Resolve ``~/.claudebox/logs/daemon-<DAEMON_PORT>.log``."""

    return daemon_log_dir() / f"daemon-{DAEMON_PORT}.log"


def _daemon_is_running() -> bool:
    """Best-effort liveness probe via systemctl --user (no HTTP roundtrip)."""

    try:
        result = subprocess.run(
            ["systemctl", "--user", "is-active", "claudebox-daemon.service"],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return False

    return result.stdout.strip() == "active"


# ``logs all`` async multiplex
# ----------------------------------------------------------------------------------------------


async def _run_all(args: argparse.Namespace) -> int:
    """Multiplex daemon log + per-container SSE into one prefixed output stream."""

    async with httpx.AsyncClient(verify=False, timeout=_HTTP_TIMEOUT) as client:
        containers, warnings = await _fetch_containers(client)

        if containers is None:
            # Daemon unreachable - surface the error and exit non-zero.
            return 1

        for warning in warnings:
            console.print(f"[yellow]warning: {warning}[/yellow]")

        # Print the daemon-log backfill first (deterministic ordering with --no-follow).
        log_path = _daemon_log_path()

        if log_path.exists():
            _print_tail_prefixed(log_path, args.tail, _PREFIX_DAEMON)

        # Per-container backfill (best-effort one-shot fetch of last N lines).
        for container in containers:
            await _print_container_backfill(client, container, args.tail)

        if args.no_follow:
            return 0

        # Follow mode: gather over daemon-log async tail + per-container SSE streams.
        tasks: list[asyncio.Task] = [asyncio.create_task(_follow_daemon_async(log_path))]

        for container in containers:
            tasks.append(asyncio.create_task(_follow_container_async(client, container)))

        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        except (KeyboardInterrupt, asyncio.CancelledError):
            for task in tasks:
                task.cancel()

            return 0

    return 0


async def _fetch_containers(
    client: httpx.AsyncClient,
) -> tuple[list[dict] | None, list[str]]:
    """Return (containers, warnings); containers=None when the daemon is unreachable."""

    workspace_ids = _list_registered_workspace_ids()

    if not workspace_ids:
        try:
            await client.get(f"{daemon_base_url()}/api/workspaces")
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            console.print(f"[red]error: daemon not reachable: {exc}[/red]")

            return None, []

        return [], []

    async def _fetch_one(ws_id: str) -> tuple[str, list[dict] | None]:
        try:
            resp = await client.get(f"{daemon_base_url()}/api/workspaces/{ws_id}/containers")
            resp.raise_for_status()
        except (httpx.RequestError, httpx.HTTPStatusError):
            return ws_id, None

        return ws_id, resp.json().get("containers", [])

    results = await asyncio.gather(*(_fetch_one(ws) for ws in workspace_ids))

    if all(c is None for _, c in results):
        console.print("[red]error: daemon not reachable[/red]")

        return None, []

    containers: list[dict] = []
    warnings: list[str] = []

    for ws_id, ws_containers in results:
        if ws_containers is None:
            warnings.append(f"workspace {ws_id} unreachable")
            continue

        for c in ws_containers:
            c["workspace_id"] = ws_id
            containers.append(c)

    return containers, warnings


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


def _print_tail_prefixed(log_path: Path, n: int, prefix: str) -> None:
    """Print the last ``n`` lines of ``log_path`` with a fixed source prefix."""

    if n <= 0:
        return

    with log_path.open("r", errors="replace") as fp:
        for line in deque(fp, maxlen=n):
            console.print(f"{prefix} {_render_line(line)}", highlight=False)


def _container_prefix(container: dict) -> str:
    """Render ``[container <12-char-id>]`` in magenta for log prefixing."""

    short_id = (container.get("id") or "?")[:12]

    return f"[magenta][container {short_id}][/magenta]"


async def _print_container_backfill(
    client: httpx.AsyncClient,
    container: dict,
    n: int,
) -> None:
    """Fetch a one-shot log snapshot from a container and print last ``n`` lines."""

    url = _container_logs_url(container)

    if url is None:
        return

    try:
        response = await client.get(url, params={"tail": n})
        response.raise_for_status()
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        # Partial-failure contract: surface the cause but do not abort the batch.
        console.print(_stream_end_message(container, exc))

        return

    prefix = _container_prefix(container)

    for line in deque(response.text.splitlines(), maxlen=n):
        console.print(f"{prefix} {_render_line(line)}", highlight=False)


async def _follow_daemon_async(log_path: Path) -> None:
    """Async tail-follow of the daemon log file (no httpx involved)."""

    if not log_path.exists():
        return

    loop = asyncio.get_running_loop()

    with log_path.open("r", errors="replace") as fp:
        fp.seek(0, 2)

        while True:
            line = await loop.run_in_executor(None, fp.readline)

            if line:
                console.print(f"{_PREFIX_DAEMON} {_render_line(line)}", highlight=False)
            else:
                await asyncio.sleep(_FOLLOW_POLL_SECONDS)


async def _follow_container_async(
    client: httpx.AsyncClient,
    container: dict,
) -> None:
    """Stream the container's ``/logs`` SSE endpoint through the daemon proxy."""

    url = _container_logs_url(container)

    if url is None:
        return

    prefix = _container_prefix(container)

    try:
        async with client.stream("GET", url, params={"follow": "true"}) as response:
            response.raise_for_status()

            async for line in response.aiter_lines():
                if line:
                    console.print(f"{prefix} {_render_line(line)}", highlight=False)
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        console.print(_stream_end_message(container, exc))

        return

    console.print(_stream_end_message(container, None))


def _container_logs_url(container: dict) -> str | None:
    """Construct the daemon-proxied container ``/logs`` URL."""

    workspace_id = container.get("workspace_id")
    container_id = container.get("id")

    if not workspace_id or not container_id:
        return None

    return f"{daemon_base_url()}/api/workspaces/{workspace_id}/containers/{container_id}/logs"
