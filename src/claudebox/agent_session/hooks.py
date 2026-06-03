"""HookCallbacks — typed callback surface registered on an AgentSession."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class CompactStartPayload:
    """Pre-compaction trigger, translated to claudebox vocabulary."""

    trigger: Literal["context_limit", "manual"]


@dataclass
class HookCallbacks:
    """Optional lifecycle callbacks fired by the runtime."""

    on_session_start: Callable[[], Awaitable[None]] | None = None
    on_pre_compact: Callable[[CompactStartPayload], Awaitable[None]] | None = None
    on_model_changed: Callable[[str], Awaitable[None]] | None = None
    on_permission_mode_changed: Callable[[str], Awaitable[None]] | None = None
    on_effort_level_changed: Callable[[str], Awaitable[None]] | None = None
