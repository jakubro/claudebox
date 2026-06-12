"""Resolver maps workspace `agent` strings to runtime classes."""

import pytest

from claudebox import UnknownRuntime, resolve_runtime_class


def test_resolves_claude_to_claude_runtime():
    from claudebox.agent_session.runtime_claude import ClaudeRuntime

    cls = resolve_runtime_class("claude")

    assert cls is ClaudeRuntime
    assert cls.runtime_name == "Claude"


def test_resolves_langgraph_to_langgraph_runtime():
    from claudebox.agent_session.runtime_langgraph import LangGraphRuntime

    cls = resolve_runtime_class("langgraph")

    assert cls is LangGraphRuntime
    assert cls.runtime_name == "LangGraph"


def test_unknown_agent_raises_unknown_runtime():
    with pytest.raises(UnknownRuntime, match="bogus"):
        resolve_runtime_class("bogus")
