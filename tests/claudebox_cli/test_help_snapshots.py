"""Inline-snapshot per verb's --help output (all 12 verbs, including stubs).

These snapshots are populated via ``pytest --inline-snapshot=create``; they
lock the surface so accidental help-text drift surfaces as a test diff. The
top-level ``install:`` footer (branch/commit/path) is normalized before
comparison so snapshots stay stable across environments.
"""

import argparse
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

    Normalizes the top-level ``install:`` footer (branch/commit/path) so
    snapshots stay stable across environments.
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


@pytest.mark.parametrize("verb", _VERBS)
def test_verb_help_contains_description(verb: str, capsys: pytest.CaptureFixture[str]) -> None:
    """Every verb's --help prints its description."""

    subparsers_action = next(
        a for a in parser._actions if isinstance(a, argparse._SubParsersAction)
    )
    sub = subparsers_action.choices[verb]
    expected = sub.description

    output = _capture_help(verb, capsys)
    assert expected in output


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
usage: claudebox [-h] [-v] <command> ...

Run Claude Code in a containerized dev environment.

positional arguments:
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

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help) (default: False)

run "claudebox <command> --help" for command-specific help

see also:
  https://github.com/jakubro/claudebox

install:
  <branch> (<commit>) @ <path>
""")

    def test_run_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("run", capsys) == snapshot("""\
usage: claudebox run [-h] [-v] ...

Launch agent session in container

positional arguments:
  agent_args     Arguments forwarded to the agent (place after `--`)

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox run                  launch interactive agent session
  claudebox run -- --resume      resume the most recent agent conversation
  claudebox run -- -p "prompt"   run a non-interactive prompt through the agent

passing extra arguments:
  Arguments after "--" are forwarded to the agent wrapper inside the container.

project detection:
  Walks up the directory tree looking for a .workspace marker to find the
  project root. Falls back to cwd when no marker is present (no error, no
  prompt, no auto-registration with the daemon).
""")

    def test_build_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("build", capsys) == snapshot("""\
usage: claudebox build [-h] [-v] [--layer {all,agent}]

Build container image

options:
  -h, --help           show this help message and exit
  -v, --verbose        Increase output verbosity (verb-dependent — see per-verb help)
  --layer {all,agent}  Which image layer to rebuild (default: cached build) (default: None)

examples:
  claudebox build                cached build (reuses all layers)
  claudebox build --layer all    full rebuild from base
  claudebox build --layer agent  rebuild agent layer only
""")

    def test_shell_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("shell", capsys) == snapshot("""\
usage: claudebox shell [-h] [-v]

Open bash shell in fresh container

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox shell                open a shell in a fresh container
""")

    def test_prune_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("prune", capsys) == snapshot("""\
usage: claudebox prune [-h] [-v]

Remove stopped containers, dangling images, stale dirs

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox prune                summary count only
  claudebox -v prune             list each removed item

prune removes:
  - stale session and temp directories under ~/.claudebox and /tmp
  - dangling claudebox container images
  - stopped claudebox containers (typically none under auto-removal)

partial failure: each removal is independent; a failure in one category does
not abort the rest. Command exits non-zero if any item failed.
""")

    def test_version_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("version", capsys) == snapshot("""\
usage: claudebox version [-h] [-v]

Print version

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox version              print version, branch, commit, install path, python
""")

    def test_doctor_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("doctor", capsys) == snapshot("""\
usage: claudebox doctor [-h] [-v]

Diagnose environment

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox doctor               run all environment checks
  claudebox -v doctor            show the probe command behind each check

doctor runs these checks in order, printing one row each:
  runtime, runtime info, uv, daemon http, daemon unit, ~/.claudebox/lib,
  profile, workspace (.workspace marker), permissions, disk (/tmp free)

icons:
  ✓ pass    ✗ fail    ○ informational (no profile, no workspace marker)

exit code is 1 if any check failed, 0 otherwise.
""")

    def test_update_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("update", capsys) == snapshot("""\
usage: claudebox update [-h] [-v]

Update Claudebox itself (re-runs install.sh)

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox update               refresh Claudebox itself
  claudebox -v update            forward --verbose to install.sh

update spawns ~/.claudebox/lib/bin/install.sh, surfaces its stdout/stderr
live, and propagates its exit code. Concurrent invocations are blocked by
install.sh's flock — the second invocation exits non-zero immediately.

build vs update:
  build  rebuilds the container image (the agent layer inside it).
  update refreshes Claudebox's own library on the host (the install.sh path).
""")

    def test_logs_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("logs", capsys) == snapshot("""\
usage: claudebox logs [-h] [-v] [--tail TAIL] [--no-follow] [{daemon,all}]

Stream logs (daemon | all)

positional arguments:
  {daemon,all}   Log source (default: daemon) (default: daemon)

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)
  --tail TAIL    Number of trailing lines to backfill before following (default: 100) (default: 100)
  --no-follow    Print the backfilled lines and exit instead of following (default: False)

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

colorization: ERROR red, WARNING yellow, INFO default, DEBUG dim. Color is
suppressed under ``NO_COLOR`` or when stdout is not a TTY (Rich defaults).
""")

    def test_workspaces_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("workspaces", capsys) == snapshot("""\
usage: claudebox workspaces [-h] [-v] <action> ...

Manage registered workspaces (list|register|deregister)

positional arguments:
  <action>
    list         Enumerate registered workspaces
    register     Register a workspace (defaults to cwd); creates .workspace marker if missing
    deregister   Remove a workspace from the daemon's registry (.workspace marker preserved)

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

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
""")

    def test_containers_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("containers", capsys) == snapshot("""\
usage: claudebox containers [-h] [-v] <action> ...

Manage containers (list|stop|kill)

positional arguments:
  <action>
    list         Enumerate all containers across all workspaces
    stop         SIGTERM a container (10s grace) — accepts <id>, prefix, or all
    kill         SIGKILL a container immediately — accepts <id>, prefix, or all

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

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
""")

    def test_status_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("status", capsys) == snapshot("""\
usage: claudebox status [-h] [-v]

Show daemon + containers + workspace state

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox status               three rows: DAEMON, CONTAINERS, WORKSPACE

DAEMON     running/stopped, with pid + uptime when running.
CONTAINERS aggregate counts across all registered workspaces.
WORKSPACE  resolved workspace for cwd (walks up for .workspace) plus
           registration state (id, or 'not yet registered').

degraded mode: when the daemon is not running, CONTAINERS falls back to
direct runtime queries and WORKSPACE reads ~/.claudebox/daemon.json
directly. Exit code is always 0 — status is a query.
""")

    def test_daemon_help_snapshot(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert _capture_help("daemon", capsys) == snapshot("""\
usage: claudebox daemon [-h] [-v] <action> ...

Manage host daemon (start|stop|restart|status)

positional arguments:
  <action>
    start        Start the host daemon
    stop         Stop the host daemon
    restart      Restart the host daemon
    status       Show daemon state

options:
  -h, --help     show this help message and exit
  -v, --verbose  Increase output verbosity (verb-dependent — see per-verb help)

examples:
  claudebox daemon start         start the host daemon
  claudebox daemon stop          stop the host daemon
  claudebox daemon restart       atomic restart (no-downtime when possible)
  claudebox daemon status        one-line state with pid + uptime

actions are systemd --user wrappers around `claudebox-daemon.service`.
Bare `claudebox daemon` prints this list and exits non-zero.
""")
