"""Handler for the ``build`` verb - build the container image."""

import argparse

from claudebox import ContainerRuntime, ImageBuildMode


NAME = "build"
ORDER = 20
DESCRIPTION = "Build container image"
EPILOG = """\
examples:
  claudebox build                cached build (reuses all layers)
  claudebox build --layer all    full rebuild from base
  claudebox build --layer agent  rebuild agent layer only
"""


# argparse `--layer` value -> existing ImageBuildMode mapping.
_LAYER_MODES: dict[str | None, ImageBuildMode] = {
    None: ImageBuildMode.BUILD,
    "all": ImageBuildMode.REBUILD,
    "agent": ImageBuildMode.UPDATE,
}


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

    runtime = ContainerRuntime(verbose=args.verbose)

    runtime.build(mode=_LAYER_MODES[args.layer])

    return 0
