"""Claudebox CLI entry point."""

import argparse
import importlib
import math
import pkgutil
from collections.abc import Callable
from typing import Protocol

import claudebox_cli
from claudebox import HelpFormatter, cli
from claudebox import epilog as _install_epilog


class CliCommandModule(Protocol):
    """The required surface for each ``claudebox_cli/cmd_*.py`` module.

    Modules may optionally define ``register(parser)`` to extend their
    subparser with verb-specific arguments; absence is treated as a no-op.
    """

    NAME: str
    ORDER: int
    DESCRIPTION: str
    EPILOG: str

    @staticmethod
    def handle(args: argparse.Namespace) -> int: ...


class Cli:
    """Top-level claudebox argparse parser; auto-discovers ``cmd_*.py`` modules at construction."""

    def __init__(self, **kwargs) -> None:
        kwargs.setdefault("formatter_class", HelpFormatter)
        self._parser = argparse.ArgumentParser(**kwargs)

        # Two independent -v actions: top-level (default False) + per-subparser (SUPPRESS)
        # so the latter doesn't overwrite the former. argparse parents= would share one action.
        self._parser.add_argument(
            "-v",
            "--verbose",
            action="store_true",
            default=False,
            help="Increase output verbosity (verb-dependent - see per-verb help)",
        )

        self._subparsers = self._parser.add_subparsers(
            dest="command",
            metavar="<command>",
        )

        # Bare `claudebox` (no command) flows through the normal args.handler
        # dispatch (claudebox.core.cli.cli) and prints full help + exits 2 -
        # mirroring the noun-groups' sub-help-on-no-verb convention rather than
        # argparse's terse required-arg error.
        self._parser.set_defaults(handler=self._print_help_and_exit)

        self._register_modules()

    @property
    def parser(self) -> argparse.ArgumentParser:
        return self._parser

    def run(self):
        cli(None, self._parser)

    def _print_help_and_exit(self, _args: argparse.Namespace) -> int:
        """Print top-level help for a bare invocation (no command) and yield exit 2."""

        self._parser.print_help()

        return 2

    def _register_modules(self) -> None:
        """Wire every discovered cmd_*.py module into the top-level parser."""

        for mod in self._discover_cmd_modules():
            sub = self._add_subparser(
                self._subparsers,
                mod.NAME,
                description=mod.DESCRIPTION,
                epilog=mod.EPILOG,
                handler=mod.handle,
            )

            if register := getattr(mod, "register", None):
                register(sub)

    @staticmethod
    def _discover_cmd_modules() -> list[CliCommandModule]:
        """Import every ``cmd_*`` module under claudebox_cli; return them sorted by ORDER."""

        modules: list[CliCommandModule] = []

        for _, name, _ in pkgutil.iter_modules(claudebox_cli.__path__):
            if name.startswith("cmd_"):
                modules.append(importlib.import_module(f"claudebox_cli.{name}"))

        return sorted(modules, key=lambda m: (getattr(m, "ORDER", math.inf), m.__spec__.name))

    @staticmethod
    def _add_subparser(
        subparsers: argparse._SubParsersAction,
        name: str,
        *,
        description: str,
        epilog: str,
        handler: Callable[[argparse.Namespace], int],
    ) -> argparse.ArgumentParser:
        """Build a verb subparser with shared SUPPRESS-defaulted -v + handler binding."""

        sub = subparsers.add_parser(
            name,
            help=description,
            description=description,
            epilog=epilog,
            formatter_class=HelpFormatter,
        )
        sub.add_argument(
            "-v",
            "--verbose",
            action="store_true",
            default=argparse.SUPPRESS,
            help="Increase output verbosity (verb-dependent - see per-verb help)",
        )
        sub.set_defaults(handler=handler)

        return sub


app = Cli(
    prog="claudebox",
    description="Run AI coding agents in a containerized dev environment.",
    epilog=f"""\
run "claudebox <command> --help" for command-specific help

{_install_epilog()}
""",
)


if __name__ == "__main__":
    app.run()
