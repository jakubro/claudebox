"""End-to-end tests for colourised CLI help.

Help must look good in a terminal and stay machine-readable in a pipe, asserted against the real binary.
"""

import re

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


_DEFAULT = re.compile(r"\(default:")

# Curated, not alphabetical - the order the verbs are meant to be read in.
_VERB_ORDER = [
    "run",
    "build",
    "update",
    "shell",
    "prune",
    "logs",
    "status",
    "doctor",
    "version",
    "daemon",
    "containers",
    "workspaces",
]


# SPEC: cli:help-rendering
def test_help_is_colourised_when_forced(run_claudebox) -> None:
    result = run_claudebox(["--help"], env={"FORCE_COLOR": "1"}, timeout=30)

    assert result.returncode == 0

    combined = result.stdout + result.stderr

    assert "\x1b[" in combined, "help emitted no colour under FORCE_COLOR"

    for verb in ("run", "build", "logs", "containers", "workspaces"):
        assert verb in combined


# SPEC: cli:help-rendering
def test_help_is_plain_when_colour_suppressed(run_claudebox) -> None:
    """NO_COLOR alone must suffice, on a colour-capable terminal.

    FORCE_COLOR is set alongside it deliberately - without colour support the assertion passes wrongly.
    """

    result = run_claudebox(
        ["--help"],
        env={"NO_COLOR": "1", "FORCE_COLOR": "1"},
        timeout=30,
    )

    assert result.returncode == 0

    combined = result.stdout + result.stderr

    assert "\x1b[" not in combined, "escape sequences leaked into plain help"
    assert "usage" in combined.lower()


def test_help_goes_to_stdout(run_claudebox) -> None:
    """Help must stay pipeable; the shared console is stderr-bound and must not be used."""

    result = run_claudebox(["--help"], env={"NO_COLOR": "1"}, timeout=30)

    assert "usage" in result.stdout.lower()
    assert result.stderr == ""


def test_option_defaults_are_not_duplicated(run_claudebox) -> None:
    """No option may print more than one default, and none may contradict itself."""

    for verb in ("logs", "build"):
        result = run_claudebox([verb, "--help"], env={"NO_COLOR": "1"}, timeout=30)
        combined = result.stdout + result.stderr

        for line in combined.splitlines():
            assert len(_DEFAULT.findall(line)) <= 1, f"duplicated default in {verb}: {line}"

        assert "(default: None)" not in combined


def test_verb_order_is_curated_not_alphabetical(run_claudebox) -> None:
    """The verb list reads in its curated order; alphabetical would start with build."""

    result = run_claudebox(["--help"], env={"NO_COLOR": "1"}, timeout=30)
    combined = result.stdout + result.stderr

    positions = [combined.index(f"\n    {verb}") for verb in _VERB_ORDER]

    assert positions == sorted(positions), "verb order drifted from the curated sequence"


def test_literal_brackets_survive_in_help(run_claudebox) -> None:
    """Square brackets are content, not markup - the renderer would otherwise swallow them."""

    result = run_claudebox(["logs", "--help"], env={"NO_COLOR": "1"}, timeout=30)
    combined = result.stdout + result.stderr

    assert "[daemon]" in combined
    assert "[container <id>]" in combined
