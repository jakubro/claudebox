"""Handler for the ``update`` verb — refresh Claudebox itself via install.sh."""

import argparse
import subprocess
import sys

from claudebox import console
from claudebox.constants import global_config_dir


NAME = "update"
ORDER = 30
DESCRIPTION = "Update Claudebox itself (re-runs install.sh)"
EPILOG = """\
examples:
  claudebox update               refresh Claudebox itself
  claudebox -v update            forward --verbose to install.sh

update spawns ~/.claudebox/lib/bin/install.sh, surfaces its stdout/stderr
live, and propagates its exit code. Concurrent invocations are blocked by
install.sh's flock — the second invocation exits non-zero immediately.

build vs update:
  build  rebuilds the container image (the agent layer inside it).
  update refreshes Claudebox's own library on the host (the install.sh path).
"""


def handle(args: argparse.Namespace) -> int:
    """Spawn install.sh; propagate exit code."""

    install_sh = global_config_dir() / "lib" / "bin" / "install.sh"

    if not install_sh.exists():
        console.print(f"[red]error: install.sh not found at {install_sh}[/red]")
        return 1

    extra_args = ["--verbose"] if args.verbose else []

    try:
        result = subprocess.run([str(install_sh), *extra_args], check=False)
    except OSError as exc:
        console.print(f"[red]error: failed to execute install.sh: {exc}[/red]")
        return 1

    sys.stdout.flush()
    sys.stderr.flush()
    return result.returncode
