"""End-to-end behavioral tests for ``claudebox version``.

Real-binary surface: ``importlib.metadata.version("claudebox")`` resolution from
the installed binary, plus the labeled branch/commit lines populated via fake git.
"""

from importlib.metadata import version as pkg_version

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


# SPEC: cli:version
class TestVersionOutput:
    """``claudebox version`` prints version + 4 labelled lines and exits 0."""

    def test_version_exits_zero_with_package_version(self, run_claudebox) -> None:
        result = run_claudebox(["version"])
        assert result.returncode == 0
        # The binary resolves the installed package version via importlib.metadata.
        expected = pkg_version("claudebox")
        assert f"claudebox {expected}" in result.stdout

    def test_version_includes_all_labels(self, run_claudebox) -> None:
        result = run_claudebox(["version"])

        for label in ("branch:", "commit:", "install:", "python:"):
            assert label in result.stdout
