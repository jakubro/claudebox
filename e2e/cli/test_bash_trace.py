"""Bash call measurement end to end: a session, the real supervisor and the entrypoint."""

from __future__ import annotations

import asyncio
import errno
import functools
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from claude_agent_sdk import AssistantMessage, UserMessage
from claude_agent_sdk.types import ContentBlock, TextBlock, ToolResultBlock, ToolUseBlock

from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from claudebox.workspace import Workspace
from .scripted_cli import ScriptedCli


REPO = Path(__file__).parents[2]
SUPERVISOR = REPO / "container/run/fs/root/.local/bin/claudebox-trace"
ENTRYPOINT = REPO / "container/run/fs/entrypoint.sh"
SOCKET = Path("trace.sock")

COMMANDS = {
    "tu_prints": "python3 -c 'print(1)'",
    "tu_reverses_by_name": "tac notes.txt",
    "tu_reverses_a_pipe": "cat notes.txt | tac",
    "tu_writes": "echo kept > copy.txt",
    "tu_looks_up_a_user": "id -un",
    "tu_fails_to_read": "cat missing.txt",
    "tu_fails_to_write": "echo kept > missing-dir/copy.txt",
    "tu_one_word": "nproc",
    "tu_sends_a_datagram": (
        'python3 -c "import socket; '
        "socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b'x', ('192.0.2.1', 9))\""
    ),
    "tu_writes_through_a_descriptor": "exec 3<scratch.txt; echo kept > /dev/fd/3",
    "tu_tees_to_its_own_output": "seq 3 | tee /dev/stderr",
    "tu_left_running": "sleep 20 >/dev/null 2>&1 &",
    "tu_wrote_then_left_running": "echo kept > left.txt; sleep 20 >/dev/null 2>&1 &",
}

# The agent CLI's shape: its own session, output to a file, eval of the command, then a cwd file.
RUNNER = r"""
import json, re, subprocess, sys
for line in sys.stdin:
    command = json.loads(line)
    bare = re.fullmatch(r"[\w./:=@+,-]+", command)
    quoted = command if bare else "'" + command.replace("'", "'\"'\"'") + "'"
    script = f"source /nonexistent 2>/dev/null || true && eval {quoted} < /dev/null && pwd -P >| claude-ab12-cwd"
    with open("task.output", "ab") as output:
        subprocess.run(
            ["/bin/bash", "-c", script],
            stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True,
        )
    print("done", flush=True)
"""


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    (tmp_path / ".workspace").touch()
    (tmp_path / "notes.txt").write_text("".join(f"line {n}\n" for n in range(1, 15)))
    (tmp_path / "scratch.txt").write_text("scratch\n")
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.chdir(tmp_path)

    return tmp_path


@pytest.fixture
def runner(workspace, monkeypatch):
    """The supervisor running stand-ins for the agent CLI's shells, at the pipeline's socket."""

    if _already_supervised():
        pytest.skip("already under a seccomp supervisor, which allows no second listener")

    process = subprocess.Popen(
        [str(SUPERVISOR), "--socket", str(SOCKET), "--", sys.executable, "-c", RUNNER],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    _wait_for(SOCKET.exists)
    monkeypatch.setattr(
        "claudebox.agent_session.orchestration.trace.CONTAINER_TRACE_SOCKET",
        SOCKET,
    )

    yield process

    assert process.stdin is not None
    process.stdin.close()
    process.wait(timeout=10)


class TracedCli(ScriptedCli):
    runner: subprocess.Popen | None = None

    def reply(self) -> list:
        calls: list[ContentBlock] = [
            ToolUseBlock(id=i, name="Bash", input={"command": c}) for i, c in COMMANDS.items()
        ]
        results: list[ContentBlock] = [
            ToolResultBlock(tool_use_id=i, content="ok") for i in COMMANDS
        ]

        return [
            AssistantMessage(content=calls, model="m"),
            _RUN_COMMANDS,
            UserMessage(content=results),
            AssistantMessage(content=[TextBlock(text="ok")], model="m"),
            self.result("ok"),
        ]

    async def receive_response(self):
        async for message in super().receive_response():
            if message is _RUN_COMMANDS:
                await asyncio.to_thread(self._run_commands)
            else:
                yield message

    def _run_commands(self) -> None:
        if self.runner is None:
            return

        stdin, stdout = self.runner.stdin, self.runner.stdout
        assert stdin is not None and stdout is not None

        for command in COMMANDS.values():
            stdin.write(json.dumps(command) + "\n")
            stdin.flush()
            stdout.readline()


@pytest.fixture
async def measured(workspace, runner) -> dict[str, tuple]:
    """Each call's (parse-time mark on its call, measurement on its result), as stored."""

    return await _run_session(workspace, runner)


@pytest.fixture
async def unmeasured(workspace) -> dict[str, tuple]:
    """The same, with no supervisor serving."""

    return await _run_session(workspace, None)


# SPEC: tool:bash-measured-folds
@pytest.mark.anyio
async def test_a_command_read_as_changing_that_only_printed_is_stored_unchanged(measured):
    assert measured["tu_prints"] == (None, False)


# SPEC: tool:bash-measured-shows
@pytest.mark.anyio
async def test_a_command_read_as_changing_nothing_that_kept_a_file_is_stored_changed(measured):
    assert measured["tu_reverses_a_pipe"] == (True, True)


# SPEC: tool:bash-measured-shows
@pytest.mark.anyio
@pytest.mark.parametrize(
    "tool_use_id",
    ["tu_writes", "tu_fails_to_write", "tu_sends_a_datagram", "tu_writes_through_a_descriptor"],
)
async def test_a_command_that_writes_tries_to_or_sends_is_stored_changed(measured, tool_use_id):
    assert measured[tool_use_id][1] is True


@pytest.mark.anyio
async def test_a_one_word_command_the_agent_cli_runs_unquoted_is_measured(measured):
    assert measured["tu_one_word"][1] is False


@pytest.mark.anyio
async def test_output_sent_to_the_descriptor_the_shell_was_given_changes_nothing(measured):
    assert measured["tu_tees_to_its_own_output"][1] is False


# SPEC: tool:bash-measured-cases
@pytest.mark.anyio
@pytest.mark.parametrize(
    ("tool_use_id", "changed"),
    [
        ("tu_prints", False),
        ("tu_reverses_by_name", False),
        ("tu_reverses_a_pipe", True),
        ("tu_looks_up_a_user", False),
    ],
)
async def test_printing_reversing_and_looking_up_a_user(measured, tool_use_id, changed):
    assert measured[tool_use_id][1] is changed


@pytest.mark.anyio
async def test_a_read_that_fails_changed_nothing(measured):
    assert measured["tu_fails_to_read"][1] is False


# SPEC: tool:bash-measured-running
@pytest.mark.anyio
@pytest.mark.parametrize(
    ("tool_use_id", "changed"),
    [("tu_left_running", None), ("tu_wrote_then_left_running", True)],
)
async def test_a_command_still_running_counts_only_what_it_already_changed(
    measured,
    tool_use_id,
    changed,
):
    assert measured[tool_use_id][1] is changed


# SPEC: tool:bash-measured-unavailable
@pytest.mark.anyio
async def test_without_a_supervisor_no_result_is_measured(unmeasured):
    assert {changed for _, changed in unmeasured.values()} == {None}


def test_a_supervisor_that_cannot_watch_still_runs_its_command_and_answers_unknown(
    tmp_path,
    monkeypatch,
):
    monkeypatch.chdir(tmp_path)
    inner = Path("inner.sock")
    command = [str(SUPERVISOR), "--socket", str(inner), "--", "bash", "-c", "read; echo ran > ran"]

    with subprocess.Popen(
        [str(SUPERVISOR), "--socket", "outer.sock", "--", *command],
        stdin=subprocess.PIPE,
        text=True,
    ) as outer:
        _wait_for(inner.exists)
        verdict = _ask(inner, {"op": "verdict", "id": "tu_1"})
        outer.communicate("go\n", timeout=10)

    assert verdict == {"verdict": "unknown"}
    assert (outer.returncode, Path("ran").read_text(encoding="utf-8")) == (0, "ran\n")


def test_a_supervisor_that_cannot_serve_its_socket_still_runs_its_command(tmp_path):
    unbindable = tmp_path / ("x" * 120) / "trace.sock"
    ran = tmp_path / "ran"

    result = subprocess.run(
        [str(SUPERVISOR), "--socket", str(unbindable), "--", "bash", "-c", f"echo ran > {ran}"],
        timeout=10,
        check=False,
    )

    assert (result.returncode, ran.read_text()) == (0, "ran\n")


def test_the_supervisor_exits_with_its_commands_status(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    result = subprocess.run(
        [str(SUPERVISOR), "--socket", "s.sock", "--", "bash", "-c", "exit 3"],
        timeout=10,
        check=False,
    )

    assert result.returncode == 3


@pytest.mark.parametrize(("web", "expected"), [("1", ["TRACE", "AGENT"]), ("0", ["AGENT"])])
def test_only_a_web_session_runs_under_the_supervisor(hermetic_home, web, expected):
    bin_dir = hermetic_home / ".local" / "bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / "claudebox-trace").write_text('#!/bin/bash\necho TRACE\nshift\nexec "$@"\n')
    (bin_dir / "claudebox-agent").write_text("#!/bin/bash\necho AGENT\n")

    for stub in bin_dir.iterdir():
        stub.chmod(0o755)

    result = subprocess.run(
        [str(ENTRYPOINT)],
        env={
            "HOME": str(hermetic_home),
            "PATH": os.environ["PATH"],
            "CLAUDEBOX_AGENT": "claude",
            "CLAUDEBOX_WEB": web,
        },
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert (result.returncode, result.stdout.split()) == (0, expected)


_RUN_COMMANDS = object()


async def _run_session(workspace: Path, runner: subprocess.Popen | None) -> dict[str, tuple]:
    with (
        patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", TracedCli),
        patch.object(TracedCli, "runner", runner),
    ):
        session = ContainerSession(workspace=workspace, remaps_tmp=False)
        session_id = await session.start()

        try:
            await session.send("run them")
            events_file = _events_file(workspace, session_id)

            async with asyncio.timeout(20):
                while not _events(events_file, "result"):
                    await asyncio.sleep(0.05)
        finally:
            await session.stop()

    calls = {e["tool_use_id"]: e for e in _events(events_file, "tool_use")}
    results = {e["tool_use_id"]: e for e in _events(events_file, "tool_result")}

    return {i: (calls[i]["command_read_only"], results[i]["command_changed"]) for i in COMMANDS}


def _events_file(workspace: Path, session_id: str) -> Path:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None

    return session.path / "events.jsonl"


def _events(path: Path, subtype: str) -> list[dict]:
    if not path.exists():
        return []

    events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    return [e for e in events if e["subtype"] == subtype or e["type"] == subtype]


def _ask(path: Path, request: dict) -> dict:
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.connect(str(path))
        conn.sendall(json.dumps(request).encode() + b"\n")

        return json.loads(conn.makefile().readline())


@functools.cache
def _already_supervised() -> bool:
    with tempfile.TemporaryDirectory() as scratch:
        probe = subprocess.run(
            [str(SUPERVISOR), "--socket", "probe.sock", "--", "true"],
            cwd=scratch,
            env={**os.environ, "CLAUDEBOX_VERBOSE": "1"},
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

    return os.strerror(errno.EBUSY) in probe.stderr


def _wait_for(condition, timeout_s: float = 10.0) -> None:
    deadline = time.monotonic() + timeout_s

    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)
