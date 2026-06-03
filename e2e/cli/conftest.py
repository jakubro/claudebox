"""Shared fixtures for CLI behavioral end-to-end tests.

CLI e2e tests shell out to the real ``claudebox`` binary via subprocess and
assert on stdout/stderr/exit code — no mocks, no in-process imports.

Safety: this suite is intentionally excluded from ``just check`` / ``just
test`` because invoking the installed binary touches real host state. Run
``just test-e2e-cli`` explicitly when you want to exercise it.
"""

import os
import shutil
import subprocess
from collections.abc import Iterable
from pathlib import Path

import pytest


@pytest.fixture
def claudebox_bin() -> str:
    """Resolve the claudebox CLI binary path.

    Order: ``$PATH`` lookup → repo-local ``lib/bin/claudebox_cli.sh``. Skips
    when neither is available.
    """

    found = shutil.which("claudebox")
    if found:
        return found

    local = Path(__file__).resolve().parents[2] / "bin" / "claudebox_cli.sh"
    if local.exists():
        return str(local)

    pytest.skip("claudebox CLI binary not available")


@pytest.fixture
def run_claudebox(claudebox_bin):
    """Return a callable that invokes claudebox with given args, capturing output."""

    def _run(
        args: Iterable[str],
        *,
        cwd: Path | None = None,
        env: dict | None = None,
        timeout: int = 30,
    ) -> subprocess.CompletedProcess:
        return subprocess.run(
            [claudebox_bin, *args],
            capture_output=True,
            text=True,
            cwd=cwd,
            env={**os.environ, **(env or {})},
            timeout=timeout,
            check=False,
        )

    return _run
