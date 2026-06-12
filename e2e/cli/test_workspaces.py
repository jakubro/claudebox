"""End-to-end behavioral tests for ``claudebox workspaces`` noun-group.

Real-binary surfaces: raw-print sub-help, daemon-unreachable for list and
deregister, ``register`` creates the ``.workspace`` marker before the POST
even when the daemon is unreachable, and ``run`` never auto-registers.
"""

import pytest
from pytest_httpserver import HTTPServer


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:workspaces-list
class TestWorkspacesBare:
    """Bare ``claudebox workspaces`` prints sub-help (with literal [args]) and exits 2."""

    def test_bare_lists_actions_with_literal_brackets(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces"])
        assert result.returncode == 2
        combined = result.stdout + result.stderr
        assert "[args]" in combined

        for action in ("list", "register", "deregister"):
            assert action in combined


# SPEC: cli:workspaces-list
# SPEC: cli:workspaces-deregister
class TestWorkspacesDaemonUnreachable:
    """list and deregister surface clean errors + non-zero when daemon is down."""

    @pytest.mark.parametrize(
        "args",
        [
            ["workspaces", "list"],
            ["workspaces", "deregister", "nope"],
        ],
    )
    def test_daemon_unreachable_exits_1(
        self, args: list[str], run_claudebox, httpserver: HTTPServer
    ) -> None:
        httpserver.expect_request("/api/workspaces").respond_with_data("", status=503)
        result = run_claudebox(args, timeout=15)
        assert result.returncode == 1
        assert "Traceback" not in result.stderr


# SPEC: cli:workspaces-register
# SPEC: cli:workspaces-register-idempotent
# SPEC: cli:workspaces-register-collision
class TestWorkspacesRegister:
    """``register`` creates the ``.workspace`` marker before the POST."""

    def test_register_creates_workspace_marker(
        self, tmp_path, run_claudebox, httpserver: HTTPServer
    ) -> None:
        # Daemon unreachable; the marker creation happens BEFORE the POST and
        # MUST persist after the run, even though the daemon call fails.
        httpserver.expect_request("/api/workspaces").respond_with_data("", status=503)
        target = tmp_path / "newproj"
        target.mkdir()

        result = run_claudebox(
            ["workspaces", "register", str(target)],
            timeout=15,
        )
        assert (target / ".workspace").exists()
        assert "Traceback" not in result.stderr


# SPEC: cli:run:no-auto-register
class TestRunNoAutoRegister:
    """``run`` MUST NOT register the workspace or write a ``.workspace`` marker."""

    def test_run_does_not_write_workspace_marker(self, tmp_path, run_claudebox) -> None:
        # Fake podman ignores actual container semantics; the only deterministic
        # assertion is the absence of the marker file.
        result = run_claudebox(["run"], cwd=tmp_path, timeout=30)
        assert not (tmp_path / ".workspace").exists()
        assert result.returncode is not None
