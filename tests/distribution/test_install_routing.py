"""Tests for bin/install.sh's remote-vs-local routing - the branch that decides where the library
comes from, exercised against the shipped file rather than a transcription of it."""

from __future__ import annotations

import subprocess
from pathlib import Path


# Replaces the two installation functions, so the routing runs without the rest of the installer.
DRIVER = """
install_lib_remote() { echo "BRANCH=remote SOURCE=$1"; }
install_lib_symlink() { echo "BRANCH=symlink SOURCE=$1"; }
REMOTE_SOURCE_PATH=https://example.invalid/claudebox
install_lib
"""


def _route(head: str, home: Path, cwd: Path, *, piped: bool) -> str:
    """Run install.sh's routing and return its BRANCH=... SOURCE=... line."""

    source = head + DRIVER
    env = {"HOME": str(home), "PATH": "/usr/bin:/bin"}

    if piped:
        argv = ["bash"]
    else:
        script = cwd / "bin" / "install.sh"
        script.parent.mkdir(parents=True, exist_ok=True)
        script.write_text(source, encoding="utf-8")
        argv = ["bash", str(script)]
        source = ""

    result = subprocess.run(
        argv,
        input=source,
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
        check=True,
    )

    return next(line for line in result.stdout.splitlines() if line.startswith("BRANCH="))


class TestInstallLibRouting:
    """Where the library comes from, per execution context."""

    def test_piped_to_bash_installs_from_the_remote(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        home.mkdir()
        project = tmp_path / "work" / "proj"
        project.mkdir(parents=True)

        assert _route(install_sh_head, home, project, piped=True).startswith("BRANCH=remote")

    def test_piped_to_bash_never_points_the_library_outside_claudebox(
        self,
        install_sh_head,
        tmp_path,
    ):
        home = tmp_path / "home"
        home.mkdir()
        project = tmp_path / "work" / "proj"
        project.mkdir(parents=True)

        route = _route(install_sh_head, home, project, piped=True)

        assert str(tmp_path / "work") not in route

    def test_run_from_a_checkout_symlinks_that_checkout(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        home.mkdir()
        checkout = tmp_path / "checkout"
        checkout.mkdir()

        route = _route(install_sh_head, home, checkout, piped=False)

        assert route == f"BRANCH=symlink SOURCE={checkout}"

    def test_run_from_an_installed_clone_updates_it_instead_of_relinking(
        self,
        install_sh_head,
        tmp_path,
    ):
        home = tmp_path / "home"
        clone = home / ".claudebox" / "lib"
        clone.mkdir(parents=True)

        assert _route(install_sh_head, home, clone, piped=False).startswith("BRANCH=remote")

    def test_run_through_the_installed_symlink_relinks_its_target(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        (home / ".claudebox").mkdir(parents=True)
        checkout = tmp_path / "checkout"
        (checkout / "bin").mkdir(parents=True)
        (home / ".claudebox" / "lib").symlink_to(checkout)

        route = _route(install_sh_head, home, checkout, piped=False)

        assert route == f"BRANCH=symlink SOURCE={checkout}"
