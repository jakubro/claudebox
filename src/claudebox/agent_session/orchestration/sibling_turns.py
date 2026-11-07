"""Sibling sessions in a transcript - a spawned session's brief, its turn ends and their envelope."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from xml.sax.saxutils import escape, unescape

from .models import EventSubtype, EventType, PublishedEvent


SIBLING_OUTCOMES = ("ended", "asking", "interrupted", "failed")

SIBLING_MESSAGE_TAG = "sibling-message"

SIBLING_BRIEF_TAG = "sibling-brief"

SIBLING_BRIEF_ENDED_TAG = "sibling-brief-ended"

SIBLING_BRIEF_ENDED = (
    f"<system-reminder>\n<{SIBLING_BRIEF_ENDED_TAG}>\nThis session is a fork of a session another "
    "session started. The user reads it now, so the sibling brief earlier in this conversation no "
    f"longer applies.\n</{SIBLING_BRIEF_ENDED_TAG}>\n</system-reminder>"
)

_OUTCOME_RANK = {"ended": 0, "asking": 1, "failed": 2, "interrupted": 3}

_QUESTION_TOOL_NAMES = frozenset({"AskUserQuestion", "ask_user_question"})

_ENVELOPE = re.compile(
    rf"<{SIBLING_MESSAGE_TAG}((?:\s+[a-z_]+=\"[^\"]*\")*)>\n(.*?)\n</{SIBLING_MESSAGE_TAG}>(?=\n|$)",
    re.DOTALL,
)

_ATTRIBUTE = re.compile(r"([a-z_]+)=\"([^\"]*)\"")

_CLOSING_TAG = f"</{SIBLING_MESSAGE_TAG}>"

_ESCAPED_CLOSING_TAG = f"<\\/{SIBLING_MESSAGE_TAG}>"

_ATTRIBUTE_ENTITIES = {'"': "&quot;", "\n": "&#10;", "\r": "&#13;", "\t": "&#9;"}


@dataclass(frozen=True)
class SiblingTurnEnd:
    """One finished turn of a spawned session: its whole text and how it ended."""

    turn_id: str | None
    delivery_id: str
    outcome: str
    text: str


@dataclass(frozen=True)
class SiblingMessage:
    """A sibling's turn end as its parent reads it out of a user message."""

    from_session_id: str
    from_name: str | None
    outcome: str
    delivery_id: str
    text: str


class TurnTextCollector:
    """Collect each top-level turn's text from published events, ending a turn at each result.

    Splits at results, not turn ids: a follow-up a task notification runs shares its turn's id.
    """

    def __init__(self) -> None:
        self._reset()

    def observe(self, event: PublishedEvent) -> SiblingTurnEnd | None:
        """Take one event; return the turn it ended, if it ended one."""

        if event.parent_tool_use_id is not None:
            return None

        if event.type == EventType.RESULT:
            self._raise("ended" if event.subtype == "success" else "failed")

            return self._emit(event.turn_id)

        if event.type == EventType.USER and event.is_human:
            self._open = True
        elif event.type == EventType.ASSISTANT:
            self._open = True

            if event.subtype == EventSubtype.TEXT and event.content:
                self._parts.append(event.content)
            elif event.subtype == EventSubtype.TOOL_USE and event.tool_name in _QUESTION_TOOL_NAMES:
                self._ask((event.tool_input or {}).get("questions"))
        elif event.subtype == EventSubtype.INTERRUPT_SENT and event.turn_running:
            self._raise("interrupted")
        elif event.subtype == EventSubtype.ERROR:
            self._open = True
            self._raise("failed")

            if event.content:
                self._parts.append(event.content)
        elif event.subtype in (EventSubtype.TASK_NOTIFICATION, EventSubtype.SIBLING_MESSAGE):
            self._open = True

        return None

    def close(self, outcome: str) -> SiblingTurnEnd | None:
        """End a turn still open - the stream was lost, or the session stopped - as `outcome`."""

        if not self._open:
            return None

        self._raise(outcome)

        return self._emit(None)

    def _ask(self, questions: object) -> None:
        if not isinstance(questions, list) or not questions:
            return

        self._raise("asking")

        for question in questions:
            text = question.get("question") if isinstance(question, dict) else None

            if isinstance(text, str) and text.strip():
                self._parts.append(text.strip())

    def _raise(self, outcome: str) -> None:
        if _OUTCOME_RANK[outcome] > _OUTCOME_RANK[self._outcome]:
            self._outcome = outcome

    def _emit(self, turn_id: str | None) -> SiblingTurnEnd:
        ended = SiblingTurnEnd(
            turn_id=turn_id,
            delivery_id=str(uuid.uuid4()),
            outcome=self._outcome,
            text="\n\n".join(self._parts),
        )
        self._reset()

        return ended

    def _reset(self) -> None:
        self._parts: list[str] = []
        self._outcome = "ended"
        self._open = False


def sibling_brief(parent_session_id: str, parent_name: str | None) -> str:
    """Tell a spawned session which session started it, that only that session reads it, and how to ask."""

    attributes = [f"session={_quoted(parent_session_id)}"]
    label = parent_session_id

    if parent_name:
        attributes.append(f"name={_quoted(parent_name)}")
        label = f"{parent_name} ({parent_session_id})"

    return (
        f"<{SIBLING_BRIEF_TAG} {' '.join(attributes)}>\n"
        f"Session {label} started this session, and only that session reads what you write - the "
        "user is not watching this conversation. When you need an answer or a decision, end your "
        "turn with the question in plain text; that session receives it and answers.\n"
        f"</{SIBLING_BRIEF_TAG}>"
    )


def sibling_envelope(message: SiblingMessage) -> str:
    """The text a parent agent reads for a sibling's turn end; the body is verbatim but for the closing tag."""

    attributes = [f"session={_quoted(message.from_session_id)}"]

    if message.from_name:
        attributes.append(f"name={_quoted(message.from_name)}")

    attributes += [f"outcome={_quoted(message.outcome)}", f"id={_quoted(message.delivery_id)}"]

    body = message.text.replace(_CLOSING_TAG, _ESCAPED_CLOSING_TAG)

    return f"<{SIBLING_MESSAGE_TAG} {' '.join(attributes)}>\n{body}\n{_CLOSING_TAG}"


def split_sibling_messages(content: str) -> tuple[list[SiblingMessage], str]:
    """Take every well-formed envelope out of `content`; return them in order and what is left."""

    messages = []
    remainder = []
    position = 0

    for match in _ENVELOPE.finditer(content):
        if (message := _message(match)) is None:
            continue

        messages.append(message)
        remainder.append(content[position : match.start()])
        position = match.end()

    remainder.append(content[position:])

    return messages, "".join(remainder).strip() if messages else content


def _message(match: re.Match) -> SiblingMessage | None:
    attributes = {
        key: unescape(value, {entity: char for char, entity in _ATTRIBUTE_ENTITIES.items()})
        for key, value in _ATTRIBUTE.findall(match[1])
    }

    if (
        not attributes.get("session")
        or not attributes.get("id")
        or attributes.get("outcome") not in SIBLING_OUTCOMES
    ):
        return None
    else:
        return SiblingMessage(
            from_session_id=attributes["session"],
            from_name=attributes.get("name") or None,
            outcome=attributes["outcome"],
            delivery_id=attributes["id"],
            text=match[2].replace(_ESCAPED_CLOSING_TAG, _CLOSING_TAG),
        )


def _quoted(value: str) -> str:
    return f'"{escape(value, _ATTRIBUTE_ENTITIES)}"'
