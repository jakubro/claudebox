"""AgentSessionConfig and RuntimeCapabilities — runtime-neutral configuration surface."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from .hooks import HookCallbacks


# Default SDK stdio buffer (1 GiB) — session.py overrides explicitly.
_DEFAULT_PROCESS_BUFFER_SIZE = 1024 * 1024 * 1024


@dataclass
class RuntimeCapabilities:
    """Static support matrix for a runtime adapter. All 15 fields required."""

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


@dataclass
class AgentSessionConfig:
    """Universal config fields shared across all AgentSession runtimes."""

    runtime: Literal["claude"]
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
