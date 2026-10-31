"""Turn tracker - turn_id assignment for conversation events."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from .conversion import is_human_message
from .models import Event, EventSubtype, EventType, PublishedEvent
from ..events import AgentEvent, UserMessagePayload


class TurnTracker:
    """Track conversation turn IDs and handle compaction boundary assignment.

    compact_start captures the pre-compaction turn (via on_inject).
    compact_boundary takes the current turn, so a compaction a send triggers lands in its turn.
    A turn runs from the person's message to its result, and again while the agent follows it up.
    """

    def __init__(self):
        self._current: str | None = None
        self._running = False
        self._compacting: str | None = None
        self._assistant_emitted: dict[str, bool] = {}

    @property
    def current(self) -> str | None:
        """Return the active turn_id."""

        return self._current

    @property
    def running(self) -> bool:
        """Return whether the current turn is running."""

        return self._running

    @property
    def is_compacting(self) -> bool:
        """Return whether a compaction is currently in flight."""

        return self._compacting is not None

    def on_event(self, agent_event: AgentEvent) -> None:
        """Open a turn on the person's own message; no other runtime event moves the current one."""

        payload = agent_event.payload

        if (
            isinstance(payload, UserMessagePayload)
            and payload.uuid
            and payload.parent_tool_use_id is None
            and is_human_message(payload.content)
        ):
            self._current = payload.uuid

    def observe(self, event: PublishedEvent) -> None:
        """End the turn on a result; the person, the agent or a task notification runs it."""

        if event.parent_tool_use_id is not None:
            return

        if event.type == EventType.RESULT:
            self._running = False
        elif (
            _opens_turn(event)
            or event.type == EventType.ASSISTANT
            or event.subtype == EventSubtype.TASK_NOTIFICATION
        ):
            self._running = True

    def resume(self, history: Sequence[PublishedEvent]) -> None:
        """Continue the person's last turn in `history`, with its answered and running state."""

        openers = [i for i, event in enumerate(history) if _opens_turn(event)]

        # A send can open its turn before the resumed consumer reads the history; that turn stays.
        if self._current is not None or not openers:
            return

        start = openers[-1]
        self._current = history[start].turn_id

        if any(
            event.type == EventType.ASSISTANT or event.subtype == EventSubtype.ERROR
            for event in history[start + 1 :]
        ):
            self.mark_assistant_emitted(self._current)

        for event in history[start:]:
            self.observe(event)

    def on_inject(self, subtype: str, is_human: bool, turn_id: str | None) -> str | None:
        """Resolve an injected event's turn_id; a failure takes the current turn only if it runs."""

        if subtype == "compact_start":
            self._compacting = self._current

        # Fallback-injected boundaries bypass resolve(); clear here for idempotency.
        if subtype == "compact_boundary":
            self._compacting = None

        if is_human:
            turn_id = turn_id or str(uuid.uuid4())
            self._current = turn_id
            self._running = True
        elif turn_id is None and (self._running or subtype != EventSubtype.ERROR):
            turn_id = self._current

        return turn_id

    def resolve(self, event: Event) -> str | None:
        """Resolve turn_id for runtime-originated event."""

        if event.subtype == "compact_boundary" and self._compacting:
            self._compacting = None

            return self._current

        return self._current

    def mark_assistant_emitted(self, turn_id: str | None) -> None:
        """Record that this turn emitted an assistant event (turn-scoped, survives crash-restart)."""

        if turn_id is not None:
            self._assistant_emitted[turn_id] = True

    def has_assistant_emitted(self, turn_id: str | None) -> bool:
        """Return whether this turn already emitted an assistant event; None -> False."""

        if turn_id is None:
            return False

        return self._assistant_emitted.get(turn_id, False)


def _opens_turn(event: PublishedEvent) -> bool:
    return event.type == EventType.USER and event.is_human and event.parent_tool_use_id is None
