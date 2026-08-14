"""End-to-end tests for ``claudebox`` bash tab-completion (argcomplete protocol).

Asserts candidates for a given COMP_LINE; the ``complete`` fixture drives argcomplete against the CLI subprocess.
"""

import json
from pathlib import Path

import pytest
from pytest_httpserver import HTTPServer


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


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
    },
)


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
        self,
        complete,
        hermetic_home: Path,
        httpserver: HTTPServer,
    ) -> None:
        _seed_registry(hermetic_home, ["ws1"])
        httpserver.expect_request("/api/workspaces/ws1/containers").respond_with_json(
            {"containers": [{"id": "abc123456789def0"}, {"id": "0011223344556677"}]},
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
