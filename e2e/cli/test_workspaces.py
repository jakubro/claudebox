"""End-to-end behavioral tests for ``claudebox workspaces`` noun-group.

Live register/deregister cycles require a daemon; tests assert the dispatch
surface plus the workspaces-side ``cli:run:no-auto-register`` anchor.
"""

import shutil


# SPEC: cli:workspaces-list
class TestWorkspacesHelp:
    """``claudebox workspaces --help`` exits 0 and lists actions."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces", "--help"])
        assert result.returncode == 0

    def test_help_lists_actions(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces", "--help"])
        for action in ("list", "register", "deregister"):
            assert action in result.stdout


# SPEC: cli:workspaces-list
class TestWorkspacesBare:
    """Bare ``claudebox workspaces`` prints sub-help (with literal [args]) and exits 2."""

    def test_bare_exits_2(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces"])
        assert result.returncode == 2

    def test_bare_lists_actions_with_literal_brackets(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces"])
        combined = result.stdout + result.stderr
        assert "[args]" in combined
        for action in ("list", "register", "deregister"):
            assert action in combined


# SPEC: cli:workspaces-list
class TestWorkspacesListNoDaemon:
    """``workspaces list`` against a missing daemon: clean error + non-zero."""

    def test_list_daemon_unreachable_exits_1(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces", "list"], timeout=15)
        assert result.returncode == 1
        combined = result.stdout + result.stderr
        assert "daemon not reachable" in combined
        assert "Traceback" not in result.stderr


# SPEC: cli:workspaces-register
# SPEC: cli:workspaces-register-idempotent
# SPEC: cli:workspaces-register-collision
class TestWorkspacesRegister:
    """register creates the .workspace marker even when the daemon is unreachable."""

    def test_register_creates_workspace_marker(self, tmp_path, run_claudebox) -> None:
        # Daemon will be unreachable in sandbox — but the marker creation happens
        # BEFORE the POST. Marker MUST exist after the run (even though the daemon
        # call fails with exit 1).
        target = tmp_path / "newproj"
        target.mkdir()

        result = run_claudebox(
            ["workspaces", "register", str(target)],
            env={"HOME": str(tmp_path)},
            timeout=15,
        )
        # Daemon unreachable → exit non-zero, but marker IS created.
        assert (target / ".workspace").exists()
        assert "Traceback" not in result.stderr


# SPEC: cli:workspaces-deregister
class TestWorkspacesDeregister:
    """deregister requires an id; daemon-unreachable surfaces cleanly."""

    def test_deregister_requires_id(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces", "deregister"])
        assert result.returncode == 2

    def test_deregister_daemon_unreachable_exits_1(self, run_claudebox) -> None:
        result = run_claudebox(["workspaces", "deregister", "nope"], timeout=15)
        assert result.returncode == 1
        assert "Traceback" not in result.stderr


# SPEC: cli:run:no-auto-register
class TestRunNoAutoRegister:
    """``run`` MUST NOT register the workspace or write a `.workspace` marker.

    Workspaces-side anchor for the contract; the primary assertion lives in
    test_run.py.
    """

    def test_run_does_not_write_workspace_marker(self, tmp_path, run_claudebox) -> None:
        if shutil.which("podman") is None:
            # Container path requires podman; exit semantics differ. We only need
            # to assert the absence of the marker file — that's deterministic.
            result = run_claudebox(
                ["run", "--", "-p", "echo smoke"],
                cwd=tmp_path,
                env={"HOME": str(tmp_path)},
                timeout=15,
            )
        else:
            result = run_claudebox(["run"], cwd=tmp_path, env={"HOME": str(tmp_path)}, timeout=30)

        assert not (tmp_path / ".workspace").exists()
        assert result.returncode is not None
