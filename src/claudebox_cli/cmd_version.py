"""Handler for the ``version`` verb — print version and install metadata."""

import argparse

from claudebox import get_install_info


NAME = "version"
ORDER = 90
DESCRIPTION = "Print version"
EPILOG = """\
examples:
  claudebox version              print version, branch, commit, install path, python
"""


def handle(args: argparse.Namespace) -> int:  # noqa: ARG001
    """Print a version block: package version + branch / commit / install / python."""

    info = get_install_info()
    print(f"claudebox {info['version']}")
    print(f"  branch:  {info['branch']}")
    print(f"  commit:  {info['commit']}")
    print(f"  install: {info['path']}")
    print(f"  python:  {info['python']}")

    return 0
