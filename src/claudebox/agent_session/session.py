from .config import AgentSessionConfig, ClaudeAgentSessionConfig, LangGraphAgentSessionConfig
from .errors import UnknownRuntime
from .protocol import AgentSession
from .runtime_claude import ClaudeRuntime


def make_agent_session(config: AgentSessionConfig) -> AgentSession:
    """Construct the runtime adapter for the configured runtime."""

    if config.runtime == "claude":
        assert isinstance(config, ClaudeAgentSessionConfig)

        return ClaudeRuntime(config)

    if config.runtime == "langgraph":
        # Lazy import keeps langgraph / langchain deps out of the Claude-only path.
        from .runtime_langgraph import LangGraphRuntime

        assert isinstance(config, LangGraphAgentSessionConfig)

        return LangGraphRuntime(config)

    raise UnknownRuntime(config.runtime)
