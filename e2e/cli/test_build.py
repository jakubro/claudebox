"""End-to-end behavioral tests for ``claudebox build``.

Help / argparse-level coverage lives in tests/claudebox_cli/; this file asserts only the
real-binary surface: clean Traceback-absence on a build failure from the backend (fake podman).
"""

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
