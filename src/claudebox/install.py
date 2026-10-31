"""Installation metadata and the help epilog that renders it.

Must not be named ``cli``: that would shadow the ``cli`` runner the package root re-exports from ``core.cli``.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from .constants import GIT_SUBPROCESS_TIMEOUT, LIB_ROOT, REPOSITORY_URL
from .core.io import read_toml


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
        "commit": library_commit() or "(unknown)",
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
    pyproject = read_toml(LIB_ROOT / "pyproject.toml", default=None)

    return pyproject["project"]["version"] if pyproject else "(unknown)"


def _branch() -> str:
    """Return the current git branch, gracefully degrading on git failure."""

    try:
        result = subprocess.run(
            ["git", "-C", str(LIB_ROOT), "branch", "--show-current"],
            capture_output=True,
            text=True,
            timeout=GIT_SUBPROCESS_TIMEOUT.total_seconds(),
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        return "(unknown)"

    return result.stdout.strip() or "(unknown)"


def library_commit() -> str | None:
    """Return the library's short commit hash, or None when git cannot say."""

    try:
        result = subprocess.run(
            ["git", "-C", str(LIB_ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=GIT_SUBPROCESS_TIMEOUT.total_seconds(),
            check=False,
        )
    except (subprocess.SubprocessError, OSError):
        return None

    return result.stdout.strip() or None


def _python_version() -> str:
    """Return the running interpreter version as ``major.minor.micro``."""

    return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
