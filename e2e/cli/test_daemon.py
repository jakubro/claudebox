"""End-to-end behavioral tests for ``claudebox daemon`` noun-group.

Real-binary surfaces: raw-print sub-help, status rendering against fake systemctl,
and Traceback-absence when systemctl rejects a lifecycle action.
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:daemon
class TestDaemonBareInvocation:
    """Bare ``claudebox daemon`` prints the action list and exits 2."""

    def test_bare_prints_action_list(self, run_claudebox) -> None:
        result = run_claudebox(["daemon"])
        assert result.returncode == 2
        combined = result.stdout + result.stderr

        for action in ("start", "stop", "restart", "status"):
            assert action in combined


# SPEC: cli:daemon
class TestDaemonStatus:
    """``claudebox daemon status`` reports daemon state (always exits 0 — a query)."""

    def test_status_reports_running_or_not(self, run_claudebox) -> None:
        result = run_claudebox(["daemon", "status"], timeout=15)
        assert result.returncode == 0
        combined = result.stdout + result.stderr
        assert "claudebox-daemon" in combined
        assert "running" in combined or "not running" in combined


# SPEC: cli:daemon
class TestDaemonAction:
    """Lifecycle verbs surface systemctl failure cleanly — no Python traceback."""

    def test_action_no_python_traceback_on_systemctl_failure(self, run_claudebox) -> None:
        # Fake systemctl returns exit 0 for stop/start/restart but the daemon never
        # came up under fake systemctl. The contract: no traceback regardless of
        # systemctl's response.
        result = run_claudebox(["daemon", "stop"], timeout=15)
        assert "Traceback" not in result.stderr
