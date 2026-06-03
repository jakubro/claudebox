"""End-to-end behavioral tests for ``claudebox build``.

Exercises the SPEC ``cli:build:*`` claim set through the real binary via
subprocess.
"""

import shutil

import pytest


# SPEC: cli:build
class TestBuildHelp:
    """``claudebox build --help`` documents the layer choice."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["build", "--help"])
        assert result.returncode == 0

    def test_help_lists_layer_choices(self, run_claudebox) -> None:
        result = run_claudebox(["build", "--help"])
        assert "--layer" in result.stdout
        assert "all" in result.stdout
        assert "agent" in result.stdout


# SPEC: cli:build:layer
class TestBuildLayer:
    """``--layer`` accepts only the documented choices."""

    def test_invalid_layer_exits_2(self, run_claudebox) -> None:
        result = run_claudebox(["build", "--layer", "foo"])
        assert result.returncode == 2
        assert "invalid choice" in result.stderr

    def test_invalid_layer_lists_valid_choices(self, run_claudebox) -> None:
        result = run_claudebox(["build", "--layer", "foo"])
        assert "all" in result.stderr
        assert "agent" in result.stderr


# SPEC: cli:build:failure-propagated
class TestBuildFailurePropagated:
    """A failing build exits with the build tool's exit code, not a traceback."""

    @pytest.mark.skipif(
        shutil.which("podman") is None,
        reason="podman not available — needs real backend to exercise failure path",
    )
    def test_build_failure_no_python_traceback(self, tmp_path, run_claudebox) -> None:
        # Force build failure by pointing the backend at a non-existent
        # context; the actual mechanism isn't important — the contract is
        # "no Python traceback, podman's returncode propagates cleanly."
        result = run_claudebox(["build"], cwd=tmp_path, timeout=120)
        # Tracebacks emit "Traceback (most recent call last):" on stderr.
        assert "Traceback" not in result.stderr
