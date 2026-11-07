"""Tests for bin/install.sh's pinned downloads - a file runs or lands only when its digest is the manifest's."""

from __future__ import annotations

import hashlib
import io
import subprocess
import tarfile
from pathlib import Path

import pytest


IMAGE_PINS_SH = Path(__file__).resolve().parents[2] / "container" / "build" / "fs" / "_pins.sh"

CADDY_SCRIPT = "#!/bin/sh\necho 'v{version} h1:fake'\n"
NVM_INSTALLER = 'mkdir -p "$HOME/.nvm" && echo "nvm() { :; }" > "$HOME/.nvm/nvm.sh"\n'


def _tarball(path: Path, version: str) -> Path:
    payload = CADDY_SCRIPT.format(version=version).encode()

    with tarfile.open(path, "w:gz") as archive:
        info = tarfile.TarInfo("caddy")
        info.size = len(payload)
        info.mode = 0o755
        archive.addfile(info, io.BytesIO(payload))

    return path


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest(tmp_path: Path, *rows: str) -> Path:
    manifest = tmp_path / "host-pins.txt"
    manifest.write_text("# fixture\n" + "\n".join(rows) + "\n", encoding="utf-8")

    return manifest


def _drive(head: str, home: Path, manifest: Path, call: str) -> subprocess.CompletedProcess:
    driver = f"""
COLS=80
TMP_DIR=$(mktemp -d)
PLATFORM_OS=linux
PLATFORM_ARCH=amd64
{call}
echo "SURVIVED=yes"
"""

    return subprocess.run(
        ["bash"],
        input=head + driver,
        capture_output=True,
        text=True,
        env={"HOME": str(home), "PATH": "/usr/bin:/bin", "HOST_PINS": str(manifest)},
        check=False,
    )


@pytest.fixture
def home(tmp_path):
    home = tmp_path / "home"
    home.mkdir()

    return home


def _caddy_row(tarball: Path, version: str, sha256: str) -> str:
    return f"caddy {version} linux_amd64 {sha256} file://{tarball}"


class TestCaddy:
    """Caddy is fetched at the pinned version and installed only when its digest matches."""

    def test_a_matching_tarball_installs(self, install_sh_head, tmp_path, home):
        tarball = _tarball(tmp_path / "caddy.tar.gz", "2.0.0")
        manifest = _manifest(tmp_path, _caddy_row(tarball, "2.0.0", _sha256(tarball)))

        result = _drive(install_sh_head, home, manifest, "ensure_caddy")

        caddy = home / ".claudebox" / "bin" / "caddy"
        assert result.returncode == 0, result.stderr
        assert subprocess.run(
            [caddy, "version"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.startswith("v2.0.0")

    def test_an_altered_tarball_stops_the_install_and_leaves_the_binary_alone(
        self,
        install_sh_head,
        tmp_path,
        home,
    ):
        tarball = _tarball(tmp_path / "caddy.tar.gz", "2.0.0")
        expected = "0" * 64
        manifest = _manifest(tmp_path, _caddy_row(tarball, "2.0.0", expected))
        caddy = home / ".claudebox" / "bin" / "caddy"
        caddy.parent.mkdir(parents=True)
        caddy.write_text(CADDY_SCRIPT.format(version="1.0.0"), encoding="utf-8")
        caddy.chmod(0o755)
        before = caddy.read_bytes()

        result = _drive(install_sh_head, home, manifest, "ensure_caddy")

        assert result.returncode == 1
        assert "SURVIVED=yes" not in result.stdout
        assert f"has sha256 {_sha256(tarball)}, the manifest pins {expected}" in result.stderr
        assert f"file://{tarball}" in result.stderr
        assert caddy.read_bytes() == before

    def test_an_installed_caddy_at_another_version_is_replaced(
        self,
        install_sh_head,
        tmp_path,
        home,
    ):
        tarball = _tarball(tmp_path / "caddy.tar.gz", "2.0.0")
        manifest = _manifest(tmp_path, _caddy_row(tarball, "2.0.0", _sha256(tarball)))
        caddy = home / ".claudebox" / "bin" / "caddy"
        caddy.parent.mkdir(parents=True)
        caddy.write_text(CADDY_SCRIPT.format(version="1.9.0"), encoding="utf-8")
        caddy.chmod(0o755)

        result = _drive(install_sh_head, home, manifest, "ensure_caddy")

        assert result.returncode == 0, result.stderr
        assert "v2.0.0" in caddy.read_text(encoding="utf-8")

    @pytest.mark.parametrize("installed", ["2.0.0-beta.1", "2.0.01"])
    def test_an_installed_caddy_whose_version_only_starts_with_the_pin_is_replaced(
        self,
        install_sh_head,
        tmp_path,
        home,
        installed,
    ):
        tarball = _tarball(tmp_path / "caddy.tar.gz", "2.0.0")
        manifest = _manifest(tmp_path, _caddy_row(tarball, "2.0.0", _sha256(tarball)))
        caddy = home / ".claudebox" / "bin" / "caddy"
        caddy.parent.mkdir(parents=True)
        caddy.write_text(CADDY_SCRIPT.format(version=installed), encoding="utf-8")
        caddy.chmod(0o755)

        result = _drive(install_sh_head, home, manifest, "ensure_caddy")

        assert result.returncode == 0, result.stderr
        assert "v2.0.0 h1" in caddy.read_text(encoding="utf-8")

    def test_an_installed_caddy_at_the_pinned_version_is_kept(
        self,
        install_sh_head,
        tmp_path,
        home,
    ):
        manifest = _manifest(tmp_path, _caddy_row(tmp_path / "absent.tar.gz", "2.0.0", "1" * 64))
        caddy = home / ".claudebox" / "bin" / "caddy"
        caddy.parent.mkdir(parents=True)
        caddy.write_text(CADDY_SCRIPT.format(version="2.0.0") + "# kept\n", encoding="utf-8")
        caddy.chmod(0o755)

        result = _drive(install_sh_head, home, manifest, "ensure_caddy")

        assert result.returncode == 0, result.stderr
        assert caddy.read_text(encoding="utf-8").endswith("# kept\n")


class TestNvm:
    """nvm's installer runs from a file, and only once its digest matches."""

    def test_a_matching_installer_runs(self, install_sh_head, tmp_path, home):
        installer = tmp_path / "install.sh"
        installer.write_text(NVM_INSTALLER, encoding="utf-8")
        manifest = _manifest(tmp_path, f"nvm 0.1.0 * {_sha256(installer)} file://{installer}")

        result = _drive(install_sh_head, home, manifest, "ensure_nvm")

        assert result.returncode == 0, result.stderr
        assert (home / ".nvm" / "nvm.sh").is_file()

    def test_an_altered_installer_never_runs(self, install_sh_head, tmp_path, home):
        installer = tmp_path / "install.sh"
        installer.write_text(NVM_INSTALLER, encoding="utf-8")
        manifest = _manifest(tmp_path, f"nvm 0.1.0 * {'0' * 64} file://{installer}")

        result = _drive(install_sh_head, home, manifest, "ensure_nvm")

        assert result.returncode == 1
        assert not (home / ".nvm").exists()


class TestTwoReaders:
    """The installer's reader and the image build's read one manifest identically."""

    QUERIES = (
        ("caddy", "linux_amd64", "version"),
        ("caddy", "linux_amd64", "url"),
        ("caddy", "linux_arm64", "sha256"),
        ("nvm", "linux_amd64", "url"),
        ("node", "-", "version"),
        ("missing", "linux_amd64", "version"),
    )

    ROWS = (
        "caddy 2.0.0 linux_amd64 "
        + "a" * 64
        + " https://example.invalid/v{version}/caddy_{version}_amd64.tgz",
        "caddy 2.0.0 linux_arm64 "
        + "b" * 64
        + " https://example.invalid/v{version}/caddy_{version}_arm64.tgz  # trailing",
        "nvm 0.1.0 * " + "c" * 64 + " https://example.invalid/nvm/v{version}/install.sh",
        "node 24.0.1 - - -",
        "float something npm:x a reason",
    )

    def test_both_answer_every_query_alike(self, install_sh_head, tmp_path, home):
        manifest = _manifest(tmp_path, *self.ROWS)
        calls = "\n".join(
            f'pin_field "$HOST_PINS" {n} {p!r} {f}; echo "rc=$?"' for n, p, f in self.QUERIES
        )
        installer = _drive(install_sh_head, home, manifest, "set +e\n" + calls)
        image = subprocess.run(
            [
                "bash",
                "-c",
                f'source "{IMAGE_PINS_SH}" 2>/dev/null\nHOST_PINS="{manifest}"\n{calls}',
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        answers = installer.stdout.replace("SURVIVED=yes\n", "")
        assert answers == image.stdout
        assert "https://example.invalid/v2.0.0/caddy_2.0.0_amd64.tgz" in answers
        assert "24.0.1" in answers
        assert answers.count("rc=1") == 1
