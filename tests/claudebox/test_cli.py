"""Tests for CLI install-info formatting (cli.format_install_info)."""

from pathlib import Path

from claudebox.cli import format_install_info, get_install_info


_SYNTHETIC = {
    "version": "(unknown)",
    "branch": "v51",
    "commit": "76a76a9",
    "path": Path("/home/jakub/dev/share/lib/claudebox"),
    "python": "3.12.11",
}


class TestFormatInstallInfo:
    """format_install_info renders a single readable line, never a raw dict."""

    def test_renders_all_fields_on_one_line(self):
        line = format_install_info(_SYNTHETIC)

        assert "\n" not in line
        assert "v51" in line
        assert "76a76a9" in line
        assert "/home/jakub/dev/share/lib/claudebox" in line
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
