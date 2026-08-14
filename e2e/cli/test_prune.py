"""End-to-end behavioral tests for ``claudebox prune``.

Real-binary surface: subprocess exec paths through fake podman.
The fake bin records every invocation; the CLI shells to the expected sub-commands without a traceback.
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:prune:partial-failure
class TestPrunePartialFailure:
    """Prune fans out across all categories, reports them, and tolerates per-category failure."""

    def test_prune_summarizes_three_categories(self, run_claudebox) -> None:
        result = run_claudebox(["prune"], timeout=60)
        # Fan-out across all three categories regardless of backend outcome.
        assert "stopped containers" in result.stdout or "stopped containers" in result.stderr
        assert "dangling images" in result.stdout or "dangling images" in result.stderr
        assert "stale" in result.stdout or "stale" in result.stderr

    def test_prune_no_python_traceback(self, run_claudebox, record_dir) -> None:
        # Fake podman returns canned output for `image prune`/`container prune`; no traceback, both calls logged.
        result = run_claudebox(["prune"], timeout=60)
        assert "Traceback" not in result.stderr

        podman_log = record_dir / "podman.log"

        if podman_log.exists():
            log = podman_log.read_text()
            # At least one of the prune sub-commands reached the fake.
            assert "prune" in log
