"""Inline-snapshot per verb's --help output (all 12 verbs, including stubs).

Populated via ``pytest --inline-snapshot=create``; the ``install:`` footer is normalized so text stays stable.
"""

import re

import pytest
from inline_snapshot import snapshot

from host_cli import app


parser = app.parser


_INSTALL_FOOTER = re.compile(r"^install:\n  .+$", re.MULTILINE)


_VERBS = [
    "run",
    "build",
    "update",
    "shell",
    "prune",
    "logs",
    "status",
    "doctor",
    "version",
    "daemon",
    "containers",
    "workspaces",
]


def _capture_help(verb: str | None, capsys: pytest.CaptureFixture[str]) -> str:
    """Invoke --help for the verb (or top-level if None) and capture stdout.

    Normalizes the ``install:`` footer (branch/commit/path) so snapshots stay stable across environments.
    """

    args = ["--help"] if verb is None else [verb, "--help"]

    with pytest.raises(SystemExit) as exc:
        parser.parse_args(args)

    assert exc.value.code == 0

    captured = capsys.readouterr()

    return _INSTALL_FOOTER.sub("install:\n  <branch> (<commit>) @ <path>", captured.out)


def test_top_level_help(capsys: pytest.CaptureFixture[str]) -> None:
    """Top-level --help enumerates every verb."""

    output = _capture_help(None, capsys)

    for verb in _VERBS:
        assert verb in output


class TestRunHelp:
    """``run --help`` covers REMAINDER args."""

    def test_help_mentions_agent_args(self, capsys: pytest.CaptureFixture[str]) -> None:
        output = _capture_help("run", capsys)
        assert "agent_args" in output


class TestBuildHelp:
    """``build --help`` enumerates layer choices."""

    def test_help_mentions_layer_choices(self, capsys: pytest.CaptureFixture[str]) -> None:
        output = _capture_help("build", capsys)
        assert "--layer" in output
        assert "all" in output
        assert "agent" in output


class TestSnapshots:
    """Locked-text snapshots (regenerate via ``pytest --inline-snapshot=create``)."""

    def test_top_level_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help(None, capsys) == snapshot("""\
Usage: claudebox [-h] [-v] <command> ...

Run AI coding agents in a containerized dev environment.

Positional Arguments:
  <command>
    run          Launch agent session in container
    build        Build container image
    update       Update Claudebox itself (re-runs install.sh)
    shell        Open bash shell in fresh container
    prune        Remove stopped containers, dangling images, stale dirs
    logs         Stream logs (daemon | all)
    status       Show daemon + containers + workspace state
    doctor       Diagnose environment
    version      Print version
    daemon       Manage host daemon (start|stop|restart|status)
    containers   Manage containers (list|stop|kill)
    workspaces   Manage registered workspaces (list|register|deregister)

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

run "claudebox <command> --help" for command-specific help

see also:
  https://github.com/jakubro/claudebox

install:
  <branch> (<commit>) @ <path>
""")

    def test_run_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("run", capsys) == snapshot("""\
Usage: claudebox run [-h] [-v] ...

Launch agent session in container

Positional Arguments:
  agent_args     Arguments forwarded to the agent (place after `--`)

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox run                  launch interactive agent session
  claudebox run -- --resume      resume the most recent agent conversation
  claudebox run -- -p "prompt"   run a non-interactive prompt through the agent

Arguments:
  Everything after `--` is forwarded to the agent wrapper inside the container.

Notes:
  The project root is found by walking up for a `.workspace` marker, falling back to
  the current directory when there is none - no error, no prompt, and no automatic
  registration with the daemon.
""")

    def test_build_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("build", capsys) == snapshot("""\
Usage: claudebox build [-h] [-v] [--layer {all,agent}]

Build container image

Options:
  -h, --help           show this help message and exit
  -v, --verbose        Increase output verbosity (verb-dependent - see per-verb help)
  --layer {all,agent}  Which image layer to rebuild (default: cached build)

Examples:
  claudebox build                cached build (reuses all layers)
  claudebox build --layer all    full rebuild from base
  claudebox build --layer agent  rebuild agent layer only
""")

    def test_shell_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("shell", capsys) == snapshot("""\
Usage: claudebox shell [-h] [-v]

Open bash shell in fresh container

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox shell                open a shell in a fresh container
""")

    def test_prune_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("prune", capsys) == snapshot("""\
Usage: claudebox prune [-h] [-v]

Remove stopped containers, dangling images, stale dirs

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox prune                summary count only
  claudebox -v prune             list each removed item

Removes:
  stale session and temp directories under ~/.claudebox and /tmp
  dangling claudebox container images
  stopped claudebox containers (typically none under auto-removal)

Notes:
  Each removal is independent: a failure in one category does not abort the rest.
  The command exits non-zero if any item failed.
""")

    def test_version_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("version", capsys) == snapshot("""\
Usage: claudebox version [-h] [-v]

Print version

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox version              print version, branch, commit, install path, python
""")

    def test_doctor_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("doctor", capsys) == snapshot("""\
Usage: claudebox doctor [-h] [-v]

Diagnose environment

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox doctor               run all environment checks
  claudebox -v doctor            show the probe command behind each check

Checks (in order, one row each):
  runtime, runtime info, uv, daemon http, daemon unit, watchdog timer,
  ~/.claudebox/lib, profile, workspace (.workspace marker), permissions,
  disk (/tmp free)

Icons:
  ✓  the check passed
  ✗  the check failed
  ○  informational only (no profile configured, no workspace marker)

Notes:
  Exit code is 1 if any check failed, 0 otherwise.
""")

    def test_update_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("update", capsys) == snapshot("""\
Usage: claudebox update [-h] [-v]

Update Claudebox itself (re-runs install.sh)

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox update               refresh Claudebox itself
  claudebox -v update            forward --verbose to install.sh

Notes:
  Spawns `~/.claudebox/lib/bin/install.sh`, surfaces its output live, and propagates
  its exit code. Concurrent invocations are blocked by install.sh's lock - the second
  exits non-zero immediately.

Build vs update:
  build   rebuilds the container image (the agent layer inside it)
  update  refreshes Claudebox's own library on the host
""")

    def test_logs_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("logs", capsys) == snapshot("""\
Usage: claudebox logs [-h] [-v] [--tail TAIL] [--no-follow] [{daemon,all}]

Stream logs (daemon | all)

Positional Arguments:
  {daemon,all}   Log source (default: daemon)

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)
  --tail TAIL    Number of trailing lines to backfill before following (default: 100)
  --no-follow    Print the backfilled lines and exit instead of following

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
""")

    def test_workspaces_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("workspaces", capsys) == snapshot("""\
Usage: claudebox workspaces [-h] [-v] <action> ...

Manage registered workspaces (list|register|deregister)

Positional Arguments:
  <action>
    list         Enumerate registered workspaces
    register     Register a workspace (defaults to cwd); creates .workspace marker if missing
    deregister   Remove a workspace from the daemon's registry (.workspace marker preserved)

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox workspaces list                  table of all registered workspaces
  claudebox workspaces register              register cwd as a workspace
  claudebox workspaces register ~/dev/bar    register a specific path
  claudebox workspaces deregister foo        remove from the daemon's registry

Notes:
  Register creates the `.workspace` marker file if absent, then registers with the
  daemon. Re-registering an already-registered path is idempotent and exits 0.
  Basename collisions are disambiguated by an 8-char path-hash suffix on the id.

  Deregister removes the workspace from the daemon's registry only - the `.workspace`
  marker file on disk is preserved.

  Bare `claudebox workspaces` prints this list and exits non-zero.
""")

    def test_containers_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("containers", capsys) == snapshot("""\
Usage: claudebox containers [-h] [-v] <action> ...

Manage containers (list|stop|kill)

Positional Arguments:
  <action>
    list         Enumerate all containers across all workspaces
    stop         SIGTERM a container (10s grace) - accepts <id>, prefix, or all
    kill         SIGKILL a container immediately - accepts <id>, prefix, or all

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox containers list                  table across all workspaces
  claudebox containers stop abc123456789     SIGTERM by full id
  claudebox containers stop abc1             SIGTERM by unique prefix
  claudebox containers kill abc1             SIGKILL immediately
  claudebox containers stop all              graceful stop every running container
  claudebox containers kill all              hard-kill every running container

Notes:
  Prefix resolution is CLI-side: an ambiguous prefix surfaces the matching rows in
  containers-list format and exits non-zero.

  `all` filters to running containers labeled app=claudebox and fans out concurrently.
  Partial failures are reported per container; the command exits non-zero if any failed.
""")

    def test_status_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("status", capsys) == snapshot("""\
Usage: claudebox status [-h] [-v]

Show daemon + containers + workspace state

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox status               three rows: DAEMON, CONTAINERS, WORKSPACE

Rows:
  DAEMON      running or stopped, with pid + uptime when running
  CONTAINERS  aggregate counts across all registered workspaces
  WORKSPACE   resolved workspace for the current directory, plus its registration
              state (its id, or `not yet registered`)

Notes:
  When the daemon is not running, CONTAINERS falls back to direct runtime queries and
  WORKSPACE reads `~/.claudebox/daemon.json` directly. Exit code is always 0 - status
  is a query.
""")

    def test_daemon_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("daemon", capsys) == snapshot("""\
Usage: claudebox daemon [-h] [-v] <action> ...

Manage host daemon (start|stop|restart|status)

Positional Arguments:
  <action>
    start        Start the host daemon
    stop         Stop the host daemon
    restart      Restart the host daemon
    status       Show daemon state

Options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent - see per-verb help)

Examples:
  claudebox daemon start         start the host daemon
  claudebox daemon stop          stop the host daemon
  claudebox daemon restart       atomic restart (no-downtime when possible)
  claudebox daemon status        one-line state with pid + uptime

Notes:
  Actions are systemd --user wrappers around `claudebox-daemon.service`.

  Bare `claudebox daemon` prints this list and exits non-zero.
""")
