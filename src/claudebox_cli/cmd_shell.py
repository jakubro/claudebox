"""Handler for the ``shell`` verb - open bash shell in a fresh container."""

import argparse


NAME = "shell"
ORDER = 40
DESCRIPTION = "Open bash shell in fresh container"
EPILOG = """\
Examples:
  claudebox shell                open a shell in a fresh container
"""


def handle(args: argparse.Namespace) -> int:
    """Spawn a fresh container with bash as the CMD, ``kind=shell`` label."""

    # Deferred: pulls structlog and the container backend, which the cold path must not pay for.
    from claudebox import ContainerRuntime

    runtime = ContainerRuntime(verbose=args.verbose)

    return runtime.run(args=("bash",), kind="shell")
