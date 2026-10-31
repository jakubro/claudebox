"""Runtime class resolver - agent name -> runtime class for daemon-side defaults lookup.

Lazy-imports each runtime so a Claude-only deployment doesn't pull the langgraph dep tree (and
vice versa). Daemon-side code needing capability matrix + catalog defaults calls
``resolve_runtime_class(agent)`` instead of referencing ``ClaudeRuntime`` directly, keeping the
workspace's `agent` TOML key authoritative.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .catalogs import EffortLevel, Model, PermissionMode, Skill
from .config import RuntimeCapabilities
from .errors import UnknownRuntime


class RuntimeClass(Protocol):
    """Class-level surface every runtime exposes before any session exists."""

    runtime_name: str
    CAPABILITIES: RuntimeCapabilities
    AVAILABLE_MODELS: list[Model]
    AVAILABLE_EFFORT_LEVELS: list[EffortLevel]
    AVAILABLE_PERMISSION_MODES: list[PermissionMode]

    def get_default_model(self) -> str: ...

    def get_default_effort_level(self) -> str: ...

    def get_default_permission_mode(self) -> str: ...

    def get_skills(
        self,
        commands_dir: Path | None = None,
        skills_dir: Path | None = None,
    ) -> list[Skill]: ...


def resolve_runtime_class(agent: str) -> RuntimeClass:
    """Return the runtime class for an `agent` string from workspace TOML.

    Lazy-imports the runtime, so neither one loads until first asked for.
    """

    if agent == "claude":
        from .runtime_claude import ClaudeRuntime

        return ClaudeRuntime

    if agent == "langgraph":
        from .runtime_langgraph import LangGraphRuntime

        return LangGraphRuntime

    raise UnknownRuntime(f"unknown runtime: {agent!r}")
