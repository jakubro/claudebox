"""A turn ending on needs_user end to end: real session and runtime against a scripted agent CLI."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from .scripted_cli import ScriptedCli


@pytest.fixture
async def cli_env(tmp_path, monkeypatch) -> dict[str, str]:
    (tmp_path / ".workspace").touch()
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.chdir(tmp_path)
    started = []

    class RecordingCli(ScriptedCli):
        def __init__(self, options):
            super().__init__(options)
            started.append(options)

    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", RecordingCli):
        session = ContainerSession(workspace=tmp_path, remaps_tmp=False)
        await session.start()
        await session.stop()

    (options,) = started

    return options.env


# SPEC: notify:needs-you-ends-turn
@pytest.mark.anyio
async def test_the_agent_cli_may_end_a_turn_on_needs_user(cli_env, tmp_path):
    assert cli_env["CLAUDE_CODE_TERMINAL_MCP_TOOLS"].split(",") == [
        "mcp__claudebox__needs_user",
        "mcp__claudebox__port_open",
    ]
    assert cli_env["CLAUDEBOX_PWD"] == str(tmp_path)
