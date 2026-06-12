"""End-to-end behavioral tests for ``claudebox update``.

Real-binary surface: install.sh missing → clean error + non-zero exit, no
Python traceback. The concurrent-blocked claim is re-anchored on a unit
test in tests/claudebox_cli/test_update_flock.py (the flock mechanism is
inside install.sh, not exercised at the e2e layer).
"""

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:update
# SPEC: cli:update:concurrent-blocked
class TestUpdateRouting:
    """``claudebox update`` shells out to install.sh; verify the dispatch surface."""

    def test_missing_install_sh_exits_non_zero(self, run_claudebox) -> None:
        # Hermetic HOME contains no ~/.claudebox/lib/bin/install.sh; cmd_update
        # reports the missing-script error cleanly (no Python traceback) and
        # exits non-zero.
        result = run_claudebox(["update"], timeout=10)
        assert result.returncode != 0
        assert "Traceback" not in result.stderr
        combined = result.stdout + result.stderr
        assert "install.sh" in combined
