"""Tests for claudebox.broadcaster - async pub-sub with replay support."""

import asyncio

import pytest

from claudebox.core.broadcaster import Broadcaster


# --- Helpers ---


class PassthroughBroadcaster(Broadcaster):
    """Subclass that broadcasts events unchanged - for testing core mechanics."""

    def _on_event(self, event):
        return event


class FilteringBroadcaster(Broadcaster):
    """Subclass that filters even-numbered live events and emits replay markers."""

    def _on_event(self, event):
        """Suppress even-numbered events on the live broadcast path."""

        if isinstance(event, int) and event % 2 == 0:
            return None

        return event

    def _on_replay_started(self, length):
        """Emit replay start marker."""

        return {"marker": "start", "length": length}

    def _on_replay_ended(self):
        """Emit replay end marker."""

        return {"marker": "end"}


# --- Subscribe / Unsubscribe ---


class TestSubscribe:
    """Test subscriber registration and removal."""

    def test_subscribe_returns_id_and_queue(self):
        b = Broadcaster()
        sub_id, queue = b.subscribe()
        assert isinstance(sub_id, str)
        assert isinstance(queue, asyncio.Queue)

    def test_subscribe_unique_ids(self):
        b = Broadcaster()
        id1, _ = b.subscribe()
        id2, _ = b.subscribe()
        assert id1 != id2

    def test_unsubscribe_removes_subscriber(self):
        b = Broadcaster()
        sub_id, _ = b.subscribe()
        b.unsubscribe(sub_id)
        assert sub_id not in b._subscribers

    def test_unsubscribe_unknown_id_is_noop(self):
        b = Broadcaster()
        sub_id, _ = b.subscribe()
        b.unsubscribe("nonexistent")
        assert sub_id in b._subscribers


# --- Broadcast ---


class TestBroadcast:
    """Test event broadcasting to subscribers."""

    @pytest.mark.anyio
    async def test_broadcast_reaches_all_subscribers(self):
        b = PassthroughBroadcaster()
        _, q1 = b.subscribe()
        _, q2 = b.subscribe()

        await b.broadcast("event-1")

        assert q1.get_nowait() == "event-1"
        assert q2.get_nowait() == "event-1"

    @pytest.mark.anyio
    async def test_broadcast_skips_unsubscribed(self):
        b = PassthroughBroadcaster()
        id1, q1 = b.subscribe()
        _, q2 = b.subscribe()

        b.unsubscribe(id1)
        await b.broadcast("event-1")

        assert q1.empty()
        assert q2.get_nowait() == "event-1"

    @pytest.mark.anyio
    async def test_broadcast_none_event_is_suppressed(self):
        b = Broadcaster()
        _, q = b.subscribe()

        await b._broadcast(None)

        assert q.empty()

    @pytest.mark.anyio
    async def test_on_event_can_filter(self):
        b = FilteringBroadcaster()
        _, q = b.subscribe()

        await b.broadcast(1)
        await b.broadcast(2)
        await b.broadcast(3)

        assert q.get_nowait() == 1
        assert q.get_nowait() == 3
        assert q.empty()


# --- Schedule Broadcast ---


class TestScheduleBroadcast:
    """Test sync-context broadcast scheduling."""

    @pytest.mark.anyio
    async def test_schedule_broadcast_delivers_event(self):
        b = PassthroughBroadcaster()
        _, q = b.subscribe()

        b.schedule_broadcast("sync-event")
        await asyncio.sleep(0.01)

        assert q.get_nowait() == "sync-event"

    def test_schedule_broadcast_noop_without_loop(self):
        b = PassthroughBroadcaster()
        _, q = b.subscribe()

        # No running loop - should not raise
        b.schedule_broadcast("orphan")
        assert q.empty()


# --- Replay ---


class TestReplay:
    """Test event replay to a single subscriber queue."""

    @pytest.mark.anyio
    async def test_replay_sends_events(self):
        b = Broadcaster()
        q = asyncio.Queue()

        await b.replay_to(q, ["a", "b", "c"])

        items = []

        while not q.empty():
            items.append(q.get_nowait())

        assert items == ["a", "b", "c"]

    @pytest.mark.anyio
    async def test_replay_skips_none_events(self):
        b = Broadcaster()
        q = asyncio.Queue()

        await b.replay_to(q, ["a", None, "b"])

        items = []

        while not q.empty():
            items.append(q.get_nowait())

        assert items == ["a", "b"]

    @pytest.mark.anyio
    async def test_replay_with_markers(self):
        """Replay path emits boundary markers around events; _on_event is NOT applied (caller-pre-transformed)."""

        b = FilteringBroadcaster()
        q = asyncio.Queue()

        await b.replay_to(q, [1, 2, 3])

        items = []

        while not q.empty():
            items.append(q.get_nowait())

        assert items == [{"marker": "start", "length": 3}, 1, 2, 3, {"marker": "end"}]

    @pytest.mark.anyio
    async def test_replay_empty_list(self):
        b = Broadcaster()
        q = asyncio.Queue()

        await b.replay_to(q, [])

        assert q.empty()
