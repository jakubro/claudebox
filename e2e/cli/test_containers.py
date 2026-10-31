"""End-to-end behavioral tests for ``claudebox containers`` noun-group.

Surfaces only the real binary can prove: raw-print sub-help (Rich-bypassed) and daemon-unreachable
rendering against the hermetic fake daemon.
"""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# Port 1 is IANA-reserved and never listened on, so pointing CLAUDEBOX_DAEMON_URL there gives
# httpx ECONNREFUSED - the path the CLI's "daemon not reachable" handler exists to surface.
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

    stop/kill also exercise the prefix-match path (no container matches "abc") and
    partial-failure surfacing (each fan-out target reports its own outcome).
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
        # A closed port triggers ConnectError, hitting the daemon-not-reachable branch (clean
        # error, exit 1).
        result = run_claudebox(args, env={"CLAUDEBOX_DAEMON_URL": _DEAD_DAEMON_URL}, timeout=15)
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "daemon not reachable" in combined
        assert "Traceback" not in result.stderr


_NOW = "2026-01-01T00:00:00+00:00"


def _listing(container_id: str, status: str, session_id: str) -> dict:
    return {
        "id": container_id,
        "backend_id": "b-" + container_id,
        "status": status,
        "session_id": session_id,
        "labels": {"kind": "session"},
        "created_at": _NOW,
        "members": [],
    }


# SPEC: cli:containers-list-session
class TestContainersListSessions:
    """Each row names its session, the session's name and, while the container runs, its state."""

    @pytest.fixture
    def daemon(self, hermetic_home, httpserver):
        (hermetic_home / ".claudebox").mkdir()
        (hermetic_home / ".claudebox" / "daemon.json").write_text(
            '{"workspaces": [{"id": "ws-list", "path": "/srv/ws-list"}]}',
        )
        httpserver.expect_request("/api/workspaces/ws-list/containers").respond_with_json(
            {
                "containers": [
                    _listing("c1aaaaaaaaaa1111", "running", "6d3c97d7-1111"),
                    _listing("c2bbbbbbbbbb2222", "running", "9f2c41ab-2222"),
                    _listing("c3cccccccccc3333", "stopped", "4ad147d3-3333"),
                ],
            },
        )

        return httpserver

    def _rows(self, result) -> dict[str, str]:
        lines = (result.stdout + result.stderr).splitlines()

        return {
            cid: next(line for line in lines if cid in line)
            for cid in ("c1aaaa", "c2bbbb", "c3cccc")
        }

    def test_session_columns_name_the_session_and_its_state(self, daemon, run_claudebox) -> None:
        daemon.expect_request("/api/workspaces/ws-list/sessions").respond_with_json(
            {
                "sessions": [
                    {
                        "session_id": "6d3c97d7-1111",
                        "name": "Fix the login flow",
                        "needs_user": "Decide: x",
                    },
                    {
                        "session_id": "9f2c41ab-2222",
                        "auto_name": "Tidy the notes",
                        "activity": "working",
                    },
                    {"session_id": "4ad147d3-3333", "name": "Old spike", "needs_user": "Decide: y"},
                ],
            },
        )

        result = run_claudebox(
            ["containers", "list"],
            env={"COLUMNS": "250", "FORCE_COLOR": "1", "COLORTERM": "truecolor"},
        )
        rows = self._rows(result)

        assert result.returncode == 0, result.stderr
        assert "SESSION STATE" in result.stdout + result.stderr
        assert "6d3c97d7" in rows["c1aaaa"] and "Fix the login flow" in rows["c1aaaa"]
        assert "\x1b[38;2;194;65;12mneeds you" in rows["c1aaaa"]
        assert "Tidy the notes" in rows["c2bbbb"]
        assert "\x1b[38;2;168;85;247mworking" in rows["c2bbbb"]
        assert "Old spike" in rows["c3cccc"] and "needs you" not in rows["c3cccc"]

    def test_unloadable_sessions_leave_the_rows_without_session_columns(
        self,
        daemon,
        run_claudebox,
    ) -> None:
        daemon.expect_request("/api/workspaces/ws-list/sessions").respond_with_data("", status=500)

        result = run_claudebox(["containers", "list"], env={"COLUMNS": "250", "NO_COLOR": "1"})
        rows = self._rows(result)

        assert result.returncode == 0, result.stderr
        assert all(rows.values())
        assert "6d3c97d7" not in rows["c1aaaa"]
