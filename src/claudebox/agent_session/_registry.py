"""Runtime class resolver - agent name -> runtime class for daemon-side defaults lookup.

Lazy-imports each runtime so a Claude-only deployment doesn't pull the langgraph
dep tree (and vice versa). Daemon-side code that needs capability matrix +
catalog defaults for a workspace's configured agent calls
``resolve_runtime_class(agent)`` rather than referencing ``ClaudeRuntime``
directly. The hardcoded-default pattern (referencing ClaudeRuntime from the
daemon) leaked Claude defaults into LangGraph workspaces; routing through
this resolver keeps the workspace's `agent` TOML key authoritative.
"""

from .errors import UnknownRuntime
from .protocol import AgentSession


def resolve_runtime_class(agent: str) -> type[AgentSession]:
    """Return the runtime class for an `agent` string from workspace TOML.

    Lazy-imports the runtime - neither runtime is loaded until first asked for.
    """

    if agent == "claude":
        from .runtime_claude import ClaudeRuntime

        return ClaudeRuntime

    if agent == "langgraph":
        from .runtime_langgraph import LangGraphRuntime

        return LangGraphRuntime

    raise UnknownRuntime(f"unknown runtime: {agent!r}")
