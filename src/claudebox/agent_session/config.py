"""AgentSessionConfig and RuntimeCapabilities - runtime-neutral configuration surface."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .hooks import HookCallbacks


# Default SDK stdio buffer (1 GiB) - session.py overrides explicitly.
_DEFAULT_PROCESS_BUFFER_SIZE = 1024 * 1024 * 1024


@dataclass
class RuntimeCapabilities:
    """Static support matrix for a runtime adapter. All 16 fields required."""

    supports_set_model_mid_session: bool
    supports_set_permission_mode: bool
    supports_set_effort_level: bool
    supports_pre_compact_hook: bool
    supports_mcp_delegation: bool
    supports_models: bool
    supports_effort_levels: bool
    supports_permission_modes: bool
    supports_skills: bool
    supports_context_usage: bool
    supports_cost_telemetry: bool
    supports_manual_compact: bool
    supports_session_resume: bool
    supports_session_fork: bool
    supports_session_rewind: bool
    supports_ask_user_question: bool


@dataclass
class AgentSessionConfig:
    """Universal config fields shared across all AgentSession runtimes."""

    runtime: Literal["claude", "langgraph"]
    model: str | None
    permission_mode: str | None
    effort_level: str | None
    cwd: str
    env: dict[str, str]
    session_id: str | None
    resume_session_id: str | None
    session_dir: Path
    hooks: HookCallbacks = field(default_factory=HookCallbacks)


@dataclass
class ClaudeAgentSessionConfig(AgentSessionConfig):
    """Claude-specific config fields."""

    system_prompt: str | None = None
    setting_sources: list[str] = field(default_factory=lambda: ["user", "project"])
    sdk_passthrough: dict[str, Any] = field(default_factory=dict)
    max_buffer_size: int = _DEFAULT_PROCESS_BUFFER_SIZE
    debug_mode: bool = False


@dataclass
class LangGraphAgentSessionConfig(AgentSessionConfig):
    """LangGraph-specific config fields - model id + per-provider kwargs + cost / window overrides.

    `model` is required; workspaces set `[langgraph] model = "provider:model-id"`, or connect() raises.

    `max_tokens_override` bypasses `MODEL_CONTEXT_WINDOW`: when set, `_model_context_window()` returns it directly.

    `provider_kwargs` holds `[langgraph.<provider>]` knobs (e.g. `base_url`), forwarded verbatim
    to `init_chat_model(**provider_kwargs)`; unknown kwargs raise at provider init.

    `cost_overrides` holds `[langgraph.cost]` per-model USD overrides (bare model id, no provider prefix);
    `lookup_price` checks these before the curated `PRICE_PER_MTOK` table.

    `web_search_provider` picks the langgraph web_search backend: `duckduckgo` is the default (no key);
    `tavily` and `brave` need a key resolved via `web_search_api_key_env`.

    `mcp_servers` carries `[langgraph.mcp.<name>]` TOML blocks as per-server connection dicts
    (langchain-mcp-adapters TypedDict shape); an empty dict means no MCP servers configured.

    `profile_hooks` maps a lifecycle event to its profile script, from `[langgraph.hooks]`;
    only `session_start` is consumed today, and an empty dict falls back to the conventional path.

    `system_prompt` is the persona handed to the graph, via the same `--system-prompt` argument
    the container API server already accepts for the Claude runtime.
    """

    max_tokens_override: int | None = None
    web_search_provider: str = "duckduckgo"
    web_search_api_key_env: str | None = None
    mcp_servers: dict[str, dict[str, Any]] = field(default_factory=dict)
    provider_kwargs: dict[str, Any] = field(default_factory=dict)
    cost_overrides: dict[str, dict[str, float]] = field(default_factory=dict)
    profile_hooks: dict[str, str] = field(default_factory=dict)
    system_prompt: str | None = None
