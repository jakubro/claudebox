"""End-to-end guards for the CLI cold path.

Shell completion re-executes the whole program on every keypress, so anything done at import
time is paid per keystroke; these assert structural invariants, not flaky wall-clock thresholds.
"""

from pathlib import Path

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


def _git_invocations(record_dir: Path) -> list[str]:
    """Return the git invocations recorded by the fake bin on PATH."""

    records = record_dir / "git.log"

    if not records.exists():
        return []

    return [line for line in records.read_text().splitlines() if line.strip()]


def test_completion_request_does_not_run_git(complete, record_dir: Path) -> None:
    """A Tab press must not touch the repository - only the install line needs branch/commit,
    and only help prints it.
    """

    complete("claudebox ")

    assert _git_invocations(record_dir) == [], "cold path spawned git during completion"


def test_help_still_reports_install_info(run_claudebox, record_dir: Path) -> None:
    """Deferring the install line must not lose it."""

    result = run_claudebox(["-h"], env={"NO_COLOR": "1"}, timeout=30)

    assert result.returncode == 0

    combined = result.stdout + result.stderr

    assert "install:" in combined

    for verb in ("build", "run", "logs", "containers", "workspaces"):
        assert verb in combined

    # The install line is rendered, so its git lookups do happen here.
    assert _git_invocations(record_dir), "install line rendered without consulting the repo"


def test_verb_invocation_does_not_run_git(run_claudebox, record_dir: Path) -> None:
    """A verb that prints no install line has no reason to read the repository."""

    run_claudebox(["logs", "--no-follow"], env={"NO_COLOR": "1"}, timeout=30)

    assert _git_invocations(record_dir) == [], "cold path spawned git for a non-help verb"
