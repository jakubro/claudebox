"""Claudebox Daemon entry point."""

import argparse

from claudebox import HelpFormatter, cli, epilog
from claudebox.constants import DAEMON_PORT
from claudebox_daemon import run_daemon


parser = argparse.ArgumentParser(
    prog="claudeboxd",
    formatter_class=HelpFormatter,
    description="""Claudebox daemon: web UI, session management, multi-workspace orchestration.""",
    epilog=epilog(),
)

parser.add_argument(
    "-p",
    "--port",
    type=int,
    default=DAEMON_PORT,
    help="Daemon port",
)

parser.add_argument(
    "-d",
    "--dev",
    action="store_true",
    help="Enable dev mode (auto-reload, Vite HMR)",
)


if __name__ == "__main__":
    cli(run_daemon, parser)
