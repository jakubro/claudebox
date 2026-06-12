"""End-to-end behavioral tests for ``claudebox status``.

Real-binary surface: three-row render (DAEMON / CONTAINERS / WORKSPACE),
degraded-mode behavior with no daemon HTTP, and workspace not-yet-registered
state under hermetic HOME.
"""

import pytest
from pytest_httpserver import HTTPServer


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:status
class TestStatusOutput:
    """``claudebox status`` always prints all three rows and exits 0."""

    def test_status_prints_three_sections_and_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["status"], timeout=15)
        assert result.returncode == 0
        combined = result.stdout + result.stderr

        for section in ("DAEMON", "CONTAINERS", "WORKSPACE"):
            assert section in combined


# SPEC: cli:status-degraded
class TestStatusDegraded:
    """When the daemon is not running, status still produces a complete state snapshot."""

    def test_degraded_reports_daemon_not_running(self, run_claudebox) -> None:
        # Fake systemctl returns inactive by default → cmd_status reports "not running".
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "not running" in combined

    def test_degraded_still_renders_containers_row(
        self, run_claudebox, httpserver: HTTPServer
    ) -> None:
        # Daemon unreachable → cmd_status falls back to direct runtime queries via
        # fake podman. CONTAINERS row renders regardless.
        httpserver.expect_request("/api/workspaces").respond_with_data("", status=503)
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "CONTAINERS" in combined
        assert "running" in combined and "stopped" in combined

    def test_workspace_not_yet_registered(self, run_claudebox) -> None:
        # Hermetic HOME contains no daemon.json → WORKSPACE row reports
        # "not yet registered".
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "WORKSPACE" in combined
        assert "not yet registered" in combined
