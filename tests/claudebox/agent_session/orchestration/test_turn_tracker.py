"""Tests for claudebox.agent_session.orchestration.turn_tracker - turn ID state machine."""

from claudebox.agent_session.events import (
    AgentEvent,
    AssistantMessagePayload,
    UserMessagePayload,
)
from claudebox.agent_session.orchestration.models import Event
from claudebox.agent_session.orchestration.turn_tracker import TurnTracker


# --- Helpers ---


def _make_user_message(uuid: str | None = "user-turn-1") -> AgentEvent:
    """Create an AgentEvent representing a user message with the given uuid."""

    return AgentEvent(
        kind="user_message",
        payload=UserMessagePayload(uuid=uuid, content=""),
    )


def _make_message() -> AgentEvent:
    """Create a non-user AgentEvent (assistant kind, empty content)."""

    return AgentEvent(
        kind="assistant_message",
        payload=AssistantMessagePayload(uuid=None, content=[]),
    )


def _make_event(subtype: str = "text") -> Event:
    """Create a minimal Event for resolve() testing."""

    return Event(
        type="assistant",
        subtype=subtype,
        content=None,
        primary=False,
        is_human=False,
        raw={},
    )


# --- is_compacting property ---


class TestIsCompacting:
    """Test the is_compacting property reflects compaction-in-flight state."""

    def test_false_initially(self):
        tracker = TurnTracker()
        assert tracker.is_compacting is False

    def test_true_after_compact_start_inject(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_inject(subtype="compact_start", is_human=False, turn_id=None)
        assert tracker.is_compacting is True

    def test_false_after_compact_boundary_resolve(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_inject(subtype="compact_start", is_human=False, turn_id=None)
        tracker.resolve(_make_event(subtype="compact_boundary"))
        assert tracker.is_compacting is False


# --- on_message ---


class TestOnMessage:
    """Test turn tracking from SDK messages."""

    def test_user_message_sets_current(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-abc"))
        assert tracker.current == "turn-abc"

    def test_non_user_message_ignored(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_event(_make_message())
        assert tracker.current == "turn-1"

    def test_user_message_without_uuid_ignored(self):
        msg = _make_user_message(None)
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_event(msg)
        assert tracker.current == "turn-1"

    def test_initial_current_is_none(self):
        tracker = TurnTracker()
        assert tracker.current is None


# --- on_inject ---


class TestOnInject:
    """Test turn_id resolution for injected events."""

    def test_human_inject_generates_turn_id(self):
        tracker = TurnTracker()
        turn_id = tracker.on_inject(subtype="message", is_human=True, turn_id=None)
        assert turn_id is not None
        assert tracker.current == turn_id

    def test_human_inject_with_existing_turn_id_preserves_it(self):
        tracker = TurnTracker()
        turn_id = tracker.on_inject(subtype="message", is_human=True, turn_id="explicit-id")
        assert turn_id == "explicit-id"

    def test_non_human_inject_uses_current(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        turn_id = tracker.on_inject(subtype="text", is_human=False, turn_id=None)
        assert turn_id == "turn-1"

    def test_non_human_inject_with_turn_id_preserves_it(self):
        tracker = TurnTracker()
        turn_id = tracker.on_inject(subtype="text", is_human=False, turn_id="given")
        assert turn_id == "given"

    def test_compact_start_records_compacting_turn(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_inject(subtype="compact_start", is_human=False, turn_id=None)
        # _compacting is set; compact_boundary uses current (turn-1 here, no advance)
        event = _make_event(subtype="compact_boundary")
        resolved = tracker.resolve(event)
        assert resolved == "turn-1"

    def test_compact_boundary_inject_clears_compacting(self):
        # Fallback-injected boundaries bypass resolve(); on_inject must clear _compacting.
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_inject(subtype="compact_start", is_human=False, turn_id=None)
        assert tracker.is_compacting is True

        tracker.on_inject(subtype="compact_boundary", is_human=False, turn_id=None)
        assert tracker.is_compacting is False


# --- resolve ---


class TestResolve:
    """Test turn_id resolution for SDK-originated events."""

    def test_returns_current_for_normal_event(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        event = _make_event(subtype="text")
        assert tracker.resolve(event) == "turn-1"

    def test_compact_boundary_uses_current_turn(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_inject(subtype="compact_start", is_human=False, turn_id=None)
        # Simulate new turn arriving during compaction
        tracker.on_event(_make_user_message("turn-2"))
        event = _make_event(subtype="compact_boundary")
        # Should use turn-2 (current), so compaction lands in the new turn
        assert tracker.resolve(event) == "turn-2"

    def test_compact_boundary_clears_compacting(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_inject(subtype="compact_start", is_human=False, turn_id=None)
        event = _make_event(subtype="compact_boundary")
        tracker.resolve(event)
        # Second compact_boundary should use current, not compacting
        event2 = _make_event(subtype="compact_boundary")
        assert tracker.resolve(event2) == "turn-1"

    def test_returns_none_when_no_current(self):
        tracker = TurnTracker()
        event = _make_event(subtype="text")
        assert tracker.resolve(event) is None


# --- assistant-emitted (turn-scoped duplicate guard) ---


class TestAssistantEmitted:
    """Turn-scoped assistant-emitted tracking - crash-restart duplicate guard."""

    def test_mark_then_has(self):
        tracker = TurnTracker()
        assert tracker.has_assistant_emitted("t1") is False
        tracker.mark_assistant_emitted("t1")
        assert tracker.has_assistant_emitted("t1") is True

    def test_is_per_turn(self):
        tracker = TurnTracker()
        tracker.mark_assistant_emitted("t1")
        assert tracker.has_assistant_emitted("t2") is False

    def test_mark_none_is_noop(self):
        tracker = TurnTracker()
        tracker.mark_assistant_emitted(None)
        assert tracker.has_assistant_emitted(None) is False

    def test_has_none_returns_false(self):
        tracker = TurnTracker()
        assert tracker.has_assistant_emitted(None) is False
