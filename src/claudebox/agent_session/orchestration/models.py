"""Session models - event and summary data structures."""

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
    """Content/system subtype - mirrors frontend `EventSubtype` in schema.js.

    Adds three Python-only system values not enumerated on the frontend:
    `message`, `unknown`, `error`. Frontend tolerates unknown subtypes via fallback.
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

    `type` and `subtype` stay `str` because the wire carries permissive
    vocabularies (e.g. SDK `result.subtype` is open-set: "success",
    "error_max_turns", etc.). The `EventType` / `EventSubtype` StrEnums above
    provide constants for the well-known values - use them at construction
    sites for readability and to catch typos.
    """

    type: str
    subtype: str
    content: str | None
    primary: bool
    is_human: bool
    raw: dict


@dataclass
class PublishedEvent(Event):
    """Event enriched with identity, timing, and promoted fields for persistence and broadcast.

    PublishedEvents extend base Events with unique identifiers, timestamps, and
    fields promoted from the raw message data for efficient querying. These are
    persisted to events.jsonl and broadcast to SSE subscribers.

    Attributes:
        id: Unique event identifier.
        ts: Event timestamp.
        turn_id: Conversation turn identifier, None for system events.
        tool_use_id: Tool invocation ID for tool_use and tool_result events.
        tool_name: Name of the invoked tool.
        tool_input: Tool input parameters.
        is_error: Whether tool execution resulted in error.
        tool_use_result: Result metadata from tool execution.
        model: Model identifier from result events.
        previous_model: Previous model before a model_changed event.
        permission_mode: Permission mode from hook events.
        previous_permission_mode: Previous mode before a permission_mode_changed event.
        previous_effort_level: Previous level before an effort_level_changed event.
        cost_usd: Turn cost from result events.
        duration_ms: Turn duration from result events.
        context_tokens: Average context tokens per turn.
        message_data: Data payload from system messages.
        count: Count value from system messages.
        parent_tool_use_id: Parent tool ID for nested/async task events.
        source_file: Source file for async task streaming.
        source_offset: Byte offset for async task streaming.
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

    # Nested event fields (for async task streaming)
    parent_tool_use_id: str | None = None
    source_file: str | None = None
    source_offset: int | None = None

    # Attachment display metadata (for user messages with files)
    attachments: list[dict] | None = None

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

    Extends the shared SessionMetadata with fields needed by the frontend:
    paths, permission mode, todos, duration, context tokens, commands,
    and session prompt.

    Attributes:
        session_dir: Path to claudebox session directory.
        workspace: Path to the workspace root.
        permission_mode: Active permission mode.
        todos: List of todo items from the session.
        total_duration_ms: Cumulative response time.
        last_context_tokens: Context tokens from most recent turn.
        context_window: Maximum context window size for the current model.
        commands: Slash commands categorized by type (custom, mcp, builtin).
        session_prompt: Per-session text injected after compaction.
    """

    session_dir: Path | None = None
    workspace: Path | None = None
    permission_mode: str | None = None
    todos: list[dict] | None = None
    total_duration_ms: int | None = None
    last_context_tokens: int = 0
    # Sentinel default - the active runtime overwrites via Projection._refresh_context_usage()
    # once a session is alive; the class-default value is never user-visible.
    context_window: int = 0
    commands: dict[str, list[dict]] | None = None
    session_prompt: str | None = None
    effort_level: str | None = None

    def __post_init__(self) -> None:
        """Convert string paths and timestamps to proper types."""

        if self.session_dir is not None:
            self.session_dir = Path(self.session_dir)

        if self.workspace is not None:
            self.workspace = Path(self.workspace)

        if isinstance(self.started_at, str):
            self.started_at = datetime.fromisoformat(self.started_at)

        if isinstance(self.updated_at, str):
            self.updated_at = datetime.fromisoformat(self.updated_at)
