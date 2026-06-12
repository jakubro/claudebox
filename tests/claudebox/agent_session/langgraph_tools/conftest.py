"""Shared fixtures for the langgraph_tools test tree."""

from pathlib import Path

import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.langgraph_tools import ToolCatalog, ToolContext


@pytest.fixture
def tool_ctx(tmp_path: Path) -> ToolContext:
    """Minimal ToolContext for direct @tool function tests."""

    config = LangGraphAgentSessionConfig(
        runtime="langgraph",
        model="ollama:llama3.2:3b",
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="test-session",
        resume_session_id=None,
        session_dir=tmp_path / ".session",
        hooks=HookCallbacks(),
    )

    return ToolContext(
        workspace_path=tmp_path,
        session_id="test-session",
        session_dir=tmp_path / ".session",
        config=config,
        hooks=HookCallbacks(),
        logger=None,
        tool_catalog=ToolCatalog(),
    )
