"""End-to-end behavioral tests for ``claudebox version``.

Real-binary surface: the version ``pyproject.toml`` declares, plus branch/commit lines via fake git.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])

PYPROJECT_PATH = Path(__file__).resolve().parents[2] / "pyproject.toml"


# SPEC: cli:version
class TestVersionOutput:
    """``claudebox version`` prints version + 4 labelled lines and exits 0."""

    def test_version_exits_zero_with_package_version(self, run_claudebox) -> None:
        result = run_claudebox(["version"])
        assert result.returncode == 0
        expected = tomllib.loads(PYPROJECT_PATH.read_text())["project"]["version"]
        assert f"claudebox {expected}" in result.stdout

    def test_version_includes_all_labels(self, run_claudebox) -> None:
        result = run_claudebox(["version"])

        for label in ("branch:", "commit:", "install:", "python:"):
            assert label in result.stdout
