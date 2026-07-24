"""Daemon event broadcaster - serializes domain events for SSE subscribers."""

from claudebox import Broadcaster, DataClass


class DaemonBroadcaster(Broadcaster[DataClass, dict]):
    """Daemon-level Broadcaster: projects each domain event to its SSE wire dict.

    The base Broadcaster drops events by default (its _on_event returns None);
    this override projects every event to the dict the SSE layer streams, so
    daemon signals (sessions_changed, container_status, ...) reach subscribers.
    """

    def _on_event(self, event: DataClass) -> dict:
        return event.asdict()
