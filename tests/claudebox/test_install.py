"""Tests for install metadata: the version an install reports and the line that renders it."""

from __future__ import annotations

import subprocess
from pathlib import Path

from claudebox import install
from claudebox.install import format_install_info, get_install_info


_SYNTHETIC = {
    "version": "(unknown)",
    "branch": "v51",
    "commit": "76a76a9",
    "path": Path("/opt/example/lib/claudebox"),
    "python": "3.12.11",
}


class TestFormatInstallInfo:
    """format_install_info renders a single readable line, never a raw dict."""

    def test_renders_all_fields_on_one_line(self):
        line = format_install_info(_SYNTHETIC)

        assert "\n" not in line
        assert "v51" in line
        assert "76a76a9" in line
        assert "/opt/example/lib/claudebox" in line
        assert "3.12.11" in line

    def test_no_posixpath_or_dict_braces(self):
        line = format_install_info(_SYNTHETIC)

        assert "PosixPath" not in line
        assert "{" not in line
        assert "}" not in line

    def test_real_install_info_renders_cleanly(self):
        line = format_install_info(get_install_info())

        assert "PosixPath" not in line
        assert "{" not in line
        assert "}" not in line


class TestPackageVersion:
    """The reported version is the one the install's own pyproject.toml declares."""

    def test_reads_the_declared_version(self, tmp_path, monkeypatch):
        (tmp_path / "pyproject.toml").write_text('[project]\nversion = "9.8.7"\n')
        monkeypatch.setattr(install, "LIB_ROOT", tmp_path)

        assert get_install_info()["version"] == "9.8.7"

    def test_a_tree_without_pyproject_reports_unknown(self, tmp_path, monkeypatch):
        monkeypatch.setattr(install, "LIB_ROOT", tmp_path)

        assert get_install_info()["version"] == "(unknown)"


class TestLibraryCommit:
    """The commit lookup the daemon shares with `claudebox version`."""

    def test_a_tree_outside_git_has_no_commit(self, tmp_path, monkeypatch):
        monkeypatch.setenv("GIT_CEILING_DIRECTORIES", str(tmp_path.parent))
        monkeypatch.setattr(install, "LIB_ROOT", tmp_path)

        assert install.library_commit() is None
        assert get_install_info()["commit"] == "(unknown)"

    def test_a_git_tree_reports_its_short_head(self, tmp_path, monkeypatch):
        def git(*args):
            return subprocess.run(
                ["git", "-C", str(tmp_path), *args],
                capture_output=True,
                text=True,
                check=True,
                env={
                    "GIT_CONFIG_GLOBAL": "/dev/null",
                    "HOME": str(tmp_path),
                    "PATH": "/usr/bin:/bin",
                },
            ).stdout.strip()

        git("init", "-q")
        git(
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.invalid",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "x",
        )
        monkeypatch.setattr(install, "LIB_ROOT", tmp_path)

        assert install.library_commit() == git("rev-parse", "--short", "HEAD")
