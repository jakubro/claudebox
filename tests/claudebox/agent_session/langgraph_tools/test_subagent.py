"""subagent.py @tool tests - task() sub-agent dispatcher + agent registry."""

from dataclasses import replace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.language_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import ToolException

from claudebox.agent_session._agent_registry import (
    GENERAL_PURPOSE,
    AgentDefinition,
    AgentRegistry,
    default_registry,
)
from claudebox.agent_session.langgraph_tools.subagent import (
    _MAX_SUBAGENT_DEPTH,
    make_subagent_tools,
)


class _ToolingFakeChatModel(FakeListChatModel):
    """FakeListChatModel that supports bind_tools (returns self).

    langchain's create_agent calls model.bind_tools(...) during graph
    construction. The stock FakeListChatModel raises NotImplementedError on
    that path because it has no tool-binding implementation. Returning self
    is sufficient for the sub-agent loop to reach a terminal AIMessage on
    the first chat-model emit (content-only responses have no tool_calls
    so the loop ends immediately).
    """

    def bind_tools(self, tools, **kwargs):
        return self


def _configured_ctx(tool_ctx, **overrides):
    """Return tool_ctx with agent_registry + chat_model_factory populated."""

    base = replace(
        tool_ctx,
        agent_registry=default_registry(),
        chat_model_factory=lambda: _ToolingFakeChatModel(responses=["sub-agent done"]),
    )

    return replace(base, **overrides) if overrides else base


def _patch_create_agent(monkeypatch, *, messages):
    """Patch create_agent so each call returns a stub graph yielding `messages`.

    Returns a `captured` dict populated with the constructor kwargs of the
    last call so tests can assert what was passed to create_agent.
    """

    captured: dict[str, Any] = {}

    def fake_create(*, model, tools, system_prompt=None, **kwargs):
        captured["model"] = model
        captured["tools"] = tools
        captured["system_prompt"] = system_prompt
        captured["kwargs"] = kwargs

        graph = MagicMock(name="sub_graph")
        graph.ainvoke = AsyncMock(return_value={"messages": messages})

        return graph

    monkeypatch.setattr(
        "claudebox.agent_session.langgraph_tools.subagent.create_agent",
        fake_create,
    )

    return captured


class TestMakeSubagentTools:
    def test_returns_empty_when_agent_registry_missing(self, tool_ctx):
        ctx = replace(tool_ctx, agent_registry=None, chat_model_factory=lambda: None)

        assert make_subagent_tools(ctx) == []

    def test_returns_empty_when_chat_model_factory_missing(self, tool_ctx):
        ctx = replace(tool_ctx, agent_registry=default_registry(), chat_model_factory=None)

        assert make_subagent_tools(ctx) == []

    def test_returns_single_task_tool_when_fully_configured(self, tool_ctx):
        tools = make_subagent_tools(_configured_ctx(tool_ctx))

        assert [t.name for t in tools] == ["task"]


class TestTaskRegistryLookup:
    @pytest.mark.anyio
    async def test_unknown_agent_type_raises_with_available_list(self, tool_ctx):
        task = make_subagent_tools(_configured_ctx(tool_ctx))[0]

        with pytest.raises(ToolException) as exc:
            await task.ainvoke({"description": "noop", "agent_type": "missing"})

        message = str(exc.value)
        assert "unknown agent_type 'missing'" in message
        assert "general-purpose" in message


class TestTaskRecursionGuard:
    @pytest.mark.anyio
    async def test_raises_at_cap(self, tool_ctx):
        ctx = _configured_ctx(tool_ctx, subagent_depth=_MAX_SUBAGENT_DEPTH)
        task = make_subagent_tools(ctx)[0]

        with pytest.raises(ToolException, match="recursion cap"):
            await task.ainvoke({"description": "noop"})

    @pytest.mark.anyio
    async def test_allows_one_below_cap(self, tool_ctx, monkeypatch):
        ctx = _configured_ctx(tool_ctx, subagent_depth=_MAX_SUBAGENT_DEPTH - 1)
        _patch_create_agent(
            monkeypatch,
            messages=[HumanMessage(content="x"), AIMessage(content="ok")],
        )

        task = make_subagent_tools(ctx)[0]

        result = await task.ainvoke({"description": "deep work"})

        assert result == "ok"


class TestTaskExecution:
    @pytest.mark.anyio
    async def test_returns_final_message_content_string(self, tool_ctx, monkeypatch):
        _patch_create_agent(
            monkeypatch,
            messages=[
                HumanMessage(content="please"),
                AIMessage(content="the report"),
            ],
        )

        task = make_subagent_tools(_configured_ctx(tool_ctx))[0]

        assert await task.ainvoke({"description": "x"}) == "the report"

    @pytest.mark.anyio
    async def test_flattens_block_list_final_content(self, tool_ctx, monkeypatch):
        _patch_create_agent(
            monkeypatch,
            messages=[
                AIMessage(
                    content=[
                        {"type": "text", "text": "Part A. "},
                        {"type": "text", "text": "Part B."},
                    ]
                ),
            ],
        )

        task = make_subagent_tools(_configured_ctx(tool_ctx))[0]

        assert await task.ainvoke({"description": "x"}) == "Part A. Part B."

    @pytest.mark.anyio
    async def test_returns_empty_string_when_no_messages(self, tool_ctx, monkeypatch):
        _patch_create_agent(monkeypatch, messages=[])

        task = make_subagent_tools(_configured_ctx(tool_ctx))[0]

        assert await task.ainvoke({"description": "x"}) == ""

    @pytest.mark.anyio
    async def test_passes_agent_definition_prompt_to_subgraph(self, tool_ctx, monkeypatch):
        captured = _patch_create_agent(monkeypatch, messages=[AIMessage(content="ok")])

        task = make_subagent_tools(_configured_ctx(tool_ctx))[0]
        await task.ainvoke({"description": "x"})

        assert captured["system_prompt"] == GENERAL_PURPOSE.system_prompt

    @pytest.mark.anyio
    async def test_real_create_agent_with_fake_chat_model(self, tool_ctx):
        """Smoke against the real langchain create_agent path.

        Uses FakeListChatModel which returns a content-only AIMessage with no
        tool_calls - create_agent terminates immediately and the task
        tool returns the final content unchanged.
        """

        task = make_subagent_tools(_configured_ctx(tool_ctx))[0]

        result = await task.ainvoke({"description": "any prompt"})

        assert result == "sub-agent done"


class TestTaskAllowlistFiltering:
    @pytest.mark.anyio
    async def test_allowlist_filters_tools_passed_to_subgraph(self, tool_ctx, monkeypatch):
        narrow_def = AgentDefinition(
            name="narrow",
            system_prompt="prompt",
            tools=("read_file",),
        )
        registry = AgentRegistry(definitions={"narrow": narrow_def})
        ctx = _configured_ctx(tool_ctx, agent_registry=registry)
        captured = _patch_create_agent(monkeypatch, messages=[AIMessage(content="ok")])

        task = make_subagent_tools(ctx)[0]
        await task.ainvoke({"description": "x", "agent_type": "narrow"})

        sub_tool_names = {t.name for t in captured["tools"]}
        assert sub_tool_names == {"read_file"}

    @pytest.mark.anyio
    async def test_none_allowlist_grants_every_tool(self, tool_ctx, monkeypatch):
        captured = _patch_create_agent(monkeypatch, messages=[AIMessage(content="ok")])

        task = make_subagent_tools(_configured_ctx(tool_ctx))[0]
        await task.ainvoke({"description": "x"})

        # 9 simple-port tools (.a) + 1 task (.c, recursive) = 10 - but recursion
        # cap permits the nested task to bind too at depth 1, so the sub-agent
        # sees the full surface.
        sub_tool_names = {t.name for t in captured["tools"]}
        assert "read_file" in sub_tool_names
        assert "task" in sub_tool_names


class TestTaskDepthPropagation:
    @pytest.mark.anyio
    async def test_child_ctx_carries_incremented_depth(self, tool_ctx, monkeypatch):
        captured = _patch_create_agent(monkeypatch, messages=[AIMessage(content="ok")])

        task = make_subagent_tools(_configured_ctx(tool_ctx, subagent_depth=1))[0]
        await task.ainvoke({"description": "x"})

        # The bound `task` tool inside the sub-agent's tool list is created
        # by make_subagent_tools(sub_ctx) - closed over the sub_ctx with
        # depth=2. Confirming via the registry path: at depth 2, calling
        # task again should still succeed (depth+1=3 is the cap).
        nested = next(t for t in captured["tools"] if t.name == "task")

        # The nested task's closure carries depth=2; one more call permits
        # (3 == cap, depth+1 would be 4 > cap -> ToolException).
        captured_inner = _patch_create_agent(monkeypatch, messages=[AIMessage(content="inner")])
        result = await nested.ainvoke({"description": "y"})
        assert result == "inner"

        # And the next layer is blocked.
        third = next(t for t in captured_inner["tools"] if t.name == "task")

        with pytest.raises(ToolException, match="recursion cap"):
            await third.ainvoke({"description": "z"})


class TestTaskUsageBubbleUp:
    @pytest.mark.anyio
    async def test_record_subagent_usage_called_with_aggregated_tokens(self, tool_ctx, monkeypatch):
        recorded: list[tuple[int, int]] = []
        ctx = _configured_ctx(
            tool_ctx,
            record_subagent_usage=lambda i, o: recorded.append((i, o)),
        )
        _patch_create_agent(
            monkeypatch,
            messages=[
                AIMessage(
                    content="part1",
                    usage_metadata={"input_tokens": 10, "output_tokens": 2, "total_tokens": 12},
                ),
                AIMessage(
                    content="part2",
                    usage_metadata={"input_tokens": 5, "output_tokens": 3, "total_tokens": 8},
                ),
            ],
        )

        task = make_subagent_tools(ctx)[0]
        await task.ainvoke({"description": "x"})

        assert recorded == [(15, 5)]

    @pytest.mark.anyio
    async def test_record_subagent_usage_not_called_when_no_tokens(self, tool_ctx, monkeypatch):
        recorded: list[tuple[int, int]] = []
        ctx = _configured_ctx(
            tool_ctx,
            record_subagent_usage=lambda i, o: recorded.append((i, o)),
        )
        _patch_create_agent(monkeypatch, messages=[AIMessage(content="hello")])

        task = make_subagent_tools(ctx)[0]
        await task.ainvoke({"description": "x"})

        assert recorded == []

    @pytest.mark.anyio
    async def test_runs_when_record_subagent_usage_unset(self, tool_ctx, monkeypatch):
        """Missing sink does not raise - usage aggregation skipped silently."""

        ctx = _configured_ctx(tool_ctx, record_subagent_usage=None)
        _patch_create_agent(
            monkeypatch,
            messages=[
                AIMessage(
                    content="ok",
                    usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                )
            ],
        )

        task = make_subagent_tools(ctx)[0]

        assert await task.ainvoke({"description": "x"}) == "ok"


class TestAgentRegistry:
    def test_default_registry_contains_general_purpose(self):
        registry = default_registry()

        assert registry.get("general-purpose") is GENERAL_PURPOSE
        assert registry.names() == ["general-purpose"]

    def test_get_unknown_returns_none(self):
        registry = default_registry()

        assert registry.get("nope") is None

    def test_names_sorted_for_stable_error_rendering(self):
        registry = AgentRegistry(
            definitions={
                "zeta": AgentDefinition(name="zeta", system_prompt="z", tools=None),
                "alpha": AgentDefinition(name="alpha", system_prompt="a", tools=None),
                "general-purpose": GENERAL_PURPOSE,
            }
        )

        assert registry.names() == ["alpha", "general-purpose", "zeta"]

    def test_general_purpose_tools_none_means_full_toolset(self):
        assert GENERAL_PURPOSE.tools is None
