"""Shared test fixtures for claudebox test suite."""

import os
import shutil
import sys
from pathlib import Path

import pytest


_BWRAP_MISSING_MSG = """\
FATAL: bubblewrap (bwrap) is not installed.

The test suite REQUIRES bwrap to sandbox filesystem and network access,
preventing tests from accidentally modifying the host system.
"""


def pytest_configure(config):
    """Re-exec under bwrap sandbox unless already sandboxed: read-only bind of /, tmpfs /tmp and /run,
    network unshared - only /tmp is writable."""

    if os.environ.get("PYTEST_SANDBOXED") or _in_container():
        return

    if not shutil.which("bwrap"):
        raise SystemExit(_BWRAP_MISSING_MSG)

    os.execvp(
        "bwrap",
        [  # noqa: S606
            "bwrap",
            "--ro-bind",
            "/",
            "/",
            "--tmpfs",
            "/tmp",
            "--tmpfs",
            "/run",
            "--dev",
            "/dev",
            "--proc",
            "/proc",
            "--unshare-net",
            "--setenv",
            "PYTEST_SANDBOXED",
            "1",
            "--die-with-parent",
            "--",
            sys.executable,
            "-m",
            "pytest",
            *sys.argv[1:],
        ],
    )


@pytest.fixture(autouse=True)
def isolate_home(tmp_path, monkeypatch):
    """Point Path.home() at a scratch dir - bwrap is skipped in-container, so resolving ~/.claudebox/profile could
    trigger the developer's live session-start hook, repointing /tmp and corrupting the session's scratch space."""

    home = tmp_path / "_home"
    home.mkdir(exist_ok=True)
    monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: home))


@pytest.fixture
def anyio_backend():
    """Force asyncio backend - prevent surprise trio testing if installed."""

    return "asyncio"


@pytest.fixture
def tmp_workspace(tmp_path, monkeypatch):
    """Create a workspace dir with a .workspace marker and isolated home; returns the root."""

    marker = tmp_path / ".workspace"
    marker.touch()

    claudebox_dir = tmp_path / ".claudebox"
    claudebox_dir.mkdir()

    fake_home = tmp_path / "_home"
    fake_home.mkdir(exist_ok=True)
    monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: fake_home))

    return tmp_path


def _in_container() -> bool:
    """Detect container environment where bwrap namespace creation is unavailable."""

    return (
        Path("/run/.containerenv").exists()  # Podman
        or Path("/.dockerenv").exists()  # Docker
    )
