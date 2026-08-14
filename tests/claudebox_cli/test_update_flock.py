"""Anchor for SPEC ``cli:update:concurrent-blocked``.

The flock blocking concurrent ``claudebox update`` lives in ``install.sh`` (shell-level), not the
Python CLI - ``cmd_update`` only spawns it and propagates its exit code. This test exercises the
user-visible half: when install.sh signals concurrent-blocked (non-zero exit), ``handle()``
propagates it cleanly, without a Python traceback.

The real flock semantics (locking, race avoidance) are out of scope here - exercised by invoking
the wrapper twice in parallel against a real install.sh.
"""

import argparse
import subprocess
from pathlib import Path
from typing import Any

import pytest

from claudebox_cli import cmd_update


@pytest.fixture
def fake_install_sh(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Place a fake install.sh under a controlled ~/.claudebox/lib/bin/."""

    fake_home = tmp_path / "_home"
    fake_home.mkdir(exist_ok=True)
    bin_dir = fake_home / ".claudebox" / "lib" / "bin"
    bin_dir.mkdir(parents=True)
    install_sh = bin_dir / "install.sh"
    install_sh.write_text("#!/bin/bash\nexit 0\n")
    install_sh.chmod(0o755)

    monkeypatch.setattr(Path, "home", staticmethod(lambda: fake_home))

    return install_sh


# Formal SPEC anchor is in e2e/cli/test_update.py (SPEC markers are e2e-only); this covers the in-process half.
class TestUpdateConcurrentBlocked:
    """``cmd_update`` propagates install.sh's non-zero exit when concurrent invocation is blocked."""

    def test_propagates_flock_rejection_exit_code(
        self,
        fake_install_sh: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        # Simulates install.sh's flock failure; the contract under test is propagation, not the specific code.
        def _fake_run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
            return subprocess.CompletedProcess[bytes](args=cmd, returncode=42)

        monkeypatch.setattr(subprocess, "run", _fake_run)

        args = argparse.Namespace(verbose=False)
        exit_code = cmd_update.handle(args)

        assert exit_code == 42
