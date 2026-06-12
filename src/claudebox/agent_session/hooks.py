"""HookCallbacks - typed callback surface registered on an AgentSession."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class CompactStartPayload:
    """Pre-compaction trigger, translated to claudebox vocabulary."""

    trigger: Literal["context_limit", "manual"]


@dataclass(frozen=True)
class PreToolUsePayload:
    """Snapshot of a tool invocation just before the runtime executes it."""

    tool_use_id: str
    tool_name: str
    tool_input: dict[str, Any]


@dataclass(frozen=True)
class PostToolUsePayload:
    """Snapshot of a tool invocation after execution completes.

    ``is_error`` is True for both runtime-detected failures (Claude SDK's
    PostToolUseFailure event; LangGraph's ToolMessage.status == "error" or an
    exception propagated through the handler) and tool-reported errors.
    A single callback observes both success and failure; consumers branch on
    ``is_error`` rather than registering a second callback.

    ``tool_use_result`` carries whatever the runtime surfaced - typically the
    tool's text response, optionally a structured dict for tools that return
    one, and None when the runtime gave no payload (timeouts, abort).

    ``duration_ms`` is wall-clock from PreToolUse to PostToolUse in the
    Claude SDK path and from handler enter to handler return in the LangGraph
    middleware path. Falls back to 0 only when the pre-side observer was
    unregistered (impossible under normal wiring).
    """

    tool_use_id: str
    tool_name: str
    tool_input: dict[str, Any]
    tool_use_result: str | dict[str, Any] | None
    is_error: bool
    duration_ms: int


@dataclass
class HookCallbacks:
    """Optional lifecycle callbacks fired by the runtime."""

    on_session_start: Callable[[], Awaitable[None]] | None = None
    on_pre_compact: Callable[[CompactStartPayload], Awaitable[None]] | None = None
    on_model_changed: Callable[[str], Awaitable[None]] | None = None
    on_permission_mode_changed: Callable[[str], Awaitable[None]] | None = None
    on_effort_level_changed: Callable[[str], Awaitable[None]] | None = None
    on_pre_tool_use: Callable[[PreToolUsePayload], Awaitable[None]] | None = None
    on_post_tool_use: Callable[[PostToolUsePayload], Awaitable[None]] | None = None
