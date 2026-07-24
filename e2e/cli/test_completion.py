"""End-to-end tests for ``claudebox`` bash tab-completion (argcomplete protocol).

Drives argcomplete's completion protocol against the CLI subprocess: sets
``_ARGCOMPLETE`` / ``COMP_LINE`` / ``COMP_POINT``, captures the completion stream
argcomplete writes to fd 8, and asserts the offered candidates. Reuses the
hermetic harness (bwrap + fake bins + fake daemon).
"""

import json
import os
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest
from pytest_httpserver import HTTPServer


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# argcomplete separates completion candidates on the fd-8 stream with a vertical tab.
_ARGCOMPLETE_IFS = "\x0b"

# A closed port: httpx ConnectError is the "daemon unreachable" path for the completer.
_DEAD_DAEMON_URL = "http://127.0.0.1:1"

_VERBS = frozenset(
    {
        "build",
        "run",
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
    }
)


@pytest.fixture
def complete(
    claudebox_bin: Path,
    hermetic_home: Path,
    fake_bins_dir: Path,
    record_dir: Path,
    fake_daemon: str,
) -> Callable[..., list[str]]:
    """Return a helper that drives argcomplete completion for a COMP_LINE and returns the candidates."""

    def _complete(comp_line: str, *, daemon_url: str | None = None) -> list[str]:
        env = {
            **os.environ,
            "CLAUDEBOX_TEST_HOME": str(hermetic_home),
            "CLAUDEBOX_TEST_PATH_PREFIX": str(fake_bins_dir),
            "CLAUDEBOX_TEST_RECORD_DIR": str(record_dir),
            "CLAUDEBOX_DAEMON_URL": daemon_url if daemon_url is not None else fake_daemon,
            "_ARGCOMPLETE": "1",
            "_ARGCOMPLETE_SHELL": "bash",
            "COMP_LINE": comp_line,
            "COMP_POINT": str(len(comp_line)),
            "COMP_TYPE": "9",
        }

        # argcomplete writes candidates to fd 8; route fd 8 -> the captured stdout
        # pipe and mute the program's own stdout/stderr so only completions are read.
        result = subprocess.run(
            ["bash", "-c", 'exec 8>&1 1>/dev/null 2>/dev/null; exec "$@"', "_", str(claudebox_bin)],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
            check=False,
        )

        return [c for c in result.stdout.split(_ARGCOMPLETE_IFS) if c]

    return _complete


def _seed_registry(home: Path, workspace_ids: list[str]) -> None:
    """Write a minimal ``~/.claudebox/daemon.json`` listing the given workspace ids."""

    config_dir = home / ".claudebox"
    config_dir.mkdir(parents=True, exist_ok=True)
    payload = {"workspaces": [{"id": ws_id} for ws_id in workspace_ids]}
    (config_dir / "daemon.json").write_text(json.dumps(payload))


# SPEC: cli:completion
class TestStaticCompletion:
    """Verbs, noun-group actions, and flags complete from argparse introspection (no daemon)."""

    def test_verbs(self, complete) -> None:
        assert _VERBS <= set(complete("claudebox "))

    def test_workspaces_actions(self, complete) -> None:
        assert {"list", "register", "deregister"} <= set(complete("claudebox workspaces "))

    def test_containers_actions(self, complete) -> None:
        assert {"list", "stop", "kill"} <= set(complete("claudebox containers "))

    def test_flags(self, complete) -> None:
        assert {"-v", "--verbose", "-h", "--help"} <= set(complete("claudebox status -"))


# SPEC: cli:completion:workspace-ids
class TestWorkspaceIdCompletion:
    """``workspaces deregister`` completes registered ids from the local registry - no daemon call."""

    def test_completes_registered_ids_without_daemon(self, complete, hermetic_home: Path) -> None:
        _seed_registry(hermetic_home, ["alpha", "beta-1a2b3c4d"])

        # Daemon pointed at a dead port: a hit proves the registry read is local-only.
        candidates = set(complete("claudebox workspaces deregister ", daemon_url=_DEAD_DAEMON_URL))

        assert {"alpha", "beta-1a2b3c4d"} <= candidates


# SPEC: cli:completion:container-ids
class TestContainerTargetCompletion:
    """``containers stop`` completes short ids across workspaces plus ``all``; degrades when down."""

    def test_completes_container_ids_and_all(
        self, complete, hermetic_home: Path, httpserver: HTTPServer
    ) -> None:
        _seed_registry(hermetic_home, ["ws1"])
        httpserver.expect_request("/api/workspaces/ws1/containers").respond_with_json(
            {"containers": [{"id": "abc123456789def0"}, {"id": "0011223344556677"}]}
        )

        candidates = set(complete("claudebox containers stop "))

        assert "all" in candidates
        assert "abc123456789" in candidates  # 12-char short id
        assert "001122334455" in candidates

    def test_daemon_down_yields_all_only(self, complete, hermetic_home: Path) -> None:
        _seed_registry(hermetic_home, ["ws1"])

        candidates = complete("claudebox containers stop ", daemon_url=_DEAD_DAEMON_URL)

        # argparse always offers -h/--help at any slot; the only container-slot value is 'all'.
        non_flag = {c for c in candidates if not c.startswith("-")}
        assert non_flag == {"all"}
