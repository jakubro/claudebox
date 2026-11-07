"""Tests for bin/install.sh's nvm handling - where it fetches the installer from, and whether it can
tell that one is already present, exercised against the shipped file rather than a transcription."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


# `source_nvm` reports through its exit status, so the driver turns that into a line to assert on.
DRIVER = """
COLS=80
if source_nvm; then echo "SOURCE_NVM=ok"; else echo "SOURCE_NVM=fail"; fi
echo "SURVIVED=yes"
"""

# Enough for `[[ -s ]]` and for sourcing to be harmless.
FAKE_NVM_SH = "nvm() { :; }\n"


def _install_nvm(directory: Path) -> Path:
    """Place a fake nvm installation and return its directory."""

    directory.mkdir(parents=True, exist_ok=True)
    (directory / "nvm.sh").write_text(FAKE_NVM_SH, encoding="utf-8")

    return directory


def _drive(head: str, home: Path, **env: str) -> subprocess.CompletedProcess:
    """Source the shipped installer and ask it whether nvm is available."""

    return subprocess.run(
        ["bash"],
        input=head + DRIVER,
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin", **env},
        check=False,
    )


class TestNvmDetection:
    """Whether an already-installed nvm is found, per where it lives."""

    def test_nvm_at_the_default_location_is_found(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        _install_nvm(home / ".nvm")

        result = _drive(install_sh_head, home)

        assert "SOURCE_NVM=ok" in result.stdout, result.stderr

    def test_nvm_at_a_custom_location_is_found(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        home.mkdir()
        elsewhere = _install_nvm(tmp_path / "opt" / "nvm")

        result = _drive(install_sh_head, home, NVM_DIR=str(elsewhere))

        assert "SOURCE_NVM=ok" in result.stdout, result.stderr

    def test_a_custom_location_wins_over_the_default(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        _install_nvm(home / ".nvm")
        elsewhere = tmp_path / "opt" / "nvm"
        elsewhere.mkdir(parents=True)

        result = _drive(install_sh_head, home, NVM_DIR=str(elsewhere))

        # NVM_DIR names a directory with no nvm.sh, so detection must report absence, not fall back.
        assert "SOURCE_NVM=fail" in result.stdout, result.stderr

    def test_absent_nvm_reports_absence_without_ending_the_run(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        home.mkdir()

        result = _drive(install_sh_head, home)

        assert "SOURCE_NVM=fail" in result.stdout, result.stderr
        assert "SURVIVED=yes" in result.stdout
        assert result.returncode == 0


class TestNvmInstallerUrl:
    """Which upstream file the installer fetches."""

    def test_the_pinned_url_names_a_release_tags_shell_script(self, lib_root):
        rows = [
            line.split()
            for line in (lib_root / "etc" / "host-pins.txt")
            .read_text(encoding="utf-8")
            .splitlines()
            if line.split()[:1] == ["nvm"]
        ]

        assert rows, "the host manifest pins no nvm installer"
        # Upstream serves the installer at install.sh; the extensionless path 404s.
        assert all(
            re.fullmatch(
                r"https://raw\.githubusercontent\.com/nvm-sh/nvm/v\{version\}/install\.sh",
                row[4],
            )
            for row in rows
        ), rows
