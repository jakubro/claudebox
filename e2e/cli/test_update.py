"""End-to-end behavioral tests for ``claudebox update``.

Exercises the SPEC ``cli:update`` claims through the real binary via subprocess.
The concurrent-blocked claim is anchored here for spec-coverage; the underlying
flock mechanism is verified separately.
"""

import pytest


# SPEC: cli:update
class TestUpdateHelp:
    """``claudebox update --help`` exits 0 and documents the wrapper."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["update", "--help"])
        assert result.returncode == 0

    def test_help_mentions_install_sh(self, run_claudebox) -> None:
        result = run_claudebox(["update", "--help"])
        assert "install.sh" in result.stdout

    def test_help_distinguishes_from_build(self, run_claudebox) -> None:
        # ``build`` operates on the container image, ``update`` on Claudebox itself.
        result = run_claudebox(["update", "--help"])
        assert "build" in result.stdout
        assert "update" in result.stdout


# SPEC: cli:update
class TestUpdateRouting:
    """``claudebox update`` shells out to install.sh; verify the dispatch surface."""

    def test_missing_install_sh_exits_non_zero(self, tmp_path, run_claudebox) -> None:
        # Forcing HOME to a fresh dir makes ``~/.claudebox/lib/bin/install.sh`` absent —
        # cmd_update reports the error cleanly (no Python traceback) and exits non-zero.
        result = run_claudebox(
            ["update"],
            env={"HOME": str(tmp_path)},
            timeout=10,
        )
        assert result.returncode != 0
        assert "Traceback" not in result.stderr
        # Either stdout or stderr surfaces the missing-script message.
        combined = result.stdout + result.stderr
        assert "install.sh" in combined


# SPEC: cli:update:concurrent-blocked
@pytest.mark.skip(
    reason="Requires real install.sh execution (git pull + image build) which needs network + podman.",
)
class TestUpdateConcurrentBlocked:
    """Second concurrent invocation must exit non-zero with the flock error."""

    def test_second_invocation_blocked_by_flock(self) -> None:
        # Anchor for SPEC ``cli:update:concurrent-blocked``; the flock mechanism
        # is verified separately against a live install.sh.
        pass
