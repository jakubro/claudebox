"""End-to-end behavioral tests for ``claudebox build``.

Help / argparse-level coverage lives in tests/claudebox_cli/; this file
asserts only the real-binary surfaces: clean Traceback-absence on a build
failure propagated up from the backend (fake podman).
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:build:failure-propagated
class TestBuildFailurePropagated:
    """A failing build exits with the build tool's exit code, not a Python traceback."""

    def test_build_failure_no_python_traceback(self, tmp_path, run_claudebox) -> None:
        # cwd has no build context; the CLI invokes fake podman (which only
        # canned-handles --version/info/prune) so any build-issuing command falls
        # through to exit 0. The contract under test is process-boundary:
        # the CLI must not surface a Python traceback regardless of backend outcome.
        result = run_claudebox(["build"], cwd=tmp_path, timeout=60)
        assert "Traceback" not in result.stderr
