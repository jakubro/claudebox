"""Handler for the ``logs`` verb - tail daemon log (default) or multiplex daemon + containers (``all``)."""

import argparse
import asyncio
import functools
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
Examples:
  claudebox logs                    tail daemon log, then follow
  claudebox logs daemon             same as above (explicit target)
  claudebox logs --tail 50          backfill 50 lines, then follow
  claudebox logs --tail 50 --no-follow   backfill 50 lines and exit
  claudebox logs all                multiplex daemon log + every container's stream
  claudebox logs all --no-follow    backfill across daemon + containers, then exit

Prefixes (on the `all` target):
  [daemon]            cyan prefix for daemon-log lines
  [container <id>]    magenta prefix for container lines (12-char short id)

Notes:
  Reads `~/.claudebox/logs/daemon-<port>.log`. When the daemon is not running, the
  backfill prints and the command exits without following. When the log file is
  missing entirely, `no daemon logs available` prints and the command exits 0.

  Each record occupies exactly one line: date and time, level, logger name, and any
  extra fields. Errors appear red, warnings yellow, regular lines default; colour is
  suppressed under NO_COLOR or when output is not a terminal.

  On the `all` target, containers that start later are picked up while running, and a
  short notice names each container as it starts and stops streaming.
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
# Rich treats a bare "[" as a markup tag, so every literal bracket in a source prefix is escaped.
_PREFIX_DAEMON = "[cyan]\\[daemon][/cyan]"

# Container log SSE wire contract - mirrors the frontend's schema.js vocabulary.
_SSE_DATA_PREFIX = "data:"
_SSE_COMMENT_PREFIX = ":"
_SYSTEM_FRAME = "system"
_REPLAY_ENDED = "replay_ended"

# Statuses for which the daemon can serve a container's log stream.
_LOG_SERVABLE_STATUSES = frozenset({"running"})

# Live container discovery, follow mode only.
_CONTAINER_STATUS_EVENT = "container_status"
_RECONCILE_SECONDS = 5.0
_FEED_RETRY_MIN_SECONDS = 0.5
_FEED_RETRY_MAX_SECONDS = 8.0
_FEED_HEALTHY_SECONDS = 5.0


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


def _print_log_line(text: str) -> None:
    """Emit one record with wrapping off, per call - the console also renders wrapped help/status elsewhere."""

    console.print(text, highlight=False, soft_wrap=True)


def _stream_end_message(container: dict, exc: BaseException | None) -> str:
    """Render a cause-bearing message when a container log stream ends.

    Clean EOF is a dim notice; httpx exceptions show class + message; HTTP errors add status + body's first line.
    No generic "stream ended" line is ever emitted - every line carries its own cause.
    """

    short_id = (container.get("id") or "?")[:12]

    if exc is None:
        return f"[dim]container {short_id} stream ended[/dim]"
    elif isinstance(exc, httpx.HTTPStatusError):
        body_first = ""

        if exc.response is not None:
            try:
                body_first = (exc.response.text or "").splitlines()[0][:120]
            except Exception:  # noqa: BLE001 - cosmetic preview; failure omits it
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

    if not follow or not daemon_running:
        return 0
    else:
        return _follow(log_path)


def _print_tail(log_path: Path, n: int) -> None:
    """Print the last ``n`` lines of ``log_path``, parsed and rendered through ConsoleRenderer."""

    if n <= 0:
        return

    with log_path.open("r", errors="replace") as fp:
        for line in deque(fp, maxlen=n):
            _print_log_line(_render_line(line))


def _follow(log_path: Path) -> int:
    """Tail-follow ``log_path``; exit cleanly on KeyboardInterrupt."""

    try:
        with log_path.open("r", errors="replace") as fp:
            fp.seek(0, 2)

            while True:
                line = fp.readline()

                if line:
                    _print_log_line(_render_line(line))
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

        # Containers that cannot serve logs are skipped silently - no output, no error line.
        followable = [c for c in containers if _can_serve_logs(c)]

        if args.no_follow:
            # Sequential so the per-container backfill keeps a deterministic order.
            for container in followable:
                await _stream_container(client, container, args.tail, follow=False)

            return 0

        # Follow mode: daemon-log tail alongside a supervised, self-updating follower set.
        followers = _ContainerFollowers(client, args.tail)
        followers.seed(followable)

        wake = asyncio.Event()
        tasks: list[asyncio.Task] = [
            asyncio.create_task(_follow_daemon_async(log_path)),
            asyncio.create_task(_watch_daemon_feed(client, wake)),
            asyncio.create_task(_reconcile_loop(followers, wake)),
        ]

        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        except (KeyboardInterrupt, asyncio.CancelledError):
            for task in tasks:
                task.cancel()

            await followers.cancel_all()

            return 0

    return 0


class _ContainerFollowers:
    """Supervise one log follower per container, keyed by container id."""

    def __init__(self, client: httpx.AsyncClient, tail_n: int) -> None:
        self._client = client
        self._tail_n = tail_n
        self._tasks: dict[str, asyncio.Task] = {}
        self._attached: set[str] = set()

    def seed(self, containers: list[dict]) -> None:
        """Start followers for the containers present at launch, without attach notices.

        Notices describe transitions observed while watching; what was already running is not a transition.
        """

        for container in containers:
            self._start(container, notify=False)

    async def reconcile(self) -> None:
        """Align the follower set with the daemon's current container list.

        The single attach/detach decision point - the event feed only wakes it up sooner.
        Polling can't be dropped: an adopted container is announced by nothing at all.
        `running` is silent too - the health poller flips it in place mid-sync, so the next update sees no change.
        """

        containers, _ = await _fetch_containers(self._client, quiet=True)

        if containers is None:
            return

        servable = {c["id"]: c for c in containers if c.get("id") and _can_serve_logs(c)}

        for container_id in self._attached - set(servable):
            self._stop(container_id)

        for container in servable.values():
            self._start(container, notify=True)

    async def cancel_all(self) -> None:
        """Cancel every follower and wait for them to unwind."""

        tasks = list(self._tasks.values())
        self._tasks.clear()
        self._attached.clear()

        for task in tasks:
            task.cancel()

        await asyncio.gather(*tasks, return_exceptions=True)

    def _start(self, container: dict, *, notify: bool) -> None:
        """Attach a follower to a container that is listed but not currently followed.

        A stream that ended on its own is re-opened, since a daemon restart silently kills every proxied stream.
        Re-attach suppresses the replay; only the first attach announces, so a flapping stream stays quiet.
        """

        container_id = container.get("id")

        if not container_id or container_id in self._tasks:
            return

        first_attach = container_id not in self._attached

        if notify and first_attach:
            console.print(f"[dim]container {container_id[:12]} started streaming[/dim]")

        self._attached.add(container_id)
        task = asyncio.create_task(
            _stream_container(
                self._client,
                container,
                self._tail_n if first_attach else 0,
                follow=True,
            ),
        )
        self._tasks[container_id] = task
        task.add_done_callback(functools.partial(self._forget, container_id))

    def _stop(self, container_id: str) -> None:
        """Detach a container that left the daemon's list, announcing it once.

        The notice fires whether or not a task is live; a stream already ended still counts as stopping.
        """

        self._attached.discard(container_id)
        task = self._tasks.pop(container_id, None)

        if task is not None:
            task.cancel()

        console.print(f"[dim]container {container_id[:12]} stopped[/dim]")

    def _forget(self, container_id: str, finished: asyncio.Task) -> None:
        """Drop a finished follower's task handle.

        Identity-checked: a container restarting under its old id may already have a replacement registered.
        """

        if self._tasks.get(container_id) is finished:
            del self._tasks[container_id]


async def _watch_daemon_feed(client: httpx.AsyncClient, wake: asyncio.Event) -> None:
    """Wake the reconcile loop whenever the daemon announces a container lifecycle change.

    Never returns; replays nothing missed while disconnected, so a reconnect also wakes a reconcile.
    """

    url = f"{daemon_base_url()}/api/daemon/stream"
    delay = _FEED_RETRY_MIN_SECONDS

    while True:
        opened_at = time.monotonic()

        try:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                wake.set()

                async for line in response.aiter_lines():
                    if _is_container_status(_sse_payload(line)):
                        wake.set()
        except (httpx.RequestError, httpx.HTTPStatusError):
            # Losing the feed is routine across a daemon restart; reconnect, never exit.
            pass

        # A connection that stayed up earns a reset; one that drops immediately gets hammered at the floor delay.
        if time.monotonic() - opened_at >= _FEED_HEALTHY_SECONDS:
            delay = _FEED_RETRY_MIN_SECONDS

        await asyncio.sleep(delay)
        delay = min(delay * 2, _FEED_RETRY_MAX_SECONDS)


async def _reconcile_loop(followers: "_ContainerFollowers", wake: asyncio.Event) -> None:
    """Reconcile on every feed hint, and at least every ``_RECONCILE_SECONDS`` regardless."""

    while True:
        try:
            await asyncio.wait_for(wake.wait(), timeout=_RECONCILE_SECONDS)
        except TimeoutError:
            # Periodic tick - the safety net for changes the feed never announces.
            pass

        wake.clear()
        await followers.reconcile()


def _is_container_status(payload: str | None) -> bool:
    """Whether an SSE payload is a container lifecycle frame, not a keep-alive or other event."""

    if payload is None:
        return False

    try:
        frame = json.loads(payload)
    except (json.JSONDecodeError, TypeError):
        return False

    return isinstance(frame, dict) and frame.get("type") == _CONTAINER_STATUS_EVENT


async def _fetch_containers(
    client: httpx.AsyncClient,
    *,
    quiet: bool = False,
) -> tuple[list[dict] | None, list[str]]:
    """Return (containers, warnings); containers=None when the daemon is unreachable.

    ``quiet`` suppresses the unreachable message for the reconcile poll, avoiding an error line every cycle.
    """

    workspace_ids = _list_registered_workspace_ids()

    if not workspace_ids:
        try:
            await client.get(f"{daemon_base_url()}/api/workspaces")
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            if not quiet:
                console.print(f"[red]error: daemon not reachable: {exc}[/red]")

            return None, []

        return [], []

    async def _fetch_one(ws_id: str) -> tuple[str, list[dict] | None]:
        # Decoding sits inside the guard: an escaping proxy error page kills the loop, leaving the command blind.
        try:
            resp = await client.get(f"{daemon_base_url()}/api/workspaces/{ws_id}/containers")
            resp.raise_for_status()

            return ws_id, resp.json().get("containers", [])
        except (httpx.RequestError, httpx.HTTPStatusError, ValueError):
            return ws_id, None

    results = await asyncio.gather(*(_fetch_one(ws) for ws in workspace_ids))

    if all(c is None for _, c in results):
        if not quiet:
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
            _print_log_line(f"{prefix} {_render_line(line)}")


def _container_prefix(container: dict) -> str:
    """Render ``[container <12-char-id>]`` in magenta for log prefixing."""

    short_id = (container.get("id") or "?")[:12]

    return f"[magenta]\\[container {short_id}][/magenta]"


async def _stream_container(
    client: httpx.AsyncClient,
    container: dict,
    tail_n: int,
    *,
    follow: bool,
) -> None:
    """Stream one container's logs: replayed history bounded to ``tail_n``, then live output.

    Both share one connection, split by the ``replay_ended`` frame, so failure has exactly one place and one line.
    """

    url = _container_logs_url(container)

    if url is None:
        return

    prefix = _container_prefix(container)
    history: deque[str] = deque(maxlen=max(tail_n, 0))
    replaying = True

    try:
        async with client.stream("GET", url) as response:
            if response.is_error:
                # The cause line quotes the body; the stream context closes the response on its way out.
                await response.aread()

            response.raise_for_status()

            async for line in response.aiter_lines():
                payload = _sse_payload(line)

                if payload is None:
                    continue

                subtype = _boundary_subtype(payload)

                if subtype == _REPLAY_ENDED:
                    replaying = False
                    _print_history(history, prefix)

                    if not follow:
                        return
                elif subtype is not None:
                    continue
                elif replaying:
                    history.append(payload)
                else:
                    _print_log_line(f"{prefix} {_render_line(payload)}")
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        # Partial-failure contract: surface the cause but do not abort the batch.
        _print_history(history, prefix)
        console.print(_stream_end_message(container, exc))

        return

    _print_history(history, prefix)
    console.print(_stream_end_message(container, None))


def _print_history(history: deque[str], prefix: str) -> None:
    """Print and drain the buffered replay lines, so a later flush cannot repeat them."""

    while history:
        _print_log_line(f"{prefix} {_render_line(history.popleft())}")


def _sse_payload(line: str) -> str | None:
    """Return the body of an SSE ``data:`` frame; None for comments, blanks and other fields.

    Keep-alives arrive once a second on every stream, so dropping non-data frames is load-bearing, not defensive.
    """

    if not line or line.startswith(_SSE_COMMENT_PREFIX):
        return None
    elif line.startswith(_SSE_DATA_PREFIX):
        return line[len(_SSE_DATA_PREFIX) :].lstrip()
    else:
        return None


def _boundary_subtype(payload: str) -> str | None:
    """Return the replay-boundary subtype, or None when the frame is an ordinary log record."""

    try:
        frame = json.loads(payload)
    except (json.JSONDecodeError, TypeError):
        return None

    if not isinstance(frame, dict) or frame.get("type") != _SYSTEM_FRAME:
        return None

    return frame.get("subtype")


def _can_serve_logs(container: dict) -> bool:
    """Report whether the daemon lists this container as able to serve its log stream."""

    return container.get("status") in _LOG_SERVABLE_STATUSES


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
                _print_log_line(f"{_PREFIX_DAEMON} {_render_line(line)}")
            else:
                await asyncio.sleep(_FOLLOW_POLL_SECONDS)


def _container_logs_url(container: dict) -> str | None:
    """Construct the daemon-proxied container log URL.

    Caller supplies ``/api`` atop the container's ``/api``-less base URL, the same contract the frontend follows.
    """

    workspace_id = container.get("workspace_id")
    container_id = container.get("id")

    if not workspace_id or not container_id:
        return None

    return f"{daemon_base_url()}/api/workspaces/{workspace_id}/containers/{container_id}/api/logs"
