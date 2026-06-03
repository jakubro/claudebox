"""End-to-end behavioral tests for ``claudebox status``.

Exercises the SPEC ``cli:status`` and ``cli:status-degraded`` claims through
the real binary via subprocess. The sandbox has no daemon running, so every
e2e run effectively exercises the degraded-mode path.
"""


# SPEC: cli:status
class TestStatusHelp:
    """``claudebox status --help`` exits 0 and documents the three sections."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["status", "--help"])
        assert result.returncode == 0

    def test_help_mentions_sections(self, run_claudebox) -> None:
        result = run_claudebox(["status", "--help"])
        for section in ("DAEMON", "CONTAINERS", "WORKSPACE"):
            assert section in result.stdout


# SPEC: cli:status
class TestStatusOutput:
    """``claudebox status`` always prints all three rows and exits 0."""

    def test_status_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["status"], timeout=15)
        assert result.returncode == 0

    def test_status_prints_three_sections(self, run_claudebox) -> None:
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        for section in ("DAEMON", "CONTAINERS", "WORKSPACE"):
            assert section in combined


# SPEC: cli:status-degraded
class TestStatusDegraded:
    """When the daemon is not running, status still produces a complete state snapshot."""

    def test_degraded_reports_daemon_not_running(self, run_claudebox) -> None:
        # Sandbox lacks a running claudebox-daemon.service — guaranteed degraded.
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "not running" in combined

    def test_degraded_still_renders_containers_row(self, run_claudebox) -> None:
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        # The CONTAINERS row reads from podman directly under degraded mode.
        assert "CONTAINERS" in combined
        assert "running" in combined and "stopped" in combined

    def test_degraded_still_renders_workspace_row(self, run_claudebox, tmp_path) -> None:
        # Use a fresh HOME so daemon.json is absent — workspace falls through to
        # "not yet registered".
        result = run_claudebox(
            ["status"],
            env={"HOME": str(tmp_path)},
            timeout=15,
        )
        combined = result.stdout + result.stderr
        assert "WORKSPACE" in combined
        assert "not yet registered" in combined
