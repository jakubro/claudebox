"""Message conversion — dict-shaped runtime payloads to Events to serialized dicts.

`dict_message_to_events` handles both live AgentEvent.payload dicts (projected
by `ClaudeRuntime._translate_sdk_message`) and persisted JSONL replay dicts
uniformly.
"""

import dataclasses
import re
from collections.abc import Iterator
from datetime import datetime

from .models import Event, EventSubtype, EventType, PublishedEvent
from ...core import serialization


# Synthetic user markers — runtime wraps these in user messages but they originate
# from the system (compaction preamble, local command output, task notifications,
# hook context). Matched by prefix against stripped content to reclassify as
# non-human events.
_SYNTHETIC_USER_MARKERS = (
    "This session is being continued from a previous conversation",
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<task-notification>",
    "<agent-notification>",
    "<system-reminder>",
)


# Patterns for nested-element notification XML.
_NOTIFICATION_PATTERN = re.compile(
    r"<(task-notification|agent-notification)>(.*?)</\1>",
    re.DOTALL,
)

# Child element extraction: <tag-name>value</tag-name>
_CHILD_ELEMENT_PATTERN = re.compile(r"<([a-z-]+)>([^<]*)</\1>")


def dict_message_to_events(data: dict) -> Iterator[Event]:
    """Convert message dict to Event objects.

    Handles both SDK messages (converted via dataclasses.asdict()) and raw
    JSONL messages from persisted session files. Supports system, result,
    user, and assistant message types with various content structures.
    A single message may yield multiple events when it contains block-based
    content (e.g., text + tool_use blocks).
    """

    msg_type = data.get("type", "unknown")
    message = data.get("message", {})

    if msg_type == EventType.SYSTEM:
        yield Event(
            type=msg_type,
            subtype=message.get("subtype", ""),
            content=None,
            primary=False,
            is_human=False,
            raw={"message": message},
        )
        return

    if msg_type == EventType.RESULT:
        yield Event(
            type=msg_type,
            subtype=message.get("subtype", ""),
            content=str(message.get("result") or ""),
            primary=False,
            is_human=False,
            raw={"message": message},
        )
        return

    content = message.get("content")

    if content is None:
        content = ""

    if isinstance(content, str):
        if msg_type == EventType.USER and _is_synthetic_user_message(content):
            # Normalize nested-element notification XML into system/task_notification events
            notification = _parse_notification_xml(content)
            if notification:
                yield Event(
                    type=EventType.SYSTEM,
                    subtype=EventSubtype.TASK_NOTIFICATION,
                    content=None,
                    primary=False,
                    is_human=False,
                    raw={"message": {"subtype": "task_notification", "data": notification}},
                )
                return

            yield Event(
                type=msg_type,
                subtype=EventSubtype.TEXT,
                content=content,
                primary=True,
                is_human=False,
                raw={"message": message},
            )
        else:
            is_human = msg_type == EventType.USER
            yield Event(
                type=msg_type,
                subtype=EventSubtype.MESSAGE if is_human else EventSubtype.TEXT,
                content=content,
                primary=True,
                is_human=is_human,
                raw={"message": message},
            )
        return

    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            event = _block_to_event(block, msg_type=msg_type, message=message)
            if event:
                yield event
        return

    # Unknown structure
    yield Event(
        type=msg_type,
        subtype=EventSubtype.UNKNOWN,
        content=None,
        primary=False,
        is_human=False,
        raw={"message": message},
    )


def _is_synthetic_user_message(content: str) -> bool:
    """Check if user message is system-generated rather than human-authored."""

    stripped = content.strip()
    return any(stripped.startswith(marker) for marker in _SYNTHETIC_USER_MARKERS)


def _parse_notification_xml(content: str) -> dict[str, str] | None:
    """Parse nested-element notification XML into a structured dict.

    Handles both `<task-notification>` and `<agent-notification>` formats.
    For agent-notification, the agent-id is mapped to task_id for downstream
    compatibility with AsyncTaskManager and frontend appendTaskNotifications.
    """

    stripped = content.strip()
    match = _NOTIFICATION_PATTERN.match(stripped)
    if not match:
        return None

    tag_name = match.group(1)
    inner = match.group(2)

    fields = {}
    for child in _CHILD_ELEMENT_PATTERN.finditer(inner):
        key = child.group(1).replace("-", "_")
        fields[key] = child.group(2).strip()

    # Normalize agent-id to task_id for downstream compatibility
    if tag_name == "agent-notification" and "agent_id" in fields:
        fields["task_id"] = fields.pop("agent_id")

    return fields


def _block_to_event(block: dict, *, msg_type: str, message: dict) -> Event | None:
    """Convert content block dict to Event."""

    block_type = block.get("type", "")
    raw = {"message": message, "block": block}

    if block_type == "text":
        return Event(
            type=msg_type,
            subtype=EventSubtype.TEXT,
            content=str(block.get("text") or ""),
            primary=True,
            is_human=False,
            raw=raw,
        )

    if block_type == "thinking":
        thinking_content = str(block.get("thinking") or "")
        if not thinking_content.strip():
            return None
        return Event(
            type=msg_type,
            subtype=EventSubtype.THINKING,
            content=thinking_content,
            primary=False,
            is_human=False,
            raw=raw,
        )

    if block_type == "tool_use":
        name = str(block.get("name") or "")
        if name == "Agent":
            name = "Task"
        return Event(
            type=msg_type,
            subtype=EventSubtype.TOOL_USE,
            content=name,
            primary=False,
            is_human=False,
            raw=raw,
        )

    if block_type == "tool_result":
        content = block.get("content")
        if isinstance(content, list):
            content = serialization.dumps(content)

        return Event(
            type=msg_type,
            subtype=EventSubtype.TOOL_RESULT,
            content=str(content or ""),
            primary=False,
            is_human=False,
            raw=raw,
        )

    # Unknown block type — preserve in event stream
    return Event(
        type=msg_type,
        subtype=block_type or EventSubtype.UNKNOWN,
        content="",
        primary=False,
        is_human=False,
        raw=raw,
    )


def to_published_event(
    event: Event,
    *,
    id_: str,
    ts: datetime,
    turn_id: str,
    **kwargs,
) -> PublishedEvent:
    """Convert Event to PublishedEvent with promoted fields.

    Enriches the base Event with an ID, timestamp, and turn association.
    Promotes useful fields from the raw message/block dicts to top-level
    attributes (tool_use_id, tool_name, cost_usd, model, etc.) for easier
    access and querying.
    """

    fields = {}
    block = event.raw.get("block") if event.raw else None
    message = event.raw.get("message") if event.raw else None

    # Promote block fields
    if isinstance(block, dict):
        if event.subtype == "tool_use":
            fields["tool_use_id"] = block.get("id")
            fields["tool_name"] = block.get("name")
            inp = block.get("input")
            fields["tool_input"] = inp if isinstance(inp, dict) else None

        elif event.subtype == "tool_result":
            fields["tool_use_id"] = block.get("tool_use_id")
            fields["is_error"] = block.get("is_error")

    # Promote tool_use_result for any tool_result (lives on UserMessage, not ResultMessage)
    if isinstance(message, dict) and event.subtype == "tool_result":
        res = message.get("tool_use_result")
        if isinstance(res, dict):
            fields["tool_use_result"] = res

    # Promote message fields
    if isinstance(message, dict):
        if event.type == "result":
            cost = message.get("total_cost_usd")
            if cost:
                fields["cost_usd"] = cost

            duration = message.get("duration_ms")
            if duration:
                fields["duration_ms"] = duration

        elif event.type == "system":
            data = message.get("data") or {}
            if isinstance(data, dict):
                if data.get("model"):
                    fields["model"] = data["model"]
                fields["message_data"] = data

        # Promote parent_tool_use_id for foreground (sync) tasks.
        # Async tasks already receive it via kwargs from the task manager.
        if "parent_tool_use_id" not in kwargs:
            ptui = message.get("parent_tool_use_id")
            if ptui:
                fields["parent_tool_use_id"] = ptui

    return PublishedEvent(
        type=event.type,
        subtype=event.subtype,
        content=event.content,
        primary=event.primary,
        is_human=event.is_human,
        raw=event.raw,
        id=id_,
        ts=ts,
        turn_id=turn_id,
        **fields,
        **kwargs,
    )


def serialize_event(event: PublishedEvent) -> dict:
    """Serialize a PublishedEvent to dict for SSE broadcast."""

    d = dataclasses.asdict(event)
    d.pop("raw", None)
    return d
