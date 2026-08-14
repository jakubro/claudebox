"""CLI entry point and output utilities."""

import argparse
import os
import subprocess
import sys
import textwrap
from collections.abc import Callable
from typing import Protocol

from rich.console import Console
from rich_argparse import RawTextRichHelpFormatter


class RunApp(Protocol):
    """Callable that receives parsed CLI arguments and runs the application."""

    def __call__(self, *args, **kwargs) -> None: ...


class HelpFormatter(RawTextRichHelpFormatter):
    """Colourised help that leaves hand-laid-out text exactly as written.

    Markup is off both ways: help text has literal square brackets (``[daemon]``) that Rich would
    read as style tags and swallow. Defaults aren't appended either - each option states its own.
    """

    text_markup = False
    help_markup = False

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)

        if os.environ.get("NO_COLOR"):
            # NO_COLOR keeps attributes, so the highlighter still bolds backticks; force
            # color_system=None instead, which emits nothing.
            self.console = Console(color_system=None)


class LazyEpilogParser(argparse.ArgumentParser):
    """Parser that builds its epilog on first render rather than at construction.

    The install line costs two ``git`` subprocesses, and shell completion re-executes the program
    on every keypress - yet only ``--help`` ever prints the epilog.
    """

    def __init__(self, *args, epilog_factory: Callable[[], str] | None = None, **kwargs) -> None:
        self._epilog_factory = epilog_factory
        super().__init__(*args, **kwargs)

    def format_help(self) -> str:
        """Materialize the deferred epilog once, then format as usual."""

        if self._epilog_factory is not None:
            self.epilog = self._epilog_factory()
            self._epilog_factory = None

        return super().format_help()


# Shared Rich console instance configured for stderr output.
console = Console(stderr=True)


def cli(run_app: RunApp | None, parser: argparse.ArgumentParser) -> None:
    """Parse arguments and dispatch.

    Subparser-dispatch mode (``run_app=None``): each subparser sets a ``handler`` via
    ``set_defaults``; ``args.handler(args)`` is invoked and its return value is the exit code.
    Flat-parser mode (``run_app`` given): ``parse_known_args`` delivers ``(args, extra)`` and
    ``run_app(*extra, **vars(args))`` is invoked. Both modes map ``CalledProcessError`` to
    ``sys.exit(exc.returncode)`` and ``KeyboardInterrupt`` to exit code 130.
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
