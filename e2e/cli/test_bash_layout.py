"""A Bash call's command laid out end to end: real session, pipeline and Claude runtime, a scripted
agent CLI that calls Bash, and the events the session stores."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from claude_agent_sdk import AssistantMessage
from claude_agent_sdk.types import ContentBlock, TextBlock, ToolUseBlock

from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from claudebox.workspace import Workspace
from .scripted_cli import ScriptedCli


COMMANDS = {
    "tu_seq": "cd /srv/app; cat VERSION; echo ---; git log --oneline -5 | cat",
    "tu_chain": (
        "cd /tmp && printf '%s\\n' alpha-first-entry-of-the-list beta-second-entry-of-the-list "
        "gamma-third-entry-of-the-list | sort -r | head -n 2"
    ),
    "tu_heredoc": "cat > notes.txt <<'EOF'\nfirst; second\n  indented\nEOF",
    "tu_unreadable": 'echo "unterminated',
}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    (tmp_path / ".workspace").touch()
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.chdir(tmp_path)

    return tmp_path


class BashCli(ScriptedCli):
    def reply(self) -> list:
        calls: list[ContentBlock] = [
            ToolUseBlock(id=i, name="Bash", input={"command": c}) for i, c in COMMANDS.items()
        ]

        return [
            AssistantMessage(content=calls, model="m"),
            AssistantMessage(content=[TextBlock(text="ok")], model="m"),
            self.result("ok"),
        ]


@pytest.fixture
async def stored_calls(workspace) -> dict[str, dict]:
    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", BashCli):
        session = ContainerSession(workspace=workspace, remaps_tmp=False)
        session_id = await session.start()

        try:
            await session.send("run them")
            events_file = _events_file(workspace, session_id)

            async with asyncio.timeout(10):
                while not _events(events_file, "result"):
                    await asyncio.sleep(0.05)
        finally:
            await session.stop()

    return {e["tool_use_id"]: e for e in _events(events_file, "tool_use")}


# SPEC: tool:bash-command-layout
@pytest.mark.anyio
async def test_commands_joined_by_semicolons_are_stored_one_per_line(stored_calls):
    call = stored_calls["tu_seq"]

    assert (
        call["command_layout"] == "cd /srv/app\ncat VERSION\necho ---\ngit log --oneline -5 | cat"
    )
    assert call["tool_input"]["command"] == COMMANDS["tu_seq"]


# SPEC: tool:bash-command-chain-break
@pytest.mark.anyio
async def test_a_long_chain_breaks_before_each_operator(stored_calls):
    assert stored_calls["tu_chain"]["command_layout"].split("\n") == [
        "cd /tmp \\",
        (
            "  && printf '%s\\n' alpha-first-entry-of-the-list beta-second-entry-of-the-list "
            "gamma-third-entry-of-the-list \\"
        ),
        "  | sort -r \\",
        "  | head -n 2",
    ]


# SPEC: tool:bash-command-words-kept
# SPEC: tool:bash-command-unreadable
@pytest.mark.anyio
@pytest.mark.parametrize("tool_use_id", ["tu_heredoc", "tu_unreadable"])
async def test_a_command_with_nothing_to_lay_out_is_stored_as_sent(stored_calls, tool_use_id):
    call = stored_calls[tool_use_id]

    assert call["command_layout"] is None
    assert call["tool_input"]["command"] == COMMANDS[tool_use_id]


def _events_file(workspace: Path, session_id: str) -> Path:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None

    return session.path / "events.jsonl"


def _events(path: Path, subtype: str) -> list[dict]:
    if not path.exists():
        return []

    events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    return [e for e in events if e["subtype"] == subtype or e["type"] == subtype]
