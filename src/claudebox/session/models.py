"""Shared session metadata model and errors for daemon and web consumers."""

from dataclasses import dataclass
from datetime import datetime

from ..core.structures import DataClass


@dataclass
class SessionMetadata(DataClass):
    """Base session metadata read from session.json on disk.

    Fields shared by daemon (SessionInfo) and web (SessionSummary); consumer-specific fields live in subclasses.

    ``fork_point_cost_usd`` is the cost inherited from the ancestor at the fork point; 0 for root sessions.
    Rollup consumers subtract it when summing siblings, avoiding double-counting the shared pre-fork transcript.

    ``is_side_thread`` marks a shared-container fork - ``parent_session_id`` alone cannot, since an
    ordinary fork sets it too.

    ``spawned_from_session_id`` names the session that asked the spawn socket for this one:
    recorded lineage only, kept off ``parent_session_id`` so it never enters the fork tree.
    """

    session_id: str
    fork_point_cost_usd: float
    name: str | None = None
    model: str | None = None
    runtime: str | None = None
    provider: str | None = None
    started_at: datetime | None = None
    updated_at: datetime | None = None
    num_turns: int | None = None
    total_cost_usd: float | None = None
    first_message: str | None = None
    last_message: str | None = None
    parent_session_id: str | None = None
    session_dir: str | None = None
    is_side_thread: bool = False
    spawned_from_session_id: str | None = None


class SessionNotFound(Exception):
    """Session ID does not exist on workspace disk."""

    def __init__(self, session_id: str) -> None:
        super().__init__(f"Session not found: {session_id}")
        self.session_id = session_id
