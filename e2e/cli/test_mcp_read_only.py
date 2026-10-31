"""MCP read-only marks end to end: real session, pipeline and runtime against a scripted agent CLI."""

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


STATUS = {
    "mcpServers": [
        {
            "name": "notes",
            "status": "connected",
            "tools": [
                {"name": "read", "annotations": {"readOnly": True}},
                {"name": "write", "annotations": {}},
            ],
        },
        {
            "name": "team.io Docs",
            "status": "connected",
            "tools": [{"name": "query", "annotations": {"readOnly": True}}],
        },
    ],
}

CALLS = {
    "tu_read": "mcp__notes__read",
    "tu_query": "mcp__team_io_Docs__query",
    "tu_write": "mcp__notes__write",
    "tu_unknown": "mcp__other__read",
    "tu_builtin": "Read",
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


class McpCli(ScriptedCli):
    async def get_mcp_status(self) -> dict:
        return STATUS

    def reply(self) -> list:
        calls: list[ContentBlock] = [
            ToolUseBlock(id=i, name=name, input={}) for i, name in CALLS.items()
        ]

        return [
            AssistantMessage(content=calls, model="m"),
            AssistantMessage(content=[TextBlock(text="ok")], model="m"),
            self.result("ok"),
        ]


@pytest.fixture
async def stored_calls(workspace) -> dict[str, dict]:
    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", McpCli):
        session = ContainerSession(workspace=workspace, remaps_tmp=False)
        session_id = await session.start()

        try:
            await session.send("call them")
            events_file = _events_file(workspace, session_id)

            async with asyncio.timeout(10):
                while not _events(events_file, "result"):
                    await asyncio.sleep(0.05)
        finally:
            await session.stop()

    return {e["tool_use_id"]: e for e in _events(events_file, "tool_use")}


@pytest.mark.anyio
@pytest.mark.parametrize("tool_use_id", ["tu_read", "tu_query"])
async def test_a_tool_its_server_declares_read_only_is_stored_marked(stored_calls, tool_use_id):
    assert stored_calls[tool_use_id]["mcp_read_only"] is True


@pytest.mark.anyio
@pytest.mark.parametrize("tool_use_id", ["tu_write", "tu_unknown", "tu_builtin"])
async def test_any_other_call_is_stored_unmarked(stored_calls, tool_use_id):
    assert stored_calls[tool_use_id]["mcp_read_only"] is None


def _events_file(workspace: Path, session_id: str) -> Path:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None

    return session.path / "events.jsonl"


def _events(path: Path, subtype: str) -> list[dict]:
    if not path.exists():
        return []

    events = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    return [e for e in events if e["subtype"] == subtype or e["type"] == subtype]
