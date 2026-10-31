"""Tests for claudebox.agent_session.orchestration.turn_tracker - turn ID state machine."""

from __future__ import annotations

import pytest

from claudebox.agent_session.events import (
    AgentEvent,
    AssistantMessagePayload,
    ToolResultBlock,
    UserMessagePayload,
)
from claudebox.agent_session.orchestration.models import Event
from claudebox.agent_session.orchestration.turn_tracker import TurnTracker
from ._helpers import make_published_event


# --- Helpers ---


def _make_user_message(
    uuid: str | None = "user-turn-1",
    content: str | list = "",
    *,
    parent_tool_use_id: str | None = None,
) -> AgentEvent:
    """Create an AgentEvent representing a user message with the given uuid."""

    return AgentEvent(
        kind="user_message",
        payload=UserMessagePayload(
            uuid=uuid,
            content=content,
            parent_tool_use_id=parent_tool_use_id,
        ),
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
    """Only a message the person sent opens a turn."""

    def test_the_persons_message_opens_a_turn(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-abc", "run the migration"))
        assert tracker.current == "turn-abc"

    def test_non_user_message_ignored(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_event(_make_message())
        assert tracker.current == "turn-1"

    def test_a_tool_result_does_not_open_a_turn(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1", "run the migration"))
        tracker.on_event(
            _make_user_message(
                "tool-result-1",
                [ToolResultBlock(tool_use_id="tu_1", content="ok")],
            ),
        )
        assert tracker.current == "turn-1"

    @pytest.mark.parametrize(
        "content",
        [
            [ToolResultBlock(tool_use_id="tu_2", content="found 3 files")],
            "Find every config file and summarise each one.",
        ],
        ids=["tool-result", "subagent-prompt"],
    )
    def test_a_message_nested_under_a_tool_call_does_not_open_a_turn(self, content):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1", "run the migration"))
        tracker.on_event(_make_user_message("nested-1", content, parent_tool_use_id="tu_1"))
        assert tracker.current == "turn-1"

    @pytest.mark.parametrize(
        "content",
        [
            "This session is being continued from a previous conversation that ran out of context.",
            "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>",
            "<local-command-stdout>Set model to opus</local-command-stdout>",
            "<system-reminder>\nThe date has changed.\n</system-reminder>",
        ],
        ids=["compaction", "task-notification", "local-command", "system-reminder"],
    )
    def test_a_message_the_runtime_wraps_around_its_own_text_does_not_open_a_turn(self, content):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1", "run the migration"))
        tracker.on_event(_make_user_message("wrapper-1", content))
        assert tracker.current == "turn-1"

    def test_user_message_without_uuid_ignored(self):
        msg = _make_user_message(None, "run the migration")
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        tracker.on_event(msg)
        assert tracker.current == "turn-1"

    def test_initial_current_is_none(self):
        tracker = TurnTracker()
        assert tracker.current is None


def _human(turn_id: str, **overrides):
    return make_published_event(
        type="user",
        subtype="message",
        is_human=True,
        turn_id=turn_id,
        **overrides,
    )


def _result(turn_id: str | None = None):
    return make_published_event(type="result", subtype="success", content="", turn_id=turn_id)


def _event(type_: str, subtype: str, **overrides):
    return make_published_event(type=type_, subtype=subtype, **overrides)


def _open(tracker: TurnTracker, turn_id: str) -> None:
    tracker.on_event(_make_user_message(turn_id, "run the migration"))
    tracker.observe(_human(turn_id))


class TestResume:
    """A resumed tracker continues the turn the person last opened, answered or not."""

    def test_continues_the_turn_the_person_last_opened(self):
        tracker = TurnTracker()
        tracker.resume(
            [
                _human("T1"),
                make_published_event(type="result", subtype="success", turn_id="T1"),
                _human("T2"),
                make_published_event(type="user", subtype="tool_result", turn_id="R1"),
                _human("N1", parent_tool_use_id="tu_1"),
            ],
        )
        assert tracker.current == "T2"

    def test_a_turn_opened_before_the_history_is_read_stays_current(self):
        tracker = TurnTracker()
        tracker.on_inject(subtype="message", is_human=True, turn_id="T-new")
        tracker.resume([_human("T1")])
        assert tracker.current == "T-new"

    def test_an_empty_history_opens_nothing(self):
        tracker = TurnTracker()
        tracker.resume([])
        assert tracker.current is None

    @pytest.mark.parametrize(
        ("reply", "answered"),
        [
            (make_published_event(type="assistant", subtype="text", content="Done."), True),
            (make_published_event(type="system", subtype="error", content="Not logged in."), True),
            (make_published_event(type="assistant", subtype="tool_use", content="Bash"), True),
            (make_published_event(type="user", subtype="tool_result", content="ok"), False),
        ],
        ids=["text", "failure", "tool-call", "tool-result-only"],
    )
    def test_remembers_whether_the_resumed_turn_already_answered(self, reply, answered):
        tracker = TurnTracker()
        tracker.resume(
            [
                _human("T1"),
                make_published_event(
                    type="assistant",
                    subtype="text",
                    content="Earlier.",
                    turn_id="T1",
                ),
                _human("T2"),
                reply,
            ],
        )
        assert tracker.has_assistant_emitted("T2") is answered

    @pytest.mark.parametrize(
        ("tail", "running"),
        [
            ([make_published_event(type="assistant", subtype="text", content="Working.")], True),
            ([_result("T2")], False),
            ([_result("T2"), _event("system", "init"), _event("system", "error")], False),
            (
                [
                    _result("T2"),
                    _event("system", "task_notification"),
                    _event("assistant", "text"),
                ],
                True,
            ),
            ([_result("T2"), _event("system", "task_notification"), _result("T2")], False),
        ],
        ids=["mid-turn", "finished", "finished-then-a-failure", "mid-follow-up", "follow-up-done"],
    )
    def test_the_resumed_turn_runs_unless_its_last_result_ends_the_history(self, tail, running):
        tracker = TurnTracker()
        tracker.resume([_human("T1"), _result("T1"), _human("T2"), *tail])
        assert tracker.running is running


# --- running ---


class TestRunning:
    """A turn runs from the person's message to its result, and again in a follow-up."""

    def test_nothing_runs_before_the_first_message(self):
        assert TurnTracker().running is False

    def test_the_persons_message_runs_its_turn_until_its_result(self):
        tracker = TurnTracker()
        _open(tracker, "T1")
        assert tracker.running is True

        tracker.observe(_event("assistant", "text", content="Done."))
        tracker.observe(_result("T1"))
        assert tracker.running is False

    @pytest.mark.parametrize(
        "follow_up",
        [
            _event("system", "task_notification"),
            _event("assistant", "text", content="The agent found three files."),
        ],
        ids=["notification", "agent-text"],
    )
    def test_follow_up_output_after_the_result_runs_the_turn_again(self, follow_up):
        tracker = TurnTracker()
        _open(tracker, "T1")
        tracker.observe(_result("T1"))

        tracker.observe(follow_up)

        assert tracker.running is True

    @pytest.mark.parametrize(
        "between",
        [
            _event("system", "init"),
            _event("system", "rate_limit"),
            _event("assistant", "text", parent_tool_use_id="tu_bg"),
            _event("user", "tool_result", parent_tool_use_id="tu_bg"),
            _event("user", "text", content="<local-command-stdout>ok</local-command-stdout>"),
        ],
        ids=[
            "init",
            "rate-limit",
            "background-agent-text",
            "background-agent-tool-result",
            "command-output",
        ],
    )
    def test_system_events_and_output_nobody_asked_for_leave_it_finished(self, between):
        tracker = TurnTracker()
        _open(tracker, "T1")
        tracker.observe(_result("T1"))

        tracker.observe(between)

        assert tracker.running is False

    def test_an_injected_message_from_the_person_runs_its_turn(self):
        tracker = TurnTracker()
        _open(tracker, "T1")
        tracker.observe(_result("T1"))

        tracker.on_inject(subtype="message", is_human=True, turn_id="T2")

        assert (tracker.current, tracker.running) == ("T2", True)


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
        assert tracker.current == "explicit-id"

    def test_non_human_inject_uses_current(self):
        tracker = TurnTracker()
        tracker.on_event(_make_user_message("turn-1"))
        turn_id = tracker.on_inject(subtype="text", is_human=False, turn_id=None)
        assert turn_id == "turn-1"

    def test_non_human_inject_with_turn_id_preserves_it(self):
        tracker = TurnTracker()
        turn_id = tracker.on_inject(subtype="text", is_human=False, turn_id="given")
        assert turn_id == "given"

    def test_a_failure_while_the_turn_runs_takes_it(self):
        tracker = TurnTracker()
        _open(tracker, "T1")
        assert tracker.on_inject(subtype="error", is_human=False, turn_id=None) == "T1"

    def test_a_failure_after_the_turn_finished_takes_no_turn(self):
        tracker = TurnTracker()
        _open(tracker, "T1")
        tracker.observe(_result("T1"))
        assert tracker.on_inject(subtype="error", is_human=False, turn_id=None) is None

    @pytest.mark.parametrize("subtype", ["interrupt_sent", "model_changed", "container_restarted"])
    def test_other_injected_events_after_the_turn_finished_still_take_it(self, subtype):
        tracker = TurnTracker()
        _open(tracker, "T1")
        tracker.observe(_result("T1"))
        assert tracker.on_inject(subtype=subtype, is_human=False, turn_id=None) == "T1"

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
