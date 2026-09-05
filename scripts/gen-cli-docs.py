#!/usr/bin/env python3
"""Render `claudebox --help` (root and every verb) into docs/reference/cli.md via `just docs`.
Deterministic - color off, width pinned, footer normalized - so the page tracks only the parser."""

import argparse
import os
import re
from pathlib import Path

from host_cli import app


WIDTH = 100
DOCS_PATH = Path(__file__).resolve().parents[1] / "docs" / "reference" / "cli.md"

# The install line names the branch, commit and path of whichever checkout rendered it.
_INSTALL_FOOTER = re.compile(r"^install:\n  .+$", re.MULTILINE)
_INSTALL_PLACEHOLDER = "install:\n  <branch> (<commit>) @ <path>"

_HEADER = """\
# Claudebox CLI reference

Complete `--help` for `claudebox` and every verb it registers, captured from the parser itself.
This file is generated - run `just docs` to bring it back in step after changing a verb's
description, its options or its epilog.
"""


def build_document() -> str:
    """Return the full text of the generated CLI reference."""

    sections = [_section("claudebox", app.parser)]
    sections.extend(_section(f"claudebox {name}", parser) for name, parser in verbs())

    return _HEADER + "\n" + "\n\n".join(sections) + "\n"


def write_document() -> None:
    """Render the reference and write it to DOCS_PATH, creating parent directories."""

    DOCS_PATH.parent.mkdir(parents=True, exist_ok=True)
    DOCS_PATH.write_text(build_document())


def verbs() -> list[tuple[str, argparse.ArgumentParser]]:
    """Every verb the top-level parser registers, in registration order."""

    # argparse exposes no public accessor for the subparsers it holds.
    for action in app.parser._actions:
        if isinstance(action, argparse._SubParsersAction):
            return list(action.choices.items())

    raise AssertionError("claudebox's top-level parser registers no subcommands")


def _section(title: str, parser: argparse.ArgumentParser) -> str:
    """Render one parser's help as a Markdown heading plus a fenced block."""

    return f"## `{title}`\n\n```text\n{_render_help(parser)}\n```"


def _render_help(parser: argparse.ArgumentParser) -> str:
    """Format help with color off, width pinned, and the install footer normalized.
    Both are read when the console is built, so they are set around the call and restored after."""

    previous = {name: os.environ.get(name) for name in ("NO_COLOR", "COLUMNS")}
    os.environ["NO_COLOR"] = "1"
    os.environ["COLUMNS"] = str(WIDTH)

    try:
        text = parser.format_help()
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    return _INSTALL_FOOTER.sub(_INSTALL_PLACEHOLDER, text.rstrip())


if __name__ == "__main__":
    write_document()
