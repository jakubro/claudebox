"""Bash read-only marks end to end: real session, pipeline and runtime against a scripted agent CLI."""

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
    "tu_lists": "cd /srv/app && ls -a; echo done",
    "tu_reads_git": "git -C /srv/app rev-parse HEAD",
    "tu_lowercase": "dir=/srv/app; ls -a $dir",
    "tu_writes": "ls -a > listing.txt",
    "tu_log": "git log --oneline -5",
    "tu_show": "git show HEAD:README.md",
    "tu_blame": "git blame app.py",
    "tu_sort": "ls -a | sort",
    "tu_heredoc": "cat <<'EOF'\nfirst\nsecond\nEOF",
    "tu_uppercase": "DIR=/srv/app; ls -a $DIR",
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


@pytest.mark.anyio
@pytest.mark.parametrize("tool_use_id", ["tu_lists", "tu_lowercase"])
async def test_a_command_that_changes_nothing_is_stored_marked(stored_calls, tool_use_id):
    assert stored_calls[tool_use_id]["command_read_only"] is True


# SPEC: tool:bash-changing-cases
@pytest.mark.anyio
@pytest.mark.parametrize(
    "tool_use_id",
    ["tu_reads_git", "tu_log", "tu_show", "tu_blame", "tu_sort", "tu_heredoc", "tu_uppercase"],
)
async def test_git_sort_heredoc_and_capitalised_variables_count_as_changing(
    stored_calls,
    tool_use_id,
):
    assert stored_calls[tool_use_id]["command_read_only"] is None


@pytest.mark.anyio
@pytest.mark.parametrize("tool_use_id", ["tu_writes", "tu_unreadable"])
async def test_any_other_command_is_stored_unmarked(stored_calls, tool_use_id):
    call = stored_calls[tool_use_id]

    assert call["command_read_only"] is None
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
