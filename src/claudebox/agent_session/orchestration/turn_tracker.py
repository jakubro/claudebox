"""Turn tracker — turn_id assignment for conversation events."""

from .models import Event
from ..events import AgentEvent


class TurnTracker:
    """Track conversation turn IDs and handle compaction boundary assignment.

    Encapsulates the state machine for turn_id resolution: which turn_id an event
    belongs to. For compaction events, compact_start captures the pre-compaction turn
    (via on_inject) while compact_boundary uses the current turn (which has advanced
    to the new turn by the time the boundary arrives).

    Attributes:
        current: Current turn_id for use by nested event processors.
    """

    def __init__(self):
        self._current: str | None = None
        self._compacting: str | None = None

    @property
    def current(self) -> str | None:
        """Return the active turn_id."""

        return self._current

    @property
    def is_compacting(self) -> bool:
        """Return whether a compaction is currently in flight."""

        return self._compacting is not None

    def on_event(self, agent_event: AgentEvent) -> None:
        """Update turn tracking from a runtime AgentEvent."""

        if agent_event.kind != "user":
            return

        uuid = agent_event.payload.get("uuid")
        if uuid:
            self._current = uuid

    def on_inject(self, subtype: str, is_human: bool, turn_id: str | None) -> str | None:
        """Resolve turn_id for injected events. Returns the turn_id to use."""

        if subtype == "compact_start":
            self._compacting = self._current

        if is_human and turn_id is None:
            import uuid as _uuid

            turn_id = str(_uuid.uuid4())
            self._current = turn_id

        elif turn_id is None:
            turn_id = self._current

        return turn_id

    def resolve(self, event: Event) -> str | None:
        """Resolve turn_id for runtime-originated event."""

        if event.subtype == "compact_boundary" and self._compacting:
            self._compacting = None
            return self._current

        return self._current
