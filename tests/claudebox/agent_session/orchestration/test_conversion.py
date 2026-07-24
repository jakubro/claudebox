"""Tests for claudebox.agent_session.orchestration.conversion - message-to-event pipeline."""

from datetime import datetime

import pytest
from inline_snapshot import snapshot

from claudebox.agent_session.orchestration.conversion import (
    _is_synthetic_user_message,
    dict_message_to_events,
    serialize_event,
    to_published_event,
)
from claudebox.agent_session.orchestration.models import Event, PublishedEvent


# --- Helpers ---


def _events(data: dict) -> list[Event]:
    """Collect all events from dict_message_to_events into a list."""

    return list(dict_message_to_events(data))


def _first(data: dict) -> Event:
    """Return the first event from dict_message_to_events."""

    events = _events(data)
    assert len(events) >= 1, f"Expected at least 1 event, got {len(events)}"

    return events[0]


# --- dict_message_to_events ---


class TestDictMessageToEventsSystem:
    """Test system message conversion."""

    def test_system_message(self):
        event = _first({"type": "system", "message": {"subtype": "init"}})
        assert event.type == "system"
        assert event.subtype == "init"
        assert event.primary is False
        assert event.is_human is False
        assert event.content is None


class TestDictMessageToEventsResult:
    """Test result message conversion."""

    def test_result_message(self):
        event = _first(
            {
                "type": "result",
                "message": {"subtype": "success", "result": "done"},
            }
        )
        assert event.type == "result"
        assert event.subtype == "success"
        assert event.content == "done"
        assert event.primary is False

    def test_result_none_result(self):
        event = _first({"type": "result", "message": {"result": None}})
        assert event.content == ""


class TestDictMessageToEventsUser:
    """Test user message conversion."""

    def test_human_text_message(self):
        event = _first({"type": "user", "message": {"content": "Hello Claude"}})
        assert event.type == "user"
        assert event.subtype == "message"
        assert event.is_human is True
        assert event.primary is True
        assert event.content == "Hello Claude"

    def test_synthetic_system_reminder(self):
        content = "<system-reminder>You are in plan mode</system-reminder>"
        event = _first({"type": "user", "message": {"content": content}})
        assert event.is_human is False
        assert event.subtype == "text"

    def test_synthetic_continuation(self):
        content = "This session is being continued from a previous conversation"
        event = _first({"type": "user", "message": {"content": content}})
        assert event.is_human is False

    def test_non_notification_synthetic(self):
        content = "<local-command-stdout>some output</local-command-stdout>"
        event = _first({"type": "user", "message": {"content": content}})
        assert event.type == "user"
        assert event.subtype == "text"
        assert event.is_human is False

    def test_task_notification_reclassified_non_human(self):
        # The SDK injects async-task completion as a user-message echo; it must stay a
        # non-human user event (the typed system/task_notification carries the signal),
        # never a human message and never re-parsed into a second system event.
        content = (
            "<task-notification>\n<task-id>agent_abc</task-id>\n"
            "<status>completed</status>\n</task-notification>"
        )
        event = _first({"type": "user", "message": {"content": content}})
        assert event.type == "user"
        assert event.subtype == "text"
        assert event.is_human is False

    def test_none_content(self):
        event = _first({"type": "user", "message": {"content": None}})
        assert event.content == ""
        assert event.subtype == "message"
        assert event.is_human is True


class TestDictMessageToEventsAssistant:
    """Test assistant message block conversion."""

    def test_text_block(self):
        data = {
            "type": "assistant",
            "message": {"content": [{"type": "text", "text": "Hello!"}]},
        }
        event = _first(data)
        assert event.subtype == "text"
        assert event.content == "Hello!"
        assert event.primary is True

    def test_thinking_block(self):
        data = {
            "type": "assistant",
            "message": {"content": [{"type": "thinking", "thinking": "Let me think..."}]},
        }
        event = _first(data)
        assert event.subtype == "thinking"
        assert event.content == "Let me think..."
        assert event.primary is False

    def test_tool_use_block(self):
        data = {
            "type": "assistant",
            "message": {
                "content": [{"type": "tool_use", "id": "tu_1", "name": "Bash", "input": {}}]
            },
        }
        event = _first(data)
        assert event.subtype == "tool_use"
        assert event.content == "Bash"

    def test_tool_result_block_string(self):
        data = {
            "type": "assistant",
            "message": {"content": [{"type": "tool_result", "content": "output text"}]},
        }
        event = _first(data)
        assert event.subtype == "tool_result"
        assert event.content == "output text"

    def test_tool_result_block_list(self):
        data = {
            "type": "assistant",
            "message": {
                "content": [{"type": "tool_result", "content": [{"type": "text", "text": "ok"}]}]
            },
        }
        event = _first(data)
        assert event.subtype == "tool_result"
        assert event.content is not None
        assert '"text"' in event.content  # JSON-serialized list

    def test_unknown_block_type(self):
        data = {
            "type": "assistant",
            "message": {"content": [{"type": "custom_thing"}]},
        }
        event = _first(data)
        assert event.subtype == "custom_thing"
        assert event.primary is False

    def test_multiple_blocks(self):
        data = {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "thinking", "thinking": "hmm"},
                    {"type": "text", "text": "result"},
                ]
            },
        }
        events = _events(data)
        assert len(events) == 2
        assert events[0].subtype == "thinking"
        assert events[1].subtype == "text"


class TestDictMessageToEventsUnknown:
    """Test fallback for unknown message structures."""

    def test_unknown_structure(self):
        event = _first({"type": "assistant", "message": {"content": 12345}})
        assert event.subtype == "unknown"
        assert event.primary is False


# --- to_published_event ---


class TestToPublishedEvent:
    """Test field promotion from Event to PublishedEvent."""

    def _make_event(self, **overrides) -> Event:
        defaults = {
            "type": "assistant",
            "subtype": "text",
            "content": "hello",
            "primary": True,
            "is_human": False,
            "raw": {"message": {}, "block": {}},
        }
        defaults.update(overrides)

        return Event(**defaults)

    def test_tool_use_promotion(self):
        event = self._make_event(
            subtype="tool_use",
            raw={
                "message": {},
                "block": {"id": "tu_1", "name": "Bash", "input": {"command": "ls"}},
            },
        )
        pub = to_published_event(event, id_="e1", ts=datetime.now(), turn_id="t1")
        assert pub.tool_use_id == "tu_1"
        assert pub.tool_name == "Bash"
        assert pub.tool_input == {"command": "ls"}

    def test_tool_result_promotion(self):
        event = self._make_event(
            subtype="tool_result",
            raw={"message": {}, "block": {"tool_use_id": "tu_1", "is_error": True}},
        )
        pub = to_published_event(event, id_="e1", ts=datetime.now(), turn_id="t1")
        assert pub.tool_use_id == "tu_1"
        assert pub.is_error is True

    def test_tool_use_result_promotion(self):
        event = self._make_event(
            subtype="tool_result",
            raw={
                "message": {"tool_use_result": {"isAsync": True}},
                "block": {"tool_use_id": "tu_1"},
            },
        )
        pub = to_published_event(event, id_="e1", ts=datetime.now(), turn_id="t1")
        assert pub.tool_use_result == {"isAsync": True}

    def test_result_cost_promotion(self):
        event = self._make_event(
            type="result",
            raw={"message": {"total_cost_usd": 0.05, "duration_ms": 1200}},
        )
        pub = to_published_event(event, id_="e1", ts=datetime.now(), turn_id="t1")
        assert pub.cost_usd == 0.05
        assert pub.duration_ms == 1200

    def test_result_no_context_tokens_promotion(self):
        """Result events do not promote context tokens; the SDK is the sole source."""

        event = self._make_event(
            type="result",
            raw={
                "message": {
                    "num_turns": 2,
                    "usage": {"input_tokens": 1000, "cache_read_input_tokens": 500},
                },
            },
        )
        pub = to_published_event(event, id_="e1", ts=datetime.now(), turn_id="t1")
        assert pub.context_tokens is None

    def test_system_model_promotion(self):
        event = self._make_event(
            type="system",
            raw={"message": {"data": {"model": "sonnet"}}},
        )
        pub = to_published_event(event, id_="e1", ts=datetime.now(), turn_id="t1")
        assert pub.model == "sonnet"
        assert pub.message_data == {"model": "sonnet"}

    def test_parent_tool_use_id_from_message(self):
        event = self._make_event(
            raw={"message": {"parent_tool_use_id": "ptu_1"}, "block": {}},
        )
        pub = to_published_event(event, id_="e1", ts=datetime.now(), turn_id="t1")
        assert pub.parent_tool_use_id == "ptu_1"

    def test_parent_tool_use_id_kwargs_precedence(self):
        event = self._make_event(
            raw={"message": {"parent_tool_use_id": "from_msg"}, "block": {}},
        )
        pub = to_published_event(
            event, id_="e1", ts=datetime.now(), turn_id="t1", parent_tool_use_id="from_kwargs"
        )
        assert pub.parent_tool_use_id == "from_kwargs"


# --- serialize_event ---


class TestSerializeEvent:
    """Test event serialization for SSE broadcast."""

    def test_strips_raw(self):
        pub = PublishedEvent(
            type="assistant",
            subtype="text",
            content="hello",
            primary=True,
            is_human=False,
            raw={"message": {}, "block": {}},
            id="e1",
            ts=datetime(2026, 3, 6, 12, 0, 0),
            turn_id="t1",
        )
        result = serialize_event(pub)
        assert "raw" not in result
        assert result == snapshot(
            {
                "type": "assistant",
                "subtype": "text",
                "content": "hello",
                "primary": True,
                "is_human": False,
                "id": "e1",
                "ts": datetime(2026, 3, 6, 12, 0, 0),
                "turn_id": "t1",
                "tool_use_id": None,
                "tool_name": None,
                "tool_input": None,
                "is_error": None,
                "tool_use_result": None,
                "model": None,
                "previous_model": None,
                "cost_usd": None,
                "duration_ms": None,
                "context_tokens": None,
                "permission_mode": None,
                "previous_permission_mode": None,
                "previous_effort_level": None,
                "message_data": None,
                "count": None,
                "parent_tool_use_id": None,
                "source_file": None,
                "source_offset": None,
                "attachments": None,
                "inline_replies": None,
                "capabilities": None,
                "runtime_name": None,
            }
        )


# --- _is_synthetic_user_message ---


class TestIsSyntheticUserMessage:
    """Test synthetic user message detection."""

    @pytest.mark.parametrize(
        "content",
        [
            "This session is being continued from a previous conversation",
            "<local-command-stdout>output</local-command-stdout>",
            "<local-command-stderr>error</local-command-stderr>",
            "<task-notification>\n<task-id>x</task-id>\n</task-notification>",
            "<system-reminder>reminder</system-reminder>",
        ],
    )
    def test_detects_synthetic(self, content):
        assert _is_synthetic_user_message(content) is True

    @pytest.mark.parametrize(
        "content",
        [
            "Hello Claude",
            "Please fix this bug",
            "system-reminder without angle brackets",
            "",
        ],
    )
    def test_rejects_human(self, content):
        assert _is_synthetic_user_message(content) is False

    def test_whitespace_preserved(self):
        assert _is_synthetic_user_message("  <system-reminder>x</system-reminder>  ") is True
