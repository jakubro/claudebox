"""Sub-agent dispatcher - task(description, agent_type) spawns a focused sub-agent.

Each `task` invocation builds a fresh `create_agent` sub-graph, runs it
to completion against the parent's chat-model factory, and returns the
sub-agent's final message content as a tool result. Matches Claude's Task
tool encapsulation: the sub-agent's own tool events DO NOT broadcast to the
parent stream - they live inside the awaited `ainvoke` and never reach the
parent runtime's `astream_events` loop.

Recursion is bounded: each nested `task` call increments `subagent_depth` on
a fresh sub-`ToolContext` (via `dataclasses.replace`); when the next depth
would exceed `_MAX_SUBAGENT_DEPTH`, the tool raises so the model can recover.

Cost telemetry: the sub-agent's chat-model calls produce `usage_metadata` on
each emitted `AIMessage`. After completion the totals fold into the parent
runtime's running counters via `ctx.record_subagent_usage(input, output)`,
which the runtime binds to its `_accumulate_subagent_usage` method. The
parent's per-turn cost emit picks up the contribution.
"""

from dataclasses import replace

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage
from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext


_MAX_SUBAGENT_DEPTH = 3


def make_subagent_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the `task` sub-agent dispatcher.

    Returns an empty list when the runtime did not populate `agent_registry`
    or `chat_model_factory` - a misconfigured runtime then surfaces as the
    model encountering an unbound tool rather than as a runtime crash mid
    invocation.
    """

    if ctx.agent_registry is None or ctx.chat_model_factory is None:
        return []

    registry = ctx.agent_registry
    chat_model_factory = ctx.chat_model_factory

    @tool
    async def task(description: str, agent_type: str = "general-purpose") -> str:
        """Spawn a sub-agent to handle a focused task; return its final report.

        The sub-agent receives `description` as its initial message and runs
        to completion under its own isolated graph. Its individual tool calls
        do NOT broadcast to the parent stream. `agent_type` selects from the
        workspace's agent registry; v1 ships `general-purpose` only.
        """

        next_depth = ctx.subagent_depth + 1

        if next_depth > _MAX_SUBAGENT_DEPTH:
            raise ToolException(
                f"task: sub-agent recursion cap ({_MAX_SUBAGENT_DEPTH}) reached at "
                f"depth {ctx.subagent_depth}; refusing to spawn another nested agent."
            )

        agent_def = registry.get(agent_type)

        if agent_def is None:
            available = ", ".join(registry.names()) or "<none>"

            raise ToolException(f"task: unknown agent_type {agent_type!r}; available: {available}")

        # Late import breaks the circular reference (this module is imported
        # by langgraph_tools/__init__.py, which exports make_tools).
        from . import make_tools

        sub_ctx = replace(ctx, subagent_depth=next_depth)
        sub_tools = make_tools(sub_ctx)

        if agent_def.tools is not None:
            allowed = set(agent_def.tools)
            sub_tools = [t for t in sub_tools if t.name in allowed]

        sub_graph = create_agent(
            model=chat_model_factory(),
            tools=sub_tools,
            system_prompt=agent_def.system_prompt,
        )

        result = await sub_graph.ainvoke({"messages": [HumanMessage(content=description)]})

        messages = result.get("messages") or []

        if ctx.record_subagent_usage is not None:
            input_total = 0
            output_total = 0

            for msg in messages:
                usage = getattr(msg, "usage_metadata", None) or {}
                input_total += int(usage.get("input_tokens", 0))
                output_total += int(usage.get("output_tokens", 0))

            if input_total or output_total:
                ctx.record_subagent_usage(input_total, output_total)

        if not messages:
            return ""

        final = messages[-1]
        content = getattr(final, "content", "")

        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            parts: list[str] = []

            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    parts.append(block)

            return "".join(parts)
        else:
            return str(content)

    return [task]


__all__ = ["make_subagent_tools"]
