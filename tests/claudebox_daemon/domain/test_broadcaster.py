"""Tests for claudebox_daemon.domain.broadcaster - daemon event delivery to subscribers."""

import pytest

from claudebox_daemon.domain.broadcaster import DaemonBroadcaster
from claudebox_daemon.domain.sessions.models import SessionsChangedEvent


class TestDaemonBroadcast:
    """Test that the daemon broadcaster delivers serialized events rather than dropping them."""

    @pytest.mark.anyio
    async def test_broadcast_delivers_event_to_subscriber(self):
        broadcaster = DaemonBroadcaster()
        _, queue = broadcaster.subscribe()

        event = SessionsChangedEvent(workspace_id="ws-1")
        await broadcaster.broadcast(event)

        delivered = queue.get_nowait()

        assert delivered["type"] == "sessions_changed"
        assert delivered["workspace_id"] == "ws-1"

    @pytest.mark.anyio
    async def test_broadcast_reaches_all_subscribers(self):
        broadcaster = DaemonBroadcaster()
        _, queue_a = broadcaster.subscribe()
        _, queue_b = broadcaster.subscribe()

        event = SessionsChangedEvent(workspace_id="ws-1")
        await broadcaster.broadcast(event)

        assert queue_a.get_nowait()["type"] == "sessions_changed"
        assert queue_b.get_nowait()["type"] == "sessions_changed"
