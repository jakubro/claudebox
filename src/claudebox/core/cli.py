"""CLI entry point and output utilities."""

import argparse
import subprocess
import sys
import textwrap
from typing import Protocol

from rich.console import Console


class RunApp(Protocol):
    """Callable that receives parsed CLI arguments and runs the application."""

    def __call__(self, *args, **kwargs) -> None: ...


class HelpFormatter(argparse.RawTextHelpFormatter, argparse.ArgumentDefaultsHelpFormatter):
    """Combine raw text formatting with automatic argument defaults display."""

    pass


# Shared Rich console instance configured for stderr output.
console = Console(stderr=True)


def cli(run_app: RunApp | None, parser: argparse.ArgumentParser) -> None:
    """Parse arguments and dispatch.

    Subparser-dispatch mode (``run_app=None``): each subparser sets a ``handler``
    callable via ``set_defaults``; ``args.handler(args)`` is invoked and its
    return value is the process exit code.

    Flat-parser mode (``run_app`` given): ``parse_known_args`` delivers
    ``(args, extra)`` and ``run_app(*extra, **vars(args))`` is invoked.

    Both modes share ``CalledProcessError → sys.exit(exc.returncode)`` and
    ``KeyboardInterrupt → 130`` wrapping.
    """

    try:
        if run_app is None:
            args = parser.parse_args()
            sys.exit(args.handler(args))
        else:
            args, extra = parser.parse_known_args()
            run_app(*extra, **vars(args))
    except subprocess.CalledProcessError as exc:
        args = [textwrap.indent(exc.output, ">   ")] if exc.output else []
        print_error(str(exc), *args)
        sys.exit(exc.returncode)
    except KeyboardInterrupt:
        sys.exit(130)


def print_error(msg: str, *args) -> None:
    """Print a formatted error message to stderr with 'ERROR:' prefix."""

    full_msg = " ".join([msg] + list(args))
    console.print(f"[red]ERROR: {full_msg}[/red]")


def print_command(*args) -> None:
    """Print a command invocation to stderr in dim italic style."""

    console.print(" ".join(str(arg) for arg in args), style="dim italic")
