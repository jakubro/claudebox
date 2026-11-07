"""Tests for install.sh's watchdog step - the unit runs sandboxed where the host allows it, and runs regardless."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest


DRIVER = """
COLS=80
install_watchdog_timer
echo "SURVIVED=yes"
"""


def _bin(directory: Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(f"#!/bin/bash\n{body}\n", encoding="utf-8")
    path.chmod(0o755)


def _drive(head: str, home: Path, bin_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash"],
        input=head + DRIVER,
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin"},
        check=False,
    )


@pytest.fixture
def home(tmp_path):
    home = tmp_path / "home"
    home.mkdir()

    return home


@pytest.fixture
def bin_dir(tmp_path):
    directory = tmp_path / "bin"
    directory.mkdir()
    _bin(directory, "systemctl", f'echo "$*" >> "{tmp_path}/systemctl.log"')

    return directory


def _dropin(home: Path) -> Path:
    return (
        home / ".config" / "systemd" / "user" / "claudebox-watchdog.service.d" / "unsandboxed.conf"
    )


def test_a_host_that_sandboxes_gets_no_dropin_and_loses_a_stale_one(install_sh_head, home, bin_dir):
    _bin(bin_dir, "systemd-run", "exit 0")
    _dropin(home).parent.mkdir(parents=True)
    _dropin(home).write_text("[Service]\nNoNewPrivileges=no\n", encoding="utf-8")

    result = _drive(install_sh_head, home, bin_dir)

    assert "SURVIVED=yes" in result.stdout, result.stderr
    assert not _dropin(home).exists()
    assert "cannot sandbox" not in result.stdout + result.stderr


def test_a_host_that_cannot_sandbox_turns_the_four_options_off_and_warns(
    install_sh_head,
    home,
    bin_dir,
    tmp_path,
):
    _bin(bin_dir, "systemd-run", "exit 1")

    result = _drive(install_sh_head, home, bin_dir)

    assert "SURVIVED=yes" in result.stdout, result.stderr
    assert _dropin(home).read_text(encoding="utf-8").splitlines() == [
        "[Service]",
        "NoNewPrivileges=no",
        "PrivateTmp=no",
        "ProtectSystem=no",
        "ProtectHome=no",
    ]
    assert "this host cannot sandbox a user unit" in result.stdout + result.stderr
    assert "enable --now claudebox-watchdog.timer" in (tmp_path / "systemctl.log").read_text(
        encoding="utf-8",
    )


def test_without_systemd_the_step_is_skipped(install_sh_head, home, tmp_path):
    empty = tmp_path / "empty-bin"
    empty.mkdir()

    result = subprocess.run(
        ["/bin/bash"],
        input=install_sh_head + DRIVER,
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": str(empty)},
        check=False,
    )

    assert "SURVIVED=yes" in result.stdout, result.stderr
    assert "skipping daemon watchdog" in result.stdout + result.stderr
    assert not (home / ".config").exists()
