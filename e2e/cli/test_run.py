"""End-to-end behavioral tests for ``claudebox run``.

Real-binary surface: the no-auto-register contract — ``run`` MUST NOT write
a ``.workspace`` marker, even when the cwd is unregistered.
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:run:workspace-fallback
# SPEC: cli:run:no-auto-register
class TestRunWorkspaceFallback:
    """``claudebox run`` in an unregistered cwd falls back silently — no marker file."""

    def test_run_in_unregistered_cwd_falls_back(self, tmp_path, run_claudebox) -> None:
        # No .workspace marker exists or gets created. The container backend
        # is fake podman — the actual launch outcome is irrelevant; the contract
        # under test is filesystem-side absence of the marker file.
        result = run_claudebox(["run", "--", "-p", "echo smoke"], cwd=tmp_path, timeout=60)
        assert not (tmp_path / ".workspace").exists()
        assert result.returncode is not None
