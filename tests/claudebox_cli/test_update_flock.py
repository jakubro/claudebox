"""Anchor for SPEC ``cli:update:concurrent-blocked``.

The flock that blocks concurrent ``claudebox update`` invocations lives inside
``install.sh`` (shell-level), not in the Python CLI. ``cmd_update`` only spawns
install.sh and propagates its exit code. This unit test anchors the SPEC claim
by exercising the user-visible half of the contract: when install.sh signals
concurrent-blocked (any non-zero exit code), ``cmd_update.handle()`` returns the
propagated exit code without a Python traceback or other corruption of the
error surface.

The shell-level flock semantics (file locking, race avoidance) are out of
scope here - they belong to install.sh and are exercised when the wrapper
is invoked twice in parallel against a real install.sh.
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
    fake_home.mkdir()
    bin_dir = fake_home / ".claudebox" / "lib" / "bin"
    bin_dir.mkdir(parents=True)
    install_sh = bin_dir / "install.sh"
    install_sh.write_text("#!/bin/bash\nexit 0\n")
    install_sh.chmod(0o755)

    monkeypatch.setattr(Path, "home", staticmethod(lambda: fake_home))

    return install_sh


# Anchor for SPEC ``cli:update:concurrent-blocked`` lives in e2e/cli/test_update.py
# (GUIDELINES.md §8 - SPEC markers are e2e-only). This unit test verifies the
# user-visible half of the contract in-process.
class TestUpdateConcurrentBlocked:
    """``cmd_update`` propagates install.sh's non-zero exit when concurrent invocation is blocked."""

    def test_propagates_flock_rejection_exit_code(
        self, fake_install_sh: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Simulate install.sh's flock failure path: subprocess.run returns a
        # CompletedProcess with non-zero returncode (the shell-level flock would
        # exit with a specific code; the contract here is exit-code propagation).
        def _fake_run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
            return subprocess.CompletedProcess[bytes](args=cmd, returncode=42)

        monkeypatch.setattr(subprocess, "run", _fake_run)

        args = argparse.Namespace(verbose=False)
        exit_code = cmd_update.handle(args)

        assert exit_code == 42
