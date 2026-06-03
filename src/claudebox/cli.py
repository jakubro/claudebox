"""CLI epilog and installation metadata utilities."""

import subprocess
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from .constants import GIT_SUBPROCESS_TIMEOUT, LIB_ROOT, REPOSITORY_URL


def epilog() -> str:
    """Build CLI epilog with repo URL and install info."""

    return f"""\
see also:
  {REPOSITORY_URL}

install:
  {format_install_info(get_install_info())}
"""


def get_install_info() -> dict[str, str | Path]:
    """Return install metadata: version, branch, commit, lib path, python version."""

    return {
        "version": _package_version(),
        "branch": _branch(),
        "commit": _commit(),
        "path": LIB_ROOT,
        "python": _python_version(),
    }


def format_install_info(info: dict[str, str | Path]) -> str:
    """Render install metadata as one human-readable line."""

    return (
        f"{info['version']} · {info['branch']} ({info['commit']}) "
        f"@ {info['path']} · Python {info['python']}"
    )


def _package_version() -> str:
    """Return the installed package version, or ``(unknown)`` if missing."""

    try:
        return version("claudebox")
    except PackageNotFoundError:
        return "(unknown)"


def _branch() -> str:
    """Return the current git branch, gracefully degrading on git failure."""

    try:
        result = subprocess.run(
            ["git", "-C", str(LIB_ROOT), "branch", "--show-current"],
            capture_output=True,
            text=True,
            timeout=GIT_SUBPROCESS_TIMEOUT.total_seconds(),
        )
    except (subprocess.SubprocessError, OSError):
        return "(unknown)"

    return result.stdout.strip() or "(unknown)"


def _commit() -> str:
    """Return the current short commit hash, gracefully degrading on git failure."""

    try:
        result = subprocess.run(
            ["git", "-C", str(LIB_ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=GIT_SUBPROCESS_TIMEOUT.total_seconds(),
        )
    except (subprocess.SubprocessError, OSError):
        return "(unknown)"

    return result.stdout.strip() or "(unknown)"


def _python_version() -> str:
    """Return the running interpreter version as ``major.minor.micro``."""

    return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
