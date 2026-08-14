"""Handler for the ``build`` verb - build the container image."""

import argparse


NAME = "build"
ORDER = 20
DESCRIPTION = "Build container image"
EPILOG = """\
Examples:
  claudebox build                cached build (reuses all layers)
  claudebox build --layer all    full rebuild from base
  claudebox build --layer agent  rebuild agent layer only
"""


def register(parser: argparse.ArgumentParser) -> None:
    """Add --layer choice."""

    parser.add_argument(
        "--layer",
        choices=["all", "agent"],
        default=None,
        help="Which image layer to rebuild (default: cached build)",
    )


def handle(args: argparse.Namespace) -> int:
    """Build the container image."""

    from claudebox import ContainerRuntime

    runtime = ContainerRuntime(verbose=args.verbose)

    runtime.build(mode=_layer_mode(args.layer))

    return 0


def _layer_mode(layer: str | None):
    """Map the ``--layer`` value to its build mode.

    Not module-level: importing pulls in structlog and the container backend, a cost the cold path must not pay.
    """

    from claudebox import ImageBuildMode

    return {
        None: ImageBuildMode.BUILD,
        "all": ImageBuildMode.REBUILD,
        "agent": ImageBuildMode.UPDATE,
    }[layer]
