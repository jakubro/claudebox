"""Behavioral tests for ``container/run/fs/root/.local/bin/claudebox-agent``.

The wrapper is the container entrypoint's agent dispatcher: ``entrypoint.sh`` runs
``claudebox-agent "$CLAUDEBOX_AGENT"``, so every declarable agent needs a branch here - a
missing one is fatal, since the container exits before the API server binds a port.

Each test drives the real script under a hermetic HOME with a stub server, exercising
dispatch rather than pattern-matching the file text.
"""

import os
import subprocess
from pathlib import Path

import pytest


WRAPPER = (
    Path(__file__).parent.parent.parent
    / "container"
    / "run"
    / "fs"
    / "root"
    / ".local"
    / "bin"
    / "claudebox-agent"
)

STUB_MARKER = "stub-container-api-server-ran"


@pytest.fixture
def stub_web_server(hermetic_home: Path) -> Path:
    """Plant an executable stand-in at the path the wrapper launches for web mode."""

    server = hermetic_home / ".claudebox" / "lib" / "src" / "container_api_server.py"
    server.parent.mkdir(parents=True, exist_ok=True)
    server.write_text(f'#!/bin/bash\necho "{STUB_MARKER} $*"\n')
    server.chmod(0o755)

    return server


def _run(agent: str, hermetic_home: Path, **env) -> subprocess.CompletedProcess:
    """Invoke the wrapper for one agent under a controlled environment."""

    # Built from a minimal base, not os.environ - the ambient session already exports
    # CLAUDEBOX_WEB and hook-guard flags that would otherwise decide the branch under test.
    return subprocess.run(
        [str(WRAPPER), agent],
        env={
            "HOME": str(hermetic_home),
            "PATH": os.environ["PATH"],
            **env,
        },
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_wrapper_is_executable() -> None:
    assert os.access(WRAPPER, os.X_OK), f"not executable: {WRAPPER}"


def test_langgraph_launches_the_web_server(hermetic_home: Path, stub_web_server: Path) -> None:
    result = _run("langgraph", hermetic_home, CLAUDEBOX_WEB="1")

    assert result.returncode == 0, result.stderr
    assert STUB_MARKER in result.stdout


def test_langgraph_refuses_terminal_mode(hermetic_home: Path, stub_web_server: Path) -> None:
    """LangGraph runs in-process and ships no TUI, so a terminal launch must fail legibly."""

    result = _run("langgraph", hermetic_home)

    assert result.returncode != 0
    assert "web mode only" in result.stderr
    assert STUB_MARKER not in result.stdout


def test_unknown_agent_reports_every_supported_agent(hermetic_home: Path) -> None:
    result = _run("nonexistent-agent", hermetic_home)

    assert result.returncode != 0
    # Asserted on the usage line, not all of stdout: the script's own path is echoed too and
    # contains "claude", so a looser check would pass even with the agent list emptied out.
    usage = next(line for line in result.stdout.splitlines() if line.startswith("Usage:"))
    assert "{claude|langgraph}" in usage
