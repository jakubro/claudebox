"""End-to-end behavioral tests for ``claudebox version``.

Exercises the SPEC ``cli:version`` claim through the real binary via subprocess.
"""

from importlib.metadata import version as pkg_version


# SPEC: cli:version
class TestVersionHelp:
    """``claudebox version --help`` exits 0 and documents the verb."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["version", "--help"])
        assert result.returncode == 0

    def test_help_mentions_branch_and_commit(self, run_claudebox) -> None:
        result = run_claudebox(["version", "--help"])
        assert "branch" in result.stdout
        assert "commit" in result.stdout


# SPEC: cli:version
class TestVersionOutput:
    """``claudebox version`` prints version + 4 labelled lines and exits 0."""

    def test_version_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["version"])
        assert result.returncode == 0

    def test_version_includes_package_version(self, run_claudebox) -> None:
        # The binary resolves the installed package version; pin the assertion to whatever pip/uv installed.
        expected = pkg_version("claudebox")

        result = run_claudebox(["version"])
        assert f"claudebox {expected}" in result.stdout

    def test_version_includes_all_labels(self, run_claudebox) -> None:
        result = run_claudebox(["version"])
        for label in ("branch:", "commit:", "install:", "python:"):
            assert label in result.stdout
