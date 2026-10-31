"""Behavioral tests for ``container/run/fs/root/.local/bin/claudebox-agent``.

The wrapper is the container entrypoint's agent dispatcher: ``entrypoint.sh`` runs
``claudebox-agent "$CLAUDEBOX_AGENT"``, so every declarable agent needs a branch here - a
missing one is fatal, since the container exits before the API server binds a port.

Each test drives the real script under a hermetic HOME with a stub server, exercising
dispatch rather than pattern-matching the file text.
"""

from __future__ import annotations

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

STUB_BODY = """
echo "{label} $*"

while [[ $# -gt 0 ]]; do
  if [[ $1 == --system-prompt-file ]]; then
    echo "PROMPT_FILE:$2"
    echo "PROMPT:$(cat "$2")"
  fi

  shift
done
"""


@pytest.fixture
def stub_web_server(hermetic_home: Path) -> Path:
    """Plant an executable stand-in at the path the wrapper launches for web mode."""

    server = hermetic_home / ".claudebox" / "lib" / "src" / "container_api_server.py"
    server.parent.mkdir(parents=True, exist_ok=True)
    server.write_text("#!/bin/bash\n" + STUB_BODY.format(label=STUB_MARKER))
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
        check=False,
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


@pytest.fixture
def prompt_env(hermetic_home: Path, tmp_path: Path) -> dict[str, str]:
    """Stub the prompt compiler to name the file it was given, and `mise` to echo what it got."""

    compiler = hermetic_home / ".local" / "bin" / "claudebox-prompt"
    compiler.parent.mkdir(parents=True, exist_ok=True)
    compiler.write_text('#!/bin/bash\necho "COMPILED:$(basename "$1")"\n')
    compiler.chmod(0o755)

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    mise = bin_dir / "mise"
    mise.write_text(
        '#!/bin/bash\n[[ $1 == which ]] && echo "/opt/agent/$2" && exit\n'
        + STUB_BODY.format(label="MISE"),
    )
    mise.chmod(0o755)

    (hermetic_home / ".claudebox" / "profile").mkdir(parents=True, exist_ok=True)

    return {"PATH": f"{bin_dir}:{os.environ['PATH']}"}


def _profile_files(hermetic_home: Path, *names: str) -> None:
    for name in names:
        (hermetic_home / ".claudebox" / "profile" / name).write_text("persona\n")


def _run_with_prompt(agent: str, hermetic_home: Path, env: dict[str, str], **extra) -> str:
    result = subprocess.run(
        [str(WRAPPER), agent],
        env={"HOME": str(hermetic_home), **env, **extra},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr

    return result.stdout


@pytest.mark.parametrize(
    ("agent", "files", "bundle", "expected"),
    [
        ("claude", ["prompt.md", "prompt.research.md"], "research", "COMPILED:prompt.research.md"),
        ("claude", ["prompt.md"], "research", "COMPILED:prompt.md"),
        ("claude", ["prompt.md", "prompt.research.md"], None, "COMPILED:prompt.md"),
        (
            "langgraph",
            ["prompt.langgraph.md", "prompt.langgraph.research.md", "prompt.research.md"],
            "research",
            "COMPILED:prompt.langgraph.research.md",
        ),
        (
            "langgraph",
            ["prompt.langgraph.md", "prompt.research.md"],
            "research",
            "COMPILED:prompt.langgraph.md",
        ),
    ],
)
def test_a_bundle_prompt_is_preferred_within_its_own_runtime(
    hermetic_home: Path,
    stub_web_server: Path,
    prompt_env: dict[str, str],
    agent: str,
    files: list[str],
    bundle: str | None,
    expected: str,
) -> None:
    _profile_files(hermetic_home, *files)
    extra = {"CLAUDEBOX_BUNDLE": bundle} if bundle else {}

    if agent == "langgraph":
        extra["CLAUDEBOX_WEB"] = "1"

    stdout = _run_with_prompt(agent, hermetic_home, prompt_env, **extra)

    assert f"PROMPT:{expected}" in stdout


def test_no_prompt_file_passes_no_system_prompt(
    hermetic_home: Path,
    prompt_env: dict[str, str],
) -> None:
    stdout = _run_with_prompt("claude", hermetic_home, prompt_env, CLAUDEBOX_BUNDLE="research")

    assert "MISE" in stdout
    assert "--system-prompt" not in stdout


@pytest.mark.parametrize("agent", ["claude", "langgraph"])
def test_a_prompt_past_the_single_argument_limit_reaches_the_agent_whole(
    hermetic_home: Path,
    stub_web_server: Path,
    prompt_env: dict[str, str],
    agent: str,
) -> None:
    """The kernel refuses any single argv or env string over 128 KiB, so the prompt travels as a file."""

    size = 200_000
    compiler = hermetic_home / ".local" / "bin" / "claudebox-prompt"
    compiler.write_text(f"#!/bin/bash\nhead -c {size} /dev/zero | tr '\\0' x\n")
    _profile_files(hermetic_home, "prompt.md", "prompt.langgraph.md")
    extra = {"CLAUDEBOX_WEB": "1"} if agent == "langgraph" else {}

    stdout = _run_with_prompt(agent, hermetic_home, prompt_env, **extra)

    assert f"PROMPT:{'x' * size}\n" in stdout
    prompt_file = next(line for line in stdout.splitlines() if line.startswith("PROMPT_FILE:"))
    assert not Path(prompt_file.removeprefix("PROMPT_FILE:")).exists()


def test_terminal_session_launches_the_agent_binary_not_the_shadowing_shim(
    hermetic_home: Path,
    tmp_path: Path,
) -> None:
    """The container puts a ``claude`` shim that re-enters this wrapper ahead of the real binary."""

    shim = hermetic_home / ".local" / "bin" / "claude"
    shim.parent.mkdir(parents=True)
    shim.write_text("#!/bin/bash\necho SHIM-RAN\n")
    shim.chmod(0o755)

    real_dir = tmp_path / "agent"
    real_dir.mkdir()
    real = real_dir / "claude"
    real.write_text("#!/bin/bash\necho AGENT-RAN\n")
    real.chmod(0o755)

    mise_dir = tmp_path / "mise-bin"
    mise_dir.mkdir()
    mise = mise_dir / "mise"
    mise.write_text(
        f'#!/bin/bash\n[[ $1 == which ]] && echo "{real}" && exit\n'
        'while [[ $1 != -- ]]; do shift; done\nshift\nexec "$@"\n',
    )
    mise.chmod(0o755)

    stdout = _run_with_prompt(
        "claude",
        hermetic_home,
        {"PATH": f"{shim.parent}:{mise_dir}:{real_dir}:{os.environ['PATH']}"},
    )

    assert "AGENT-RAN" in stdout
    assert "SHIM-RAN" not in stdout
