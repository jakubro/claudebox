"""AgentEvent - runtime-neutral event yielded by AgentSession.receive_events.

`AgentEvent.payload` is a tagged union over a `Literal` `EventKind` discriminator;
each kind carries the curated minimum field set its consumers actually read. Block-
level kinds (text / thinking / tool_use / tool_result) flow nested inside
``content_blocks`` lists on user / assistant message payloads - keeps wire-shape
continuity with the JSONL replay path.
"""

from dataclasses import dataclass, field
from typing import Any, Literal


EventKind = Literal[
    "assistant_message",
    "user_message",
    "system_init",
    "result",
    "rate_limit",
    "compact_boundary",
    "task_notification",
]


# Content blocks
# ----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class TextBlock:
    """Plain text emitted by the assistant (or echoed by the user side)."""

    text: str


@dataclass(frozen=True)
class ThinkingBlock:
    """Extended-thinking content (typically assistant-only)."""

    thinking: str


@dataclass(frozen=True)
class ToolUseBlock:
    """Assistant-initiated tool call request."""

    id: str
    name: str
    input: dict[str, Any]


@dataclass(frozen=True)
class ToolResultBlock:
    """Tool execution result, returned via a user-kind message."""

    tool_use_id: str
    content: str | list[dict] | None
    is_error: bool | None = None


@dataclass(frozen=True)
class UnknownBlock:
    """Preserve unknown SDK block classes verbatim - wire-shape continuity.

    Emitted when an upstream runtime ships a block class claudebox doesn't yet
    project to a typed dataclass. Downstream conversion still yields an Event,
    so the user sees a generic block rather than silent data loss.
    """

    class_name: str
    data: dict[str, Any]


ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | UnknownBlock


# Init / result sub-shapes
# ----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class McpServerInit:
    """One MCP server entry from the SDK's init data `mcp_servers` list."""

    name: str
    status: str


@dataclass(frozen=True)
class SystemInitData:
    """Recognised SDK init data fields at the pinned version, plus an `extra` passthrough.

    Fields the SDK adds that claudebox does not yet consume are captured verbatim
    into `extra` by `runtime_claude.py::_translate_sdk_message` (with a one-shot
    warning) rather than raised on - additive SDK releases stay non-breaking,
    mirroring `UnknownBlock`. Promote a key to a typed field here once a consumer
    needs to read it. The promotion fields `session_id` and `model` live on
    `SystemInitPayload` and are excluded here; the wire flatten reinjects them
    into the dict shape for downstream consumers.

    Field names match the SDK's exact emission casing (including `apiKeySource`
    and `permissionMode` camelCase) - the shape is owned by the upstream SDK.
    """

    agents: list[str] = field(default_factory=list)
    analytics_disabled: bool = False
    apiKeySource: str | None = None
    claude_code_version: str | None = None
    cwd: str | None = None
    fast_mode_state: str | None = None
    mcp_servers: list[McpServerInit] = field(default_factory=list)
    memory_paths: dict[str, str] = field(default_factory=dict)
    output_style: str | None = None
    permissionMode: str | None = None
    plugins: list[str] = field(default_factory=list)
    product_feedback_disabled: bool = False
    skills: list[str] = field(default_factory=list)
    slash_commands: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    uuid: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ResultUsage:
    """Per-turn usage telemetry - uniform shape across runtimes."""

    used_tokens: int
    max_tokens: int


# Per-kind payloads
# ----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SystemInitPayload:
    """Session bootstrap signal - carries SDK-emitted init data."""

    subtype: str
    session_id: str
    model: str | None = None
    data: SystemInitData = field(default_factory=SystemInitData)

    def __post_init__(self) -> None:
        if not self.session_id:
            raise ValueError("SystemInitPayload.session_id must be non-empty")


@dataclass(frozen=True)
class UserMessagePayload:
    """User-side message: either plain text or a list of content blocks (tool results)."""

    uuid: str | None
    content: str | list[ContentBlock]
    tool_use_result: dict | None = None
    parent_tool_use_id: str | None = None


@dataclass(frozen=True)
class AssistantMessagePayload:
    """Assistant message: list of content blocks (text, thinking, tool_use)."""

    uuid: str | None
    content: list[ContentBlock]
    model: str | None = None
    parent_tool_use_id: str | None = None


@dataclass(frozen=True)
class ResultPayload:
    """Turn-final result summary - cost, duration, terminal status."""

    subtype: str
    result: str | None = None
    total_cost_usd: float | None = None
    duration_ms: int | None = None
    num_turns: int | None = None
    session_id: str | None = None
    is_error: bool | None = None
    usage: ResultUsage | None = None


@dataclass(frozen=True)
class RateLimitPayload:
    """Rate-limit status transition - curated subset of SDK RateLimitInfo, surfaced non-rendered."""

    status: str | None = None
    resets_at: int | None = None
    rate_limit_type: str | None = None
    utilization: float | None = None


@dataclass(frozen=True)
class CompactBoundaryPayload:
    """Compaction-complete boundary - carries the SDK's compact_metadata."""

    trigger: str
    pre_tokens: int | None = None
    post_tokens: int | None = None
    duration_ms: int | None = None


@dataclass(frozen=True)
class TaskNotificationPayload:
    """Async-subagent terminal signal - carries the SDK task_notification fields.

    `status` is normalized to the claudebox notification vocabulary
    (completed / failed / killed); `summary` is the SDK's one-line summary and
    is later overwritten by the monitor's own output-file extraction when present.
    """

    task_id: str
    status: str
    summary: str | None = None


EventPayload = (
    SystemInitPayload
    | UserMessagePayload
    | AssistantMessagePayload
    | ResultPayload
    | RateLimitPayload
    | CompactBoundaryPayload
    | TaskNotificationPayload
)


# AgentEvent
# ----------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class AgentEvent:
    """One event from the runtime's response stream.

    ``kind`` discriminates the payload class; consumers use ``match evt.kind:``
    to narrow ``evt.payload`` to the corresponding dataclass.
    """

    kind: EventKind
    payload: EventPayload
    turn_id: str | None = None
