"""Runtime-neutral metadata catalogs - Model / PermissionMode / EffortLevel / Skill / ContextUsage.

Shapes only; concrete values + filesystem-walked skill loader live on the
adapter (e.g. `ClaudeRuntime.AVAILABLE_MODELS` and `ClaudeRuntime.get_skills`).
"""

from dataclasses import dataclass, field
from typing import Literal

from ..core.structures import DataClass


@dataclass
class Model(DataClass):
    """Model descriptor."""

    id: str
    name: str
    context_window: int


@dataclass
class PermissionMode(DataClass):
    """Permission mode descriptor."""

    id: str
    name: str
    description: str


@dataclass
class EffortLevel(DataClass):
    """Effort level descriptor."""

    id: str
    name: str


@dataclass(frozen=True)
class Skill:
    """Parsed metadata for a single skill file."""

    name: str
    usage: str | None = None
    description: str | None = None
    argument_hint: str | None = None
    allowed_tools: list[str] | None = None
    model: str | None = None
    effort: str | None = None
    context: str | None = None
    agent: str | None = None
    user_invocable: bool = True
    disable_model_invocation: bool = False
    when_to_use: str | None = None
    paths: list[str] | None = None
    shell: str | None = None


@dataclass(frozen=True)
class ContextUsage:
    """Context-window usage telemetry - used / max tokens."""

    used_tokens: int
    max_tokens: int


EffortLevelId = Literal["max", "xhigh", "high", "medium", "low"]
PermissionModeId = Literal["default", "plan", "acceptEdits", "bypassPermissions", "dontAsk", "auto"]
