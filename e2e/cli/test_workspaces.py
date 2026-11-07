"""End-to-end behavioral tests for ``claudebox workspaces`` noun-group.

Real-binary surfaces: raw-print sub-help, daemon-unreachable for list and
deregister, ``register`` creates the ``.workspace`` marker before the POST
even when the daemon is unreachable, and ``run`` never auto-registers.
"""

from __future__ import annotations

import pytest
from pytest_httpserver import HTTPServer


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])

# Long hermetic paths must not wrap mid-path in the CLI's Rich output.
_WIDE = {"COLUMNS": "1000"}


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
        self,
        args: list[str],
        run_claudebox,
        httpserver: HTTPServer,
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
        self,
        tmp_path,
        run_claudebox,
        httpserver: HTTPServer,
    ) -> None:
        # Daemon unreachable; the marker is created BEFORE the POST and persists even though
        # the daemon call fails.
        httpserver.expect_request("/api/workspaces").respond_with_data("", status=503)
        target = tmp_path / "newproj"
        target.mkdir()

        result = run_claudebox(
            ["workspaces", "register", str(target)],
            timeout=15,
        )
        assert (target / ".workspace").exists()
        assert "Traceback" not in result.stderr


# SPEC: cli:workspaces-register-home
class TestWorkspacesRegisterHome:
    """The home directory registers only when named; a bare register run there registers nothing."""

    @staticmethod
    def _daemon(httpserver: HTTPServer) -> None:
        httpserver.expect_request("/api/workspaces", method="GET").respond_with_json(
            {"workspaces": []},
        )
        httpserver.expect_request("/api/workspaces", method="POST").respond_with_json(
            {"id": "registered"},
        )

    @staticmethod
    def _posts(httpserver: HTTPServer) -> int:
        return sum(1 for request, _ in httpserver.log if request.method == "POST")

    @pytest.mark.parametrize("argv", [[], [""]], ids=["no-path", "empty-path"])
    def test_a_bare_register_in_home_registers_nothing(
        self,
        hermetic_home,
        run_claudebox,
        httpserver: HTTPServer,
        argv: list[str],
    ) -> None:
        self._daemon(httpserver)

        result = run_claudebox(
            ["workspaces", "register", *argv],
            cwd=hermetic_home,
            env=_WIDE,
            timeout=15,
        )

        assert result.returncode == 2
        assert f"claudebox workspaces register {hermetic_home}" in result.stdout + result.stderr
        assert not (hermetic_home / ".workspace").exists()
        assert self._posts(httpserver) == 0

    def test_naming_home_registers_it_and_says_what_it_takes_in(
        self,
        hermetic_home,
        run_claudebox,
        httpserver: HTTPServer,
    ) -> None:
        self._daemon(httpserver)

        result = run_claudebox(
            ["workspaces", "register", str(hermetic_home)],
            env=_WIDE,
            timeout=15,
        )

        assert result.returncode == 0
        assert (hermetic_home / ".workspace").exists()
        assert self._posts(httpserver) == 1
        assert "now belongs to this workspace" in result.stdout + result.stderr

    @pytest.mark.parametrize("argv", [[], [""]], ids=["no-path", "empty-path"])
    def test_a_bare_register_in_a_project_under_home_registers_it(
        self,
        hermetic_home,
        run_claudebox,
        httpserver: HTTPServer,
        argv: list[str],
    ) -> None:
        self._daemon(httpserver)
        project = hermetic_home / "code" / "app"
        project.mkdir(parents=True)

        result = run_claudebox(
            ["workspaces", "register", *argv],
            cwd=project,
            env=_WIDE,
            timeout=15,
        )

        assert result.returncode == 0
        assert (project / ".workspace").exists()
        assert self._posts(httpserver) == 1
        assert "now belongs to this workspace" not in result.stdout + result.stderr


# SPEC: cli:run:no-auto-register
class TestRunNoAutoRegister:
    """``run`` MUST NOT register the workspace or write a ``.workspace`` marker."""

    def test_run_does_not_write_workspace_marker(self, tmp_path, run_claudebox) -> None:
        # Fake podman ignores real container semantics, so the only deterministic assertion
        # is the marker's absence.
        result = run_claudebox(["run"], cwd=tmp_path, timeout=30)
        assert not (tmp_path / ".workspace").exists()
        assert result.returncode is not None
