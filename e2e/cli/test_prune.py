"""End-to-end behavioral tests for ``claudebox prune``.

Exercises the SPEC ``cli:prune:*`` claim set through the real binary via
subprocess. Tests run regardless of podman availability — when podman is
missing, prune surfaces per-category failures and exits non-zero (which
is exactly the ``partial-failure`` contract).
"""


# SPEC: cli:prune
class TestPruneHelp:
    """``claudebox prune --help`` documents prune's surface."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["prune", "--help"])
        assert result.returncode == 0

    def test_help_mentions_components(self, run_claudebox) -> None:
        result = run_claudebox(["prune", "--help"])
        assert "stale" in result.stdout
        assert "image" in result.stdout
        assert "container" in result.stdout


# SPEC: cli:prune:partial-failure
class TestPrunePartialFailure:
    """A failure in one prune category does not abort the rest; exit non-zero on any failure."""

    def test_prune_summarizes_three_categories(self, run_claudebox) -> None:
        result = run_claudebox(["prune"], timeout=60)
        # Whether or not the backend is available, prune always reports
        # all three categories (stale dirs, images, containers).
        assert "stopped containers" in result.stdout or "stopped containers" in result.stderr
        assert "dangling images" in result.stdout or "dangling images" in result.stderr
        assert "stale" in result.stdout or "stale" in result.stderr

    def test_prune_no_python_traceback_when_backend_missing(self, run_claudebox) -> None:
        # Even when podman fails, prune must not surface a Python traceback;
        # the failure is captured per-category and reported via the fail
        # icon.
        result = run_claudebox(
            ["prune"],
            env={"PATH": "/nonexistent"},
            timeout=60,
        )
        assert "Traceback" not in result.stderr
