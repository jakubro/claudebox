"""Shared access to the shipped install.sh, so distribution tests exercise the real file."""

from __future__ import annotations

from pathlib import Path

import pytest


INSTALL_SH = Path(__file__).resolve().parents[2] / "bin" / "install.sh"

# Everything above the entry-point guard: definitions, strict mode, and the ERR trap.
_ENTRYPOINT_MARKER = "# Run when executed, not when sourced."


@pytest.fixture
def install_sh_head() -> str:
    """The shipped installer with its entry-point guard removed, ready to source and drive."""

    head, sep, _ = INSTALL_SH.read_text(encoding="utf-8").partition(_ENTRYPOINT_MARKER)
    assert sep, "entry-point guard not found - install.sh's tail changed shape"

    return head


@pytest.fixture
def lib_root() -> Path:
    """The library root the installer links into a home as ~/.claudebox/lib."""

    return INSTALL_SH.parents[1]
