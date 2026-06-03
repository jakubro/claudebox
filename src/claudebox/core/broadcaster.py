"""Generic pub-sub broadcaster with replay support for async event streaming."""

import asyncio
import uuid
from collections.abc import Iterable
from typing import Generic, TypeVar


TSource = TypeVar("TSource")
TTarget = TypeVar("TTarget")


class Broadcaster(Generic[TSource, TTarget]):
    """Manage subscribers and broadcast events with replay support."""

    def __init__(self):
        self._subscribers: dict[str, asyncio.Queue[TTarget]] = {}

    def subscribe(self) -> tuple[str, asyncio.Queue[TTarget]]:
        """Register a new subscriber and return (subscriber_id, queue)."""

        subscriber_id = str(uuid.uuid4())
        queue = asyncio.Queue()

        self._subscribers[subscriber_id] = queue
        return subscriber_id, queue

    def unsubscribe(self, subscriber_id: str) -> None:
        """Remove a subscriber from the broadcast list."""

        self._subscribers.pop(subscriber_id, None)

    async def broadcast(self, event: TSource) -> None:
        """Push event to all subscribers."""

        processed = self._on_event(event)
        await self._broadcast(processed)

    def schedule_broadcast(self, event: TSource) -> None:
        """Schedule async broadcast from sync context. No-op if no event loop is running."""

        processed = self._on_event(event)

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            loop.create_task(self._broadcast(processed))

    async def _broadcast(self, event: TTarget | None) -> None:
        """Push processed event to all subscriber queues."""

        if event is None:
            return

        for queue in list(self._subscribers.values()):
            await queue.put(event)

    async def replay_to(
        self,
        queue: asyncio.Queue[TTarget],
        events: Iterable[TTarget | None],
    ) -> None:
        """Replay events to a single queue with boundary markers."""

        events = list(events)

        started = self._on_replay_started(len(events))
        if started is not None:
            await queue.put(started)

        for event in events:
            if event is not None:
                await queue.put(event)

        ended = self._on_replay_ended()
        if ended is not None:
            await queue.put(ended)

    def _on_event(self, event: TSource) -> TTarget | None:
        """Process event before broadcasting. Override to transform or filter."""

        return None

    def _on_replay_started(self, length: int) -> TTarget | None:
        """Create replay started marker event. Override to emit boundary markers."""

        return None

    def _on_replay_ended(self) -> TTarget | None:
        """Create replay ended marker event. Override to emit boundary markers."""

        return None
