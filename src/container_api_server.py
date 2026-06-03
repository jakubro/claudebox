#!/opt/claudebox/.venv/bin/python
"""Container API server entry point."""

import argparse

from claudebox import HelpFormatter, cli
from claudebox.constants import WEB_CONTAINER_PORT
from claudebox_container_api import run_container_api


parser = argparse.ArgumentParser(
    description="Claudebox Container API",
    formatter_class=HelpFormatter,
)

parser.add_argument(
    "--port",
    type=int,
    default=WEB_CONTAINER_PORT,
    help="Server port",
)

parser.add_argument(
    "--system-prompt",
    help="System prompt",
)

parser.add_argument(
    "--permission-mode",
    default="default",
    help="Permission mode",
)


if __name__ == "__main__":
    cli(run_container_api, parser)
