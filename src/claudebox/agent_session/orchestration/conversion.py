"""Message conversion - dict-shaped runtime payloads to Events to serialized dicts.

`dict_message_to_events` consumes the persisted JSONL replay shape (raw dicts); `agent_event_to_events`
projects the live typed `AgentEvent` from `ClaudeRuntime._translate_sdk_message` back to that dict
shape and delegates to it, so both paths share one block-walk implementation and stay byte-identical
with the JSONL contract.
"""

import dataclasses
from collections.abc import Iterator
from datetime import datetime
from typing import TypedDict

from .models import Event, EventSubtype, EventType, PublishedEvent
from ..events import (
    AgentEvent,
    AssistantMessagePayload,
    CompactBoundaryPayload,
    ContentBlock,
    RateLimitPayload,
    ResultPayload,
    SystemInitPayload,
    TaskNotificationPayload,
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
    "compact_boundary": EventType.SYSTEM,
    "task_notification": EventType.SYSTEM,
}


# Runtime wraps system-originated content (compaction preamble, local command output, task
# notifications, hook context) in user messages; matched by prefix to reclassify as non-human events.
_SYNTHETIC_USER_MARKERS = (
    "This session is being continued from a previous conversation",
    "<local-command-stdout>",
    "<local-command-stderr>",
    # Task-notification echoes are reclassified for display only, never re-parsed into a second
    # system event - the real completion signal is the typed system/task_notification event.
    "<task-notification>",
    "<system-reminder>",
)


def dict_message_to_events(data: dict) -> Iterator[Event]:
    """Convert a message dict (SDK or persisted JSONL replay entry) to Event objects, yielding
    multiple events for block-based content (e.g., text + tool_use blocks)."""

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
    """Yield pipeline Events from a typed AgentEvent (live runtime path), by projecting it to the
    dict shape `dict_message_to_events` consumes."""

    return dict_message_to_events(_typed_payload_to_dict_message(evt))


def _typed_payload_to_dict_message(evt: AgentEvent) -> dict:
    """Project a typed AgentEvent to the ``{"type", "message"}`` dict shape."""

    msg_type = _TYPED_KIND_TO_DICT_TYPE[evt.kind]
    payload = evt.payload

    if isinstance(payload, SystemInitPayload):
        # Reinject session_id + model - frontend reads message_data.model and the promoted event.model field.
        data_dict = dataclasses.asdict(payload.data)

        # `extra` holds unconsumed SDK init keys; omit when empty so the common-case wire shape is
        # unchanged, and surface it only when the SDK sent new keys.
        if not data_dict.get("extra"):
            data_dict.pop("extra", None)

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

    if isinstance(payload, CompactBoundaryPayload):
        compact_metadata: dict = {"trigger": payload.trigger}

        if payload.pre_tokens is not None:
            compact_metadata["pre_tokens"] = payload.pre_tokens

        if payload.post_tokens is not None:
            compact_metadata["post_tokens"] = payload.post_tokens

        if payload.duration_ms is not None:
            compact_metadata["duration_ms"] = payload.duration_ms

        return {
            "type": msg_type,
            "message": {
                "subtype": EventSubtype.COMPACT_BOUNDARY,
                "data": {"compact_metadata": compact_metadata},
            },
        }

    if isinstance(payload, TaskNotificationPayload):
        data: dict = {"task_id": payload.task_id, "status": payload.status}

        if payload.summary is not None:
            data["summary"] = payload.summary

        return {
            "type": msg_type,
            "message": {
                "subtype": EventSubtype.TASK_NOTIFICATION,
                "data": data,
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


class _PromotedFields(TypedDict, total=False):
    """PublishedEvent fields `to_published_event` promotes from raw dicts.
    Typed so the `**fields` spread type-checks: raw dicts are Any, so the TypedDict pins each slot.
    """

    tool_use_id: str | None
    tool_name: str | None
    tool_input: dict | None
    is_error: bool | None
    tool_use_result: dict
    cost_usd: float
    duration_ms: int
    model: str
    message_data: dict
    parent_tool_use_id: str


def to_published_event(
    event: Event,
    *,
    id_: str,
    ts: datetime,
    turn_id: str,
    **kwargs,
) -> PublishedEvent:
    """Convert Event to PublishedEvent, promoting fields from the raw message/block dicts to
    top-level attributes (tool_use_id, tool_name, cost_usd, model, etc.) for easier querying."""

    fields: _PromotedFields = {}
    block = event.raw.get("block") if event.raw else None
    message = event.raw.get("message") if event.raw else None

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

        # Promote parent_tool_use_id for foreground (sync) tasks; async tasks already receive it via
        # kwargs from the task manager.
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
