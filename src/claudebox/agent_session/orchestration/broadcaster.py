"""Session broadcaster — event serialization and replay boundaries."""

import asyncio
from datetime import UTC, datetime

from .conversion import serialize_event
from .models import EventSubtype, EventType, PublishedEvent
from ...core.broadcaster import Broadcaster as BaseBroadcaster
from ...core.logging import get_logger


class Broadcaster(BaseBroadcaster[PublishedEvent, dict]):
    """Session-event Broadcaster: serializes PublishedEvent + emits replay boundaries."""

    def __init__(self):
        self._logger = get_logger(__name__)
        super().__init__()

    def subscribe(self) -> tuple[str, asyncio.Queue]:
        """Register a new subscriber and return (subscriber_id, queue)."""

        subscriber_id, queue = super().subscribe()

        self._logger.debug("Subscriber subscribed", subscriber_id=subscriber_id)
        return subscriber_id, queue

    def unsubscribe(self, subscriber_id: str) -> None:
        """Remove a subscriber from the broadcast list."""

        super().unsubscribe(subscriber_id)
        self._logger.debug("Subscriber unsubscribed", subscriber_id=subscriber_id)

    def _on_event(self, event: PublishedEvent) -> dict:
        return serialize_event(event)

    def _on_replay_started(self, length: int) -> dict:
        """Create serialized replay_started boundary event."""

        event = self._make_boundary(EventSubtype.REPLAY_STARTED, length)
        return serialize_event(event)

    def _on_replay_ended(self) -> dict:
        """Create serialized replay_ended boundary event."""

        event = self._make_boundary(EventSubtype.REPLAY_ENDED, 0)
        return serialize_event(event)

    @classmethod
    def _make_boundary(cls, subtype: EventSubtype, count: int) -> PublishedEvent:
        """Create synthetic replay boundary event."""

        return PublishedEvent(
            type=EventType.SYSTEM,
            subtype=subtype,
            content=str(count),
            primary=False,
            is_human=False,
            raw={"count": count},
            count=count,
            id=f"replay_{subtype}",
            ts=datetime.now(UTC),
            turn_id=None,
        )
