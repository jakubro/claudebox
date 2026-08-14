"""Sub-agent dispatcher - task(description, agent_type) spawns a focused sub-agent.

Each `task` call runs to completion against the parent's chat-model factory and returns only the
final message, matching Claude's Task tool encapsulation where intermediate steps stay hidden.
Recursion is bounded by `subagent_depth`, capped at `_MAX_SUBAGENT_DEPTH`, raising rather than
crashing on overflow.

That encapsulation rests on a run tag, not on stream separation: LangChain propagates the parent's
callbacks into the sub-graph, so every sub-agent call DOES arrive on the parent's `astream_events`
stream. `SUBAGENT_RUN_TAG` marks them and the runtime's turn loop skips anything carrying it -
without that, a sub-agent's reply renders as the parent's own message and double-counts tokens.

Cost telemetry: sub-agent `AIMessage`s carry `usage_metadata`; totals fold into the parent's cost
counters via `ctx.record_subagent_usage(input, output)` after completion.
"""

from dataclasses import replace

from langchain.agents import create_agent
from langchain_core.messages import HumanMessage
from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext


# Marks every run inside a sub-agent invocation. Set here, read by the runtime's turn loop.
SUBAGENT_RUN_TAG = "claudebox:subagent"

_MAX_SUBAGENT_DEPTH = 3


def make_subagent_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the `task` sub-agent dispatcher.

    Returns an empty list when `agent_registry`/`chat_model_factory` are unset, so a misconfigured
    runtime surfaces as an unbound tool rather than a crash mid-invocation.
    """

    if ctx.agent_registry is None or ctx.chat_model_factory is None:
        return []

    registry = ctx.agent_registry
    chat_model_factory = ctx.chat_model_factory

    @tool
    async def task(description: str, agent_type: str = "general-purpose") -> str:
        """Spawn a sub-agent to handle a focused task; return its final report.

        The sub-agent runs to completion under its own isolated graph; only the final report joins
        the parent conversation. `agent_type` selects from the workspace's agent registry; v1 ships
        `general-purpose` only.
        """

        next_depth = ctx.subagent_depth + 1

        if next_depth > _MAX_SUBAGENT_DEPTH:
            raise ToolException(
                f"task: sub-agent recursion cap ({_MAX_SUBAGENT_DEPTH}) reached at "
                f"depth {ctx.subagent_depth}; refusing to spawn another nested agent.",
            )

        agent_def = registry.get(agent_type)

        if agent_def is None:
            available = ", ".join(registry.names()) or "<none>"

            raise ToolException(f"task: unknown agent_type {agent_type!r}; available: {available}")

        # Late import avoids a circular reference: __init__.py imports this module for make_tools.
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

        result = await sub_graph.ainvoke(
            {"messages": [HumanMessage(content=description)]},
            config={"tags": [SUBAGENT_RUN_TAG]},
        )

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


__all__ = ["SUBAGENT_RUN_TAG", "make_subagent_tools"]
