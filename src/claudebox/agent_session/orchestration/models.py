"""Session models - event and summary data structures."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path

from ...core.structures import DataClass
from ...session.models import SessionMetadata


class EventType(StrEnum):
    """Top-level event category - mirrors frontend `EventType` in schema.js."""

    ASSISTANT = "assistant"
    USER = "user"
    SYSTEM = "system"
    RESULT = "result"


class EventSubtype(StrEnum):
    """Content/system subtype - mirrors frontend `EventSubtype` in schema.js. Adds three Python-only
    values (`message`, `unknown`, `error`) not on the frontend; it tolerates unknown subtypes via fallback.
    """

    TEXT = "text"
    MESSAGE = "message"
    THINKING = "thinking"
    TOOL_USE = "tool_use"
    TOOL_RESULT = "tool_result"
    REPLAY_STARTED = "replay_started"
    REPLAY_ENDED = "replay_ended"
    INTERRUPT_SENT = "interrupt_sent"
    MODEL_CHANGED = "model_changed"
    PERMISSION_MODE_CHANGED = "permission_mode_changed"
    EFFORT_LEVEL_CHANGED = "effort_level_changed"
    CONTAINER_RESTARTED = "container_restarted"
    TASK_NOTIFICATION = "task_notification"
    SIBLING_MESSAGE = "sibling_message"
    RATE_LIMIT = "rate_limit"
    HOOK_RESPONSE = "hook_response"
    INIT = "init"
    COMPACT_START = "compact_start"
    COMPACT_BOUNDARY = "compact_boundary"
    UNKNOWN = "unknown"
    ERROR = "error"


@dataclass
class Event(DataClass):
    """One logical unit of conversation content (text, tool use, system signal, etc.).

    `type`/`subtype` stay `str` since the wire is permissive (e.g. SDK `result.subtype` is
    open-set); use `EventType`/`EventSubtype` above at construction sites to catch typos.
    """

    type: str
    subtype: str
    content: str | None
    primary: bool
    is_human: bool
    raw: dict


@dataclass
class PublishedEvent(Event):
    """Event enriched with identity, timing, and promoted fields; persisted to events.jsonl and
    broadcast to SSE subscribers.

    `turn_id` is None for system events. `previous_model`, `previous_permission_mode`, and
    `previous_effort_level` hold the prior value, set only on the matching `*_changed` event.
    `context_tokens` is an average per turn; `source_offset` is a byte offset for async task events.
    `turn_running`, set only on `interrupt_sent`, says whether a turn ran when Stop was sent.
    `command_layout`, set only on a Bash `tool_use` that lays out differently, is display-only.
    `command_read_only` is true on a Bash `tool_use` whose command changes nothing, never false.
    `command_changed` on a Bash `tool_result` is whether the call changed anything; null unmeasured.
    `mcp_read_only` is true on an MCP `tool_use` its server declares read-only, never false.
    """

    id: str
    ts: datetime
    turn_id: str | None

    # Tool fields
    tool_use_id: str | None = None
    tool_name: str | None = None
    tool_input: dict | None = None
    is_error: bool | None = None
    tool_use_result: dict | None = None
    command_layout: str | None = None
    command_read_only: bool | None = None
    command_changed: bool | None = None
    mcp_read_only: bool | None = None

    # Result/session fields
    model: str | None = None
    previous_model: str | None = None
    cost_usd: float | None = None
    duration_ms: int | None = None
    context_tokens: int | None = None
    permission_mode: str | None = None
    previous_permission_mode: str | None = None
    previous_effort_level: str | None = None

    # System message fields
    message_data: dict | None = None
    count: int | None = None
    turn_running: bool | None = None

    # Nested event fields (for async task streaming)
    parent_tool_use_id: str | None = None
    source_file: str | None = None
    source_offset: int | None = None

    # Attachment display metadata (for user messages with files)
    attachments: list[dict] | None = None

    # Inline-reply display data (quote/from/response pairs) for user messages
    inline_replies: list[dict] | None = None

    # Message typed alongside an AskUserQuestion/ExitPlanMode answer
    note: str | None = None

    # Capability surface - populated only on system/init events for race-free initial render
    capabilities: dict | None = None
    runtime_name: str | None = None

    def __post_init__(self) -> None:
        """Convert string timestamp to datetime if needed."""

        if isinstance(self.ts, str):
            self.ts = datetime.fromisoformat(self.ts)


@dataclass
class SessionSummary(SessionMetadata):
    """Session metadata extended with display-specific fields.

    `commands` groups slash commands by type (custom, mcp, builtin); `session_prompt` is
    per-session text injected after compaction. `last_result_cost_usd` is the last result's
    `cost_usd` as its runtime reported it - under Claude a running total, not the turn's cost.
    """

    workspace: Path | None = None
    permission_mode: str | None = None
    todos: list[dict] | None = None
    total_duration_ms: int | None = None
    last_context_tokens: int = 0
    # Sentinel default; Projection._refresh_context_usage() overwrites it once a session is
    # alive, so the class-default value is never user-visible.
    context_window: int = 0
    commands: dict[str, list[dict]] | None = None
    session_prompt: str | None = None
    effort_level: str | None = None
    last_result_cost_usd: float | None = None

    def __post_init__(self) -> None:
        """Convert string paths and timestamps to proper types."""

        if self.workspace is not None:
            self.workspace = Path(self.workspace)

        if isinstance(self.started_at, str):
            self.started_at = datetime.fromisoformat(self.started_at)

        if isinstance(self.updated_at, str):
            self.updated_at = datetime.fromisoformat(self.updated_at)
