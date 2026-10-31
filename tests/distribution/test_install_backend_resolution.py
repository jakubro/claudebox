"""Tests for bin/install.sh's backend resolution - the step that reads, defaults and persists the
container runtime, exercised against the shipped file rather than a transcription of it."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


# Drives the two config functions in main()'s order. COLS is what main() would have computed;
# CLAUDEBOX_BACKEND mirrors its own default so an absent variable is not an unbound one.
DRIVER = """
COLS=80
CLAUDEBOX_BACKEND=${CLAUDEBOX_BACKEND:-}
install_config
resolve_backend
echo "BACKEND=$CLAUDEBOX_BACKEND"
"""

# Fails at install_config's copy, the earliest step that can fail against a home with no library.
FAILING_DRIVER = """
COLS=80
install_config
echo "NOT REACHED"
"""


def _home_with_library(tmp_path: Path, lib_root: Path) -> Path:
    """Build a scratch home whose ~/.claudebox/lib points at the shipped library."""

    home = tmp_path / "home"
    (home / ".claudebox").mkdir(parents=True)
    (home / ".claudebox" / "lib").symlink_to(lib_root)

    return home


def _drive(head: str, driver: str, home: Path, **env: str) -> subprocess.CompletedProcess:
    """Source the shipped installer and run one driver against the given home."""

    return subprocess.run(
        ["bash"],
        input=head + driver,
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin", **env},
        check=False,
    )


def _settings(home: Path) -> str:
    """Read the settings file the installer wrote into the scratch home."""

    return (home / ".claudebox" / "settings.toml").read_text(encoding="utf-8")


def _backend_lines(settings: str) -> list[str]:
    """Every uncommented backend assignment in a settings file."""

    return re.findall(r'(?m)^backend\s*=\s*"[^"]*"$', settings)


class TestBackendResolution:
    """What the installer resolves the container runtime to, and what it leaves on disk."""

    def test_a_fresh_install_resolves_the_default_backend(
        self,
        install_sh_head,
        lib_root,
        tmp_path,
    ):
        home = _home_with_library(tmp_path, lib_root)

        result = _drive(install_sh_head, DRIVER, home)

        assert result.returncode == 0, result.stderr
        assert "BACKEND=podman" in result.stdout

    def test_the_shipped_sample_leaves_the_key_commented(self, lib_root):
        sample = (lib_root / "etc" / "settings.sample.toml").read_text(encoding="utf-8")

        # The state the resolution has to survive: the key is documentation, not a value.
        assert _backend_lines(sample) == []

    def test_the_first_run_writes_the_backend_it_resolved(
        self,
        install_sh_head,
        lib_root,
        tmp_path,
    ):
        home = _home_with_library(tmp_path, lib_root)

        _drive(install_sh_head, DRIVER, home)

        assert _backend_lines(_settings(home)) == ['backend = "podman"']

    def test_a_second_run_reads_the_value_the_first_wrote(
        self,
        install_sh_head,
        lib_root,
        tmp_path,
    ):
        home = _home_with_library(tmp_path, lib_root)
        _drive(install_sh_head, DRIVER, home)

        result = _drive(install_sh_head, DRIVER, home)

        assert result.returncode == 0, result.stderr
        assert "BACKEND=podman" in result.stdout
        assert _backend_lines(_settings(home)) == ['backend = "podman"']

    def test_the_environment_wins_over_the_settings_file(self, install_sh_head, lib_root, tmp_path):
        home = _home_with_library(tmp_path, lib_root)

        result = _drive(install_sh_head, DRIVER, home, CLAUDEBOX_BACKEND="docker")

        assert "BACKEND=docker" in result.stdout
        assert _backend_lines(_settings(home)) == ['backend = "docker"']

    def test_a_settings_file_without_the_key_resolves_the_default(
        self,
        install_sh_head,
        lib_root,
        tmp_path,
    ):
        home = _home_with_library(tmp_path, lib_root)
        (home / ".claudebox" / "settings.toml").write_text("root = true\n", encoding="utf-8")

        result = _drive(install_sh_head, DRIVER, home)

        assert result.returncode == 0, result.stderr
        assert "BACKEND=podman" in result.stdout


class TestAbortReporting:
    """What a failing command says before strict mode ends the installer."""

    def test_an_aborting_command_names_itself(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        home.mkdir()

        result = _drive(install_sh_head, FAILING_DRIVER, home)

        assert result.returncode == 1
        assert "error: aborted at line" in result.stderr
        assert "cp -n" in result.stderr
        assert "(exit 1)" in result.stderr

    def test_an_aborted_run_stops_where_it_failed(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        home.mkdir()

        result = _drive(install_sh_head, FAILING_DRIVER, home)

        assert "NOT REACHED" not in result.stdout
