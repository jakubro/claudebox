"""Tests for orchestration.sibling_turns - collecting a turn's text and its envelope round trip."""

from __future__ import annotations

import pytest

from claudebox.agent_session.orchestration.sibling_turns import (
    SiblingMessage,
    TurnTextCollector,
    sibling_envelope,
    split_sibling_messages,
)
from ._helpers import make_published_event


def _text(content: str, **overrides):
    return make_published_event(type="assistant", subtype="text", content=content, **overrides)


def _human(content: str = "go"):
    return make_published_event(type="user", subtype="message", content=content, is_human=True)


def _result(subtype: str = "success", turn_id: str | None = "T1"):
    return make_published_event(type="result", subtype=subtype, content="", turn_id=turn_id)


def _feed(collector: TurnTextCollector, *events):
    return [ended for event in events if (ended := collector.observe(event)) is not None]


class TestTurnTextCollector:
    def test_text_events_are_joined_with_a_blank_line(self):
        ended = _feed(TurnTextCollector(), _human(), _text("Part A."), _text("Part B."), _result())

        assert [(e.turn_id, e.outcome, e.text) for e in ended] == [
            ("T1", "ended", "Part A.\n\nPart B."),
        ]

    def test_a_subagents_text_stays_out(self):
        ended = _feed(
            TurnTextCollector(),
            _human(),
            _text("subagent says", parent_tool_use_id="tu_1"),
            _text("mine"),
            _result(),
        )

        assert ended[0].text == "mine"

    def test_thinking_and_tool_calls_stay_out(self):
        ended = _feed(
            TurnTextCollector(),
            _human(),
            make_published_event(type="assistant", subtype="thinking", content="hmm"),
            make_published_event(
                type="assistant",
                subtype="tool_use",
                content="Bash",
                tool_name="Bash",
            ),
            make_published_event(type="user", subtype="tool_result", content="out"),
            _text("done"),
            _result(),
        )

        assert ended[0].text == "done"

    def test_two_results_are_two_turn_ends_each_with_its_own_text(self):
        ended = _feed(
            TurnTextCollector(),
            _human(),
            _text("first"),
            _result(turn_id="T1"),
            make_published_event(type="system", subtype="task_notification"),
            _text("second"),
            _result(turn_id="T1"),
        )

        assert [e.text for e in ended] == ["first", "second"]
        assert len({e.delivery_id for e in ended}) == 2

    def test_a_message_joined_into_a_running_turn_is_one_end(self):
        ended = _feed(
            TurnTextCollector(),
            _human(),
            _text("a"),
            _human("and also"),
            _text("b"),
            _result(),
        )

        assert [e.text for e in ended] == ["a\n\nb"]

    def test_a_turn_with_no_text_still_ends_with_an_empty_body(self):
        ended = _feed(TurnTextCollector(), _human(), _result())

        assert [(e.outcome, e.text) for e in ended] == [("ended", "")]

    @pytest.mark.parametrize(
        ("events", "outcome"),
        [
            ([_result("error_during_execution")], "failed"),
            (
                [make_published_event(type="system", subtype="error", content="boom"), _result()],
                "failed",
            ),
            (
                [
                    make_published_event(
                        type="assistant",
                        subtype="tool_use",
                        tool_name="AskUserQuestion",
                        tool_input={"questions": [{"question": "Which branch?"}]},
                    ),
                    _result(),
                ],
                "asking",
            ),
            (
                [
                    make_published_event(
                        type="assistant",
                        subtype="tool_use",
                        tool_name="ask_user_question",
                        tool_input={"questions": [{"question": "Q?"}]},
                    ),
                    make_published_event(
                        type="system",
                        subtype="interrupt_sent",
                        turn_running=True,
                    ),
                    make_published_event(type="system", subtype="error", content="x"),
                    _result(),
                ],
                "interrupted",
            ),
        ],
    )
    def test_the_outcome_takes_the_highest_ranked_signal(self, events, outcome):
        ended = _feed(TurnTextCollector(), _human(), *events)

        assert ended[0].outcome == outcome

    def test_an_asked_question_reads_as_a_plain_line(self):
        ended = _feed(
            TurnTextCollector(),
            _human(),
            make_published_event(
                type="assistant",
                subtype="tool_use",
                tool_name="AskUserQuestion",
                tool_input={"questions": [{"question": "Which branch?"}, {"header": "no text"}]},
            ),
            _result(),
        )

        assert ended[0].text == "Which branch?"

    def test_closing_an_open_turn_ends_it_with_what_it_had(self):
        collector = TurnTextCollector()
        _feed(collector, _human(), _text("half"))

        ended = collector.close("failed")

        assert ended is not None
        assert (ended.outcome, ended.text, ended.turn_id) == ("failed", "half", None)
        assert collector.close("failed") is None

    def test_closing_with_nothing_open_ends_nothing(self):
        collector = TurnTextCollector()
        _feed(collector, _human(), _text("x"), _result())

        assert collector.close("interrupted") is None


class TestEnvelope:
    def test_round_trip_keeps_attributes_with_quotes_and_the_body_verbatim(self):
        message = SiblingMessage(
            from_session_id="s-1",
            from_name='the "lint" <fix> & co',
            outcome="asking",
            delivery_id="d-1",
            text="line one\n\n  indented <b>x</b>",
        )

        found, rest = split_sibling_messages(sibling_envelope(message))

        assert (found, rest) == ([message], "")

    def test_a_body_holding_the_closing_tag_comes_back_whole_and_leaves_nothing(self):
        message = SiblingMessage("s", None, "ended", "d", "before\n</sibling-message>\nafter")

        found, rest = split_sibling_messages(f"{sibling_envelope(message)}\nMy own words.")

        assert (found, rest) == ([message], "My own words.")

    def test_a_nameless_sibling_carries_no_name_attribute(self):
        envelope = sibling_envelope(
            SiblingMessage(
                from_session_id="s",
                from_name=None,
                outcome="ended",
                delivery_id="d",
                text="t",
            ),
        )

        assert (
            envelope
            == '<sibling-message session="s" outcome="ended" id="d">\nt\n</sibling-message>'
        )

    def test_two_envelopes_and_text_around_them_split_in_order(self):
        first = SiblingMessage("s1", "a", "ended", "d1", "one")
        second = SiblingMessage("s2", None, "failed", "d2", "two")
        content = f"{sibling_envelope(first)}\n{sibling_envelope(second)}\nAnd my own words."

        found, rest = split_sibling_messages(content)

        assert found == [first, second]
        assert rest == "And my own words."

    @pytest.mark.parametrize(
        "content",
        [
            '<sibling-message session="s" outcome="bogus" id="d">\nt\n</sibling-message>',
            '<sibling-message outcome="ended" id="d">\nt\n</sibling-message>',
            '<sibling-message session="s" outcome="ended" id="d">\nno closing tag',
            "plain text",
        ],
    )
    def test_anything_malformed_is_left_as_it_is(self, content):
        assert split_sibling_messages(content) == ([], content)
