"""Handler for the ``daemon`` noun-group - wrap systemctl --user lifecycle commands."""

import argparse
import subprocess
from datetime import UTC, datetime, timedelta

from claudebox import console
from ._term import print_ok


NAME = "daemon"
ORDER = 100
DESCRIPTION = "Manage host daemon (start|stop|restart|status)"
EPILOG = """\
examples:
  claudebox daemon start         start the host daemon
  claudebox daemon stop          stop the host daemon
  claudebox daemon restart       atomic restart (no-downtime when possible)
  claudebox daemon status        one-line state with pid + uptime

actions are systemd --user wrappers around `claudebox-daemon.service`.
Bare `claudebox daemon` prints this list and exits non-zero.
"""

_ACTIONS = (
    ("start", "Start the host daemon"),
    ("stop", "Stop the host daemon"),
    ("restart", "Restart the host daemon"),
    ("status", "Show daemon state"),
)


def register(parser: argparse.ArgumentParser) -> None:
    """Add start/stop/restart/status nested actions."""

    actions = parser.add_subparsers(dest="action", metavar="<action>")

    for action_name, action_help in _ACTIONS:
        actions.add_parser(action_name, help=action_help)


_UNIT = "claudebox-daemon.service"
_SUBPROCESS_TIMEOUT_SECONDS = 10


def handle(args: argparse.Namespace) -> int:
    """Dispatch to start / stop / restart / status; bare invocation -> sub-help + exit 2."""

    action = getattr(args, "action", None)

    if action is None:
        _print_subhelp()

        return 2

    dispatch = {
        "start": _start,
        "stop": _stop,
        "restart": _restart,
        "status": _status,
    }

    return dispatch[action]()


def _print_subhelp() -> None:
    """Print the daemon noun-group help text and exit 2 (caller handles exit)."""

    console.print("usage: claudebox daemon <action>")
    console.print("")
    console.print("actions:")
    console.print("  start      Start the host daemon")
    console.print("  stop       Stop the host daemon")
    console.print("  restart    Restart the host daemon")
    console.print("  status     Show daemon state")


def _start() -> int:
    """Start the daemon via ``systemctl --user start``."""

    if not _systemctl("start"):
        return 1

    print_ok("daemon started")

    return 0


def _stop() -> int:
    """Stop the daemon via ``systemctl --user stop``."""

    if not _systemctl("stop"):
        return 1

    print_ok("daemon stopped")

    return 0


def _restart() -> int:
    """Restart the daemon via ``systemctl --user restart`` (atomic)."""

    if not _systemctl("restart"):
        return 1

    print_ok("daemon restarted")

    return 0


def _status() -> int:
    """Render the one-line status from ``systemctl show`` output."""

    main_pid, active_enter = _systemctl_show()

    if main_pid is None or main_pid == 0:
        console.print("claudebox-daemon: not running")

        return 0

    uptime = _format_uptime(active_enter)
    suffix = f", uptime {uptime}" if uptime else ""
    console.print(f"claudebox-daemon: running (pid {main_pid}{suffix})")

    return 0


def _systemctl(action: str) -> bool:
    """Run ``systemctl --user <action> <unit>``; return True on exit 0."""

    try:
        subprocess.run(
            ["systemctl", "--user", action, _UNIT],
            check=True,
            timeout=_SUBPROCESS_TIMEOUT_SECONDS,
        )
    except (subprocess.SubprocessError, FileNotFoundError) as exc:
        console.print(f"[red]error: systemctl {action} failed: {exc}[/red]")

        return False

    return True


def _systemctl_show() -> tuple[int | None, datetime | None]:
    """Return (MainPID, ActiveEnterTimestamp) from ``systemctl show``."""

    try:
        result = subprocess.run(
            ["systemctl", "show", "-p", "MainPID,ActiveEnterTimestamp", "--user", _UNIT],
            capture_output=True,
            text=True,
            check=True,
            timeout=_SUBPROCESS_TIMEOUT_SECONDS,
        )
    except (subprocess.SubprocessError, FileNotFoundError):
        return None, None

    main_pid: int | None = None
    active_enter: datetime | None = None

    for line in result.stdout.splitlines():
        key, _, value = line.partition("=")
        value = value.strip()

        if key == "MainPID":
            try:
                main_pid = int(value)
            except ValueError:
                main_pid = None
        elif key == "ActiveEnterTimestamp" and value:
            active_enter = _parse_systemctl_timestamp(value)

    return main_pid, active_enter


def _parse_systemctl_timestamp(value: str) -> datetime | None:
    """Parse ``Mon 2026-05-14 18:00:00 UTC`` -> tz-aware datetime, or None on failure."""

    # Strip the day-of-week prefix; what remains is "YYYY-MM-DD HH:MM:SS <TZ>".
    tokens = value.split(maxsplit=1)

    if len(tokens) != 2:
        return None

    remainder = tokens[1]

    try:
        # systemctl prints UTC by default; honour explicit TZ tokens later if needed.
        return datetime.strptime(remainder, "%Y-%m-%d %H:%M:%S %Z").replace(tzinfo=UTC)
    except ValueError:
        return None


def _format_uptime(active_enter: datetime | None) -> str | None:
    """Render uptime as ``Xh Ym`` (or ``Ym`` / ``Ws Xd``) - returns None if unknown."""

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
