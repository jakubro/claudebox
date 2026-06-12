"""Message conversion - dict-shaped runtime payloads to Events to serialized dicts.

Two entry points produce the same ``Iterator[Event]`` output:

- ``dict_message_to_events`` consumes the persisted JSONL replay shape (raw dicts).
- ``agent_event_to_events`` consumes the live typed ``AgentEvent`` from
  ``ClaudeRuntime._translate_sdk_message``; it projects the typed payload back
  to the dict shape and delegates to ``dict_message_to_events``, so both paths
  converge on a single block-walk implementation and the JSONL contract stays
  byte-identical across the typed-payload migration.
"""

import dataclasses
import re
from collections.abc import Iterator
from datetime import datetime

from .models import Event, EventSubtype, EventType, PublishedEvent
from ..events import (
    AgentEvent,
    AssistantMessagePayload,
    ContentBlock,
    RateLimitPayload,
    ResultPayload,
    SystemInitPayload,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UnknownBlock,
    UserMessagePayload,
)
from ...core import serialization


_TYPED_KIND_TO_DICT_TYPE = {
    "system_init": EventType.SYSTEM,
    "user_message": EventType.USER,
    "assistant_message": EventType.ASSISTANT,
    "result": EventType.RESULT,
    "rate_limit": EventType.SYSTEM,
}


# Synthetic user markers - runtime wraps these in user messages but they originate
# from the system (compaction preamble, local command output, task notifications,
# hook context). Matched by prefix against stripped content to reclassify as
# non-human events.
_SYNTHETIC_USER_MARKERS = (
    "This session is being continued from a previous conversation",
    "<local-command-stdout>",
    "<local-command-stderr>",
    "<task-notification>",
    "<system-reminder>",
)


# Pattern for nested-element notification XML.
_NOTIFICATION_PATTERN = re.compile(
    r"<task-notification>(.*?)</task-notification>",
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


def agent_event_to_events(evt: AgentEvent) -> Iterator[Event]:
    """Yield pipeline Events from a typed AgentEvent (live runtime path).

    Projects the typed payload back to the dict shape ``dict_message_to_events``
    consumes - keeping a single block-walk implementation and the JSONL replay
    contract byte-identical across the typed-payload migration.
    """

    return dict_message_to_events(_typed_payload_to_dict_message(evt))


def _typed_payload_to_dict_message(evt: AgentEvent) -> dict:
    """Project a typed AgentEvent to the ``{"type", "message"}`` dict shape."""

    msg_type = _TYPED_KIND_TO_DICT_TYPE[evt.kind]
    payload = evt.payload

    if isinstance(payload, SystemInitPayload):
        # Reinject session_id + model into the data dict - frontend reads
        # `message_data.model` and the promoted `event.model` field via
        # to_published_event. D3α-permitted wire-shape redundancy.
        data_dict = dataclasses.asdict(payload.data)

        if payload.model is not None:
            data_dict["model"] = payload.model

        data_dict["session_id"] = payload.session_id

        return {
            "type": msg_type,
            "message": {
                "subtype": payload.subtype,
                "data": data_dict,
            },
        }

    if isinstance(payload, ResultPayload):
        message: dict = {
            "subtype": payload.subtype,
            "result": payload.result,
            "total_cost_usd": payload.total_cost_usd,
            "duration_ms": payload.duration_ms,
            "num_turns": payload.num_turns,
            "session_id": payload.session_id,
            "is_error": payload.is_error,
        }

        if payload.usage is not None:
            message["usage"] = dataclasses.asdict(payload.usage)

        return {"type": msg_type, "message": message}

    if isinstance(payload, UserMessagePayload):
        content = payload.content

        if isinstance(content, list):
            content = [_block_to_dict(b) for b in content]

        return {
            "type": msg_type,
            "message": {
                "uuid": payload.uuid,
                "content": content,
                "tool_use_result": payload.tool_use_result,
                "parent_tool_use_id": payload.parent_tool_use_id,
            },
        }

    if isinstance(payload, AssistantMessagePayload):
        return {
            "type": msg_type,
            "message": {
                "uuid": payload.uuid,
                "content": [_block_to_dict(b) for b in payload.content],
                "model": payload.model,
                "parent_tool_use_id": payload.parent_tool_use_id,
            },
        }

    if isinstance(payload, RateLimitPayload):
        return {
            "type": msg_type,
            "message": {
                "subtype": EventSubtype.RATE_LIMIT,
                "data": {
                    "status": payload.status,
                    "resets_at": payload.resets_at,
                    "rate_limit_type": payload.rate_limit_type,
                    "utilization": payload.utilization,
                },
            },
        }

    raise TypeError(f"Unknown EventPayload type: {type(payload).__name__}")


def _block_to_dict(block: ContentBlock) -> dict:
    """Project a ContentBlock dataclass into the dict shape with a ``type`` discriminator."""

    if isinstance(block, TextBlock):
        return {"type": "text", "text": block.text}

    if isinstance(block, ThinkingBlock):
        return {"type": "thinking", "thinking": block.thinking}

    if isinstance(block, ToolUseBlock):
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": dict(block.input)}

    if isinstance(block, ToolResultBlock):
        return {
            "type": "tool_result",
            "tool_use_id": block.tool_use_id,
            "content": block.content,
            "is_error": block.is_error,
        }

    if isinstance(block, UnknownBlock):
        return {"type": "unknown", "class_name": block.class_name, "data": dict(block.data)}

    raise TypeError(f"Unknown ContentBlock type: {type(block).__name__}")


def _is_synthetic_user_message(content: str) -> bool:
    """Check if user message is system-generated rather than human-authored."""

    stripped = content.strip()

    return any(stripped.startswith(marker) for marker in _SYNTHETIC_USER_MARKERS)


def _parse_notification_xml(content: str) -> dict[str, str] | None:
    """Parse nested-element `<task-notification>` XML into a structured dict."""

    stripped = content.strip()
    match = _NOTIFICATION_PATTERN.match(stripped)

    if not match:
        return None

    inner = match.group(1)

    fields = {}

    for child in _CHILD_ELEMENT_PATTERN.finditer(inner):
        key = child.group(1).replace("-", "_")
        fields[key] = child.group(2).strip()

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
    elif block_type == "thinking":
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
    elif block_type == "tool_use":
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
    elif block_type == "tool_result":
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

    # Unknown block type - preserve in event stream
    else:
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
