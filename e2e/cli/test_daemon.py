"""End-to-end behavioral tests for ``claudebox daemon`` noun-group.

Exercises the SPEC ``cli:daemon`` claim through the real binary via subprocess.
Sandbox lacks an installed systemd unit, so most lifecycle actions exit
non-zero — tests assert on the dispatch surface, not on real systemctl side
effects.
"""


# SPEC: cli:daemon
class TestDaemonHelp:
    """``claudebox daemon --help`` exits 0 and documents the four actions."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["daemon", "--help"])
        assert result.returncode == 0

    def test_help_lists_all_actions(self, run_claudebox) -> None:
        result = run_claudebox(["daemon", "--help"])
        for action in ("start", "stop", "restart", "status"):
            assert action in result.stdout


# SPEC: cli:daemon
class TestDaemonBareInvocation:
    """Bare ``claudebox daemon`` prints sub-help and exits 2 (argparse-style)."""

    def test_bare_exits_2(self, run_claudebox) -> None:
        result = run_claudebox(["daemon"])
        assert result.returncode == 2

    def test_bare_prints_action_list(self, run_claudebox) -> None:
        result = run_claudebox(["daemon"])
        # The sub-help enumerates the four actions on stderr (Rich console).
        combined = result.stdout + result.stderr
        for action in ("start", "stop", "restart", "status"):
            assert action in combined


# SPEC: cli:daemon
class TestDaemonStatus:
    """``claudebox daemon status`` always succeeds and reports a state line."""

    def test_status_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["daemon", "status"], timeout=15)
        # ``status`` returns 0 whether the daemon is running or not — it's a query.
        assert result.returncode == 0

    def test_status_reports_running_or_not(self, run_claudebox) -> None:
        result = run_claudebox(["daemon", "status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "claudebox-daemon" in combined
        # Either pid-bearing "running" or explicit "not running".
        assert "running" in combined or "not running" in combined


# SPEC: cli:daemon
class TestDaemonAction:
    """Lifecycle verbs reach the dispatcher — they exit cleanly even on systemctl failure."""

    def test_unknown_action_exits_2(self, run_claudebox) -> None:
        # argparse rejects unknown actions before reaching the handler.
        result = run_claudebox(["daemon", "bogus"])
        assert result.returncode == 2
        assert "invalid choice" in result.stderr

    def test_action_no_python_traceback_on_systemctl_failure(self, run_claudebox) -> None:
        # In an env without a registered claudebox-daemon.service, ``stop`` is a no-op
        # error from systemctl. The handler must surface a clean error (no traceback).
        result = run_claudebox(["daemon", "stop"], timeout=15)
        # Returncode may be 0 (no-op) or 1 (systemctl failure) depending on env;
        # the contract is no Python traceback either way.
        assert "Traceback" not in result.stderr
