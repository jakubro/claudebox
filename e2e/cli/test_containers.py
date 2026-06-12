"""End-to-end behavioral tests for ``claudebox containers`` noun-group.

Surfaces only the real binary can prove: raw-print sub-help (Rich-bypassed)
and daemon-unreachable rendering against the hermetic fake daemon.
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# Port 1 is reserved by the IANA registry and never listened on in practice;
# pointing CLAUDEBOX_DAEMON_URL there causes httpx to receive ECONNREFUSED,
# which is the path the CLI's "daemon not reachable" handler exists to surface.
_DEAD_DAEMON_URL = "http://127.0.0.1:1"


# SPEC: cli:containers-list
class TestContainersBare:
    """Bare ``claudebox containers`` prints sub-help (with literal brackets) and exits 2."""

    def test_bare_lists_actions_with_literal_brackets(self, run_claudebox) -> None:
        result = run_claudebox(["containers"])
        assert result.returncode == 2
        combined = result.stdout + result.stderr
        # Sub-help survives Rich's markup parser via plain print.
        assert "[args]" in combined

        for action in ("list", "stop", "kill"):
            assert action in combined


# SPEC: cli:containers-list
# SPEC: cli:containers-stop
# SPEC: cli:containers-kill
# SPEC: cli:containers-prefix-match
# SPEC: cli:containers-partial-failure
class TestContainersDaemonUnreachable:
    """list/stop/kill all surface a clean error + non-zero exit when daemon is down.

    The stop/kill cases also exercise the prefix-match path (no container matches "abc")
    and partial-failure surfacing (each fan-out target reports its own outcome).
    """

    @pytest.mark.parametrize(
        "args",
        [
            ["containers", "list"],
            ["containers", "stop", "abc"],
            ["containers", "kill", "abc"],
        ],
    )
    def test_daemon_unreachable_exits_1(self, args: list[str], run_claudebox) -> None:
        # CLAUDEBOX_DAEMON_URL pointing at a closed port → ConnectError → the
        # "daemon not reachable" branch surfaces a clean error + exit 1.
        result = run_claudebox(args, env={"CLAUDEBOX_DAEMON_URL": _DEAD_DAEMON_URL}, timeout=15)
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "daemon not reachable" in combined
        assert "Traceback" not in result.stderr
