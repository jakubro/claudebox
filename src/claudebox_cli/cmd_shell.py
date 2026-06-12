"""Handler for the ``shell`` verb - open bash shell in a fresh container."""

import argparse

from claudebox import ContainerRuntime


NAME = "shell"
ORDER = 40
DESCRIPTION = "Open bash shell in fresh container"
EPILOG = """\
examples:
  claudebox shell                open a shell in a fresh container
"""


def handle(args: argparse.Namespace) -> int:
    """Spawn a fresh container with bash as the CMD, ``kind=shell`` label."""

    runtime = ContainerRuntime(verbose=args.verbose)

    return runtime.run(args=("bash",), kind="shell")
