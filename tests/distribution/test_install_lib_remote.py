"""Tests for bin/install.sh's install_lib_remote - fetch-and-reset in place, and the staged-clone
fallback that never removes the existing install before a replacement exists - against the real file."""

from __future__ import annotations

import shlex
import subprocess
from pathlib import Path

import pytest


SHIPPED_GITIGNORE = Path(__file__).parents[2] / ".gitignore"
BUILD_PRODUCTS = [".venv/bin/python", "src/claudebox_frontend/dist/index.html"]

DRIVER = """
COLS=80
install_lib_remote {source}
echo "EXIT=$?"
"""


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _make_remote(tmp_path: Path) -> Path:
    """A real bare git repo other helpers clone from and push updates into, ignoring what ships."""

    remote = tmp_path / "remote"
    remote.mkdir()
    _git("init", "--bare", "-b", "main", cwd=remote)
    _seed(remote, tmp_path, "v1")

    return remote


def _seed(remote: Path, tmp_path: Path, content: str) -> None:
    """Push one commit carrying marker.txt=content and the shipped .gitignore into the bare remote."""

    work = tmp_path / f"_seed-{content}"
    _git("clone", str(remote), str(work), cwd=tmp_path)
    (work / "marker.txt").write_text(content, encoding="utf-8")
    (work / ".gitignore").write_text(
        SHIPPED_GITIGNORE.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    _git("add", "marker.txt", ".gitignore", cwd=work)
    _git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", content, cwd=work)
    _git("push", "origin", "main", cwd=work)


def _clone_into(remote: Path, lib_dir: Path) -> None:
    """Clone the remote into ~/.claudebox/lib, the shape install_lib_remote expects to find."""

    lib_dir.parent.mkdir(parents=True, exist_ok=True)
    _git("clone", str(remote), str(lib_dir), cwd=lib_dir.parent)


def _drive(head: str, home: Path, source: Path | str) -> subprocess.CompletedProcess:
    driver = DRIVER.format(source=shlex.quote(str(source)))

    return subprocess.run(
        ["bash"],
        input=head + driver,
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin"},
        check=False,
    )


class TestOrdinaryUpdate:
    """A reachable remote with a valid existing clone."""

    def test_updates_in_place_to_the_new_revision(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        _seed(remote, tmp_path, "v2")

        result = _drive(install_sh_head, home, remote)

        assert "EXIT=0" in result.stdout, result.stderr
        assert (lib_dir / "marker.txt").read_text(encoding="utf-8") == "v2"
        assert (lib_dir / ".git").is_dir()


class TestNetworkDown:
    """The remote itself is unreachable - neither fetch nor a fallback clone can succeed."""

    def test_the_existing_installation_is_left_untouched(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        before = (lib_dir / "marker.txt").read_text(encoding="utf-8")
        # The clone's own origin points at `remote`, not the passed argument - so the remote itself
        # must vanish too, for both the in-place fetch and the fallback clone to fail alike.
        subprocess.run(["rm", "-rf", str(remote)], check=True)

        result = _drive(install_sh_head, home, remote)

        assert result.returncode == 1
        assert "error: aborted at line" in result.stderr
        assert (lib_dir / "marker.txt").read_text(encoding="utf-8") == before
        assert (lib_dir / ".git").is_dir()

    def test_reports_the_failure_reason(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        subprocess.run(["rm", "-rf", str(remote)], check=True)

        result = _drive(install_sh_head, home, remote)

        assert "git fetch failed" in result.stdout
        assert "staged clone also failed" in result.stdout


class TestFetchFailsLocally:
    """The existing clone's own git state is unreadable, but the remote is still reachable."""

    def test_falls_back_to_a_staged_clone_that_replaces_it(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        _seed(remote, tmp_path, "v2")
        # git itself cannot read this - not a "local edits" case, a broken repository.
        subprocess.run(["rm", "-rf", str(lib_dir / ".git")], check=True)

        result = _drive(install_sh_head, home, remote)

        assert "EXIT=0" in result.stdout, result.stderr
        assert "Falling back to a staged clone" in result.stdout
        assert (lib_dir / "marker.txt").read_text(encoding="utf-8") == "v2"
        assert (lib_dir / ".git").is_dir()

    def test_never_leaves_the_library_absent_even_on_double_failure(
        self,
        install_sh_head,
        tmp_path,
    ):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        subprocess.run(["rm", "-rf", str(lib_dir / ".git")], check=True)

        _drive(install_sh_head, home, tmp_path / "also-gone")

        # Neither update_lib_in_place nor stage_and_swap_lib can succeed; lib.new/lib.old must
        # not be left in place of the real directory, whatever the outcome.
        assert lib_dir.is_dir()
        assert (lib_dir / "marker.txt").exists()


class TestLocalEditsAreDiscarded:
    """A tracked-file edit and an untracked file, both present when the update runs."""

    def test_reset_to_the_remote_and_names_what_was_discarded(self, install_sh_head, tmp_path):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        (lib_dir / "marker.txt").write_text("locally-edited", encoding="utf-8")
        (lib_dir / "scratch.txt").write_text("untracked", encoding="utf-8")

        result = _drive(install_sh_head, home, remote)

        assert "EXIT=0" in result.stdout, result.stderr
        assert (lib_dir / "marker.txt").read_text(encoding="utf-8") == "v1"
        assert not (lib_dir / "scratch.txt").exists()
        assert "discarding local changes" in result.stdout
        assert "marker.txt" in result.stdout
        assert "scratch.txt" in result.stdout


class TestSymlinksResolveThroughout:
    """A symlink into the library, as the entry points and systemd units are in a real install."""

    def test_a_symlink_into_the_library_still_resolves_after_a_staged_swap(
        self,
        install_sh_head,
        tmp_path,
    ):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        subprocess.run(["rm", "-rf", str(lib_dir / ".git")], check=True)
        entry_point = home / "entry"
        entry_point.symlink_to(lib_dir / "marker.txt")

        result = _drive(install_sh_head, home, remote)

        assert "EXIT=0" in result.stdout, result.stderr
        assert entry_point.is_symlink()
        assert entry_point.read_text(encoding="utf-8") == "v1"


def _with_build_products(lib_dir: Path) -> None:
    for product in BUILD_PRODUCTS:
        (lib_dir / product).parent.mkdir(parents=True, exist_ok=True)
        (lib_dir / product).write_text(f"built {product}", encoding="utf-8")


@pytest.mark.parametrize("product", BUILD_PRODUCTS)
class TestBuildProductsSurvive:
    """The virtualenv and built UI the running daemon uses outlive an update on either path."""

    def test_an_in_place_update_keeps_them(self, install_sh_head, tmp_path, product):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        _with_build_products(lib_dir)
        _seed(remote, tmp_path, "v2")

        result = _drive(install_sh_head, home, remote)

        assert "EXIT=0" in result.stdout, result.stderr
        assert (lib_dir / "marker.txt").read_text(encoding="utf-8") == "v2"
        assert (lib_dir / product).read_text(encoding="utf-8") == f"built {product}"

    def test_the_staged_clone_fallback_carries_them(self, install_sh_head, tmp_path, product):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        _with_build_products(lib_dir)
        _seed(remote, tmp_path, "v2")
        subprocess.run(["rm", "-rf", str(lib_dir / ".git")], check=True)

        result = _drive(install_sh_head, home, remote)

        assert "EXIT=0" in result.stdout, result.stderr
        assert "Falling back to a staged clone" in result.stdout
        assert (lib_dir / "marker.txt").read_text(encoding="utf-8") == "v2"
        assert (lib_dir / product).read_text(encoding="utf-8") == f"built {product}"
        assert not (lib_dir.parent / "lib.new").exists()
        assert not (lib_dir.parent / "lib.old").exists()

    def test_they_are_not_named_as_discarded(self, install_sh_head, tmp_path, product):
        home = tmp_path / "home"
        remote = _make_remote(tmp_path)
        lib_dir = home / ".claudebox" / "lib"
        _clone_into(remote, lib_dir)
        _with_build_products(lib_dir)
        (lib_dir / "scratch.txt").write_text("untracked", encoding="utf-8")

        result = _drive(install_sh_head, home, remote)

        discarded = [
            line for line in result.stdout.splitlines() if "discarding local changes" in line
        ]
        assert discarded
        assert (".venv" if product.startswith(".venv") else "dist") not in discarded[0]
