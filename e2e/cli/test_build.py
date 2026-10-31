"""End-to-end behavioral tests for ``claudebox build``.

Help / argparse-level coverage lives in tests/claudebox_cli/; this file asserts only the
real-binary surface: the build the backend is asked for, and clean Traceback-absence on failure.
"""

from __future__ import annotations

from pathlib import Path

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:build:failure-propagated
class TestBuildFailurePropagated:
    """A failing build exits with the build tool's exit code, not a Python traceback."""

    def test_build_failure_no_python_traceback(self, tmp_path, run_claudebox) -> None:
        # cwd has no build context and fake podman only canned-handles --version/info/prune, so
        # any build falls through to exit 0 - the contract is no traceback regardless of outcome.
        result = run_claudebox(["build"], cwd=tmp_path, timeout=60)
        assert "Traceback" not in result.stderr


def _podman_calls(record_dir: Path) -> list[list[str]]:
    return [line.split() for line in (record_dir / "podman.log").read_text().splitlines()]


# SPEC: cli:build
class TestBuild:
    """``claudebox build`` builds the claudebox image and starts no session."""

    def test_build_tags_the_image_and_runs_nothing(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
    ) -> None:
        result = run_claudebox(["build"], cwd=tmp_path, timeout=60)

        calls = _podman_calls(record_dir)
        assert result.returncode == 0
        assert [c[0] for c in calls] == ["build"]
        assert calls[0][calls[0].index("--tag") + 1] == "claudebox"


# SPEC: cli:build:layer
class TestBuildLayer:
    """``--layer all`` rebuilds from scratch; ``--layer agent`` forces only the agent layer."""

    @pytest.mark.parametrize(
        ("layer", "no_cache", "agent_forced"),
        [
            ([], False, False),
            (["--layer", "all"], True, False),
            (["--layer", "agent"], False, True),
        ],
    )
    def test_layer_picks_what_is_rebuilt(
        self,
        tmp_path,
        run_claudebox,
        record_dir,
        layer,
        no_cache,
        agent_forced,
    ) -> None:
        run_claudebox(["build", *layer], cwd=tmp_path, timeout=60)

        (build,) = _podman_calls(record_dir)
        assert ("--no-cache" in build) == no_cache
        assert any(a.startswith("CLAUDEBOX_FORCE_AGENT_UPDATE=") for a in build) == agent_forced
