"""End-to-end behavioral tests for ``claudebox containers`` noun-group.

Live cycles require a daemon; tests assert dispatch surface + graceful errors.
"""


# SPEC: cli:containers-list
class TestContainersHelp:
    """``claudebox containers --help`` exits 0 and lists actions."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "--help"])
        assert result.returncode == 0

    def test_help_lists_actions(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "--help"])
        for action in ("list", "stop", "kill"):
            assert action in result.stdout


# SPEC: cli:containers-list
class TestContainersBare:
    """Bare ``claudebox containers`` prints sub-help (with literal brackets) and exits 2."""

    def test_bare_exits_2(self, run_claudebox) -> None:
        result = run_claudebox(["containers"])
        assert result.returncode == 2

    def test_bare_lists_actions_with_literal_brackets(self, run_claudebox) -> None:
        result = run_claudebox(["containers"])
        combined = result.stdout + result.stderr
        # Sub-help survives Rich's markup parser via plain print.
        assert "[args]" in combined
        for action in ("list", "stop", "kill"):
            assert action in combined


# SPEC: cli:containers-list
class TestContainersListNoDaemon:
    """``containers list`` against a missing daemon: graceful error + non-zero."""

    def test_list_daemon_unreachable_exits_1(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "list"], timeout=15)
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "daemon not reachable" in combined
        assert "Traceback" not in result.stderr


# SPEC: cli:containers-stop
# SPEC: cli:containers-kill
class TestContainersStopKill:
    """stop/kill require a target and surface daemon-unreachable cleanly."""

    def test_stop_requires_target(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "stop"])
        assert result.returncode == 2

    def test_kill_requires_target(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "kill"])
        assert result.returncode == 2

    def test_stop_daemon_unreachable_exits_1(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "stop", "abc"], timeout=15)
        assert result.returncode == 1
        assert "Traceback" not in result.stderr

    def test_kill_daemon_unreachable_exits_1(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "kill", "abc"], timeout=15)
        assert result.returncode == 1
        assert "Traceback" not in result.stderr


# SPEC: cli:containers-prefix-match
class TestContainersPrefixMatch:
    """Prefix resolution is CLI-side; ambiguous prefixes never reach the daemon."""

    def test_help_documents_prefix_resolution(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "--help"])
        assert "prefix" in result.stdout.lower()


# SPEC: cli:containers-partial-failure
class TestContainersAllSemantics:
    """``stop all`` and ``kill all`` accept the literal target ``all`` for fan-out."""

    def test_help_documents_all_target(self, run_claudebox) -> None:
        result = run_claudebox(["containers", "--help"])
        # The help text references both 'all' and partial failure behavior.
        assert "all" in result.stdout
        assert "fan" in result.stdout.lower() or "partial" in result.stdout.lower()
