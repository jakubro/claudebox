"""End-to-end behavioral tests for ``claudebox status``.

Real-binary surface: three-row render, degraded mode without a daemon, and unregistered-workspace state.
"""

from __future__ import annotations

import json

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
        # Fake systemctl returns inactive by default, so cmd_status reports "not running".
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "not running" in combined

    def test_degraded_still_renders_containers_row(
        self,
        run_claudebox,
        httpserver: HTTPServer,
    ) -> None:
        # Daemon unreachable: cmd_status queries runtime directly via fake podman, so CONTAINERS still renders.
        httpserver.expect_request("/api/workspaces").respond_with_data("", status=503)
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "CONTAINERS" in combined
        assert "running" in combined and "stopped" in combined

    @pytest.mark.parametrize(
        ("states", "row"),
        [
            ([], "CONTAINERS 0 running, 0 stopped"),
            (["running"], "CONTAINERS 1 running, 0 stopped"),
            (["running", "exited"], "CONTAINERS 1 running, 1 stopped"),
        ],
    )
    def test_degraded_counts_what_docker_lists(
        self,
        tmp_path,
        hermetic_home,
        run_claudebox,
        states,
        row,
    ) -> None:
        (tmp_path / ".workspace").touch()
        (hermetic_home / ".claudebox").mkdir()
        (hermetic_home / ".claudebox" / "settings.toml").write_text('backend = "docker"\n')
        listing = "".join(
            json.dumps(
                {
                    "ID": f"9c41e0d{i}",
                    "Labels": f"app=claudebox,claudebox-id=cb-{i}",
                    "Names": f"claudebox-{i}",
                    "State": state,
                },
            )
            + "\n"
            for i, state in enumerate(states)
        )

        result = run_claudebox(
            ["status"],
            cwd=tmp_path,
            env={"CLAUDEBOX_TEST_DOCKER_PS": listing},
            timeout=15,
        )

        combined = result.stdout + result.stderr
        assert result.returncode == 0, combined
        assert row in combined

    def test_workspace_not_yet_registered(self, run_claudebox) -> None:
        # Hermetic HOME contains no daemon.json, so WORKSPACE row reports "not yet registered".
        result = run_claudebox(["status"], timeout=15)
        combined = result.stdout + result.stderr
        assert "WORKSPACE" in combined
        assert "not yet registered" in combined
