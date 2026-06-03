from .config import AgentSessionConfig, ClaudeAgentSessionConfig
from .errors import UnknownRuntime
from .protocol import AgentSession
from .runtime_claude import ClaudeRuntime


def make_agent_session(config: AgentSessionConfig) -> AgentSession:
    """Construct the runtime adapter for the configured runtime."""

    if config.runtime == "claude":
        assert isinstance(config, ClaudeAgentSessionConfig)
        return ClaudeRuntime(config)

    raise UnknownRuntime(config.runtime)
