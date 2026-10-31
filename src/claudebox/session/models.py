"""Shared session metadata model and errors for daemon and web consumers."""

from __future__ import annotations

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

    ``is_promoted`` marks a side thread promoted onto the rail - it never stops after an answer.

    ``spawned_from_session_id`` names the session that asked the spawn socket for this one:
    recorded lineage only, kept off ``parent_session_id`` so it never enters the fork tree.

    ``auto_name`` is a title a small model writes at the third, sixth and tenth user message; ``name``
    is the one given by hand, and wins wherever both exist.

    ``bundle`` names the settings bundle the session was created under; it is stamped once and every
    container the session later gets is built from that bundle as the settings then declare it.

    ``needs_user`` is the one-line reason the agent is blocked on the user, or None when it is not;
    the user's next message clears it, and a fork, a side thread or a spawned session never has it.
    ``needs_user_replies`` are the replies a needs_user call offered with it, set and cleared alongside.

    ``activity`` is ``"working"`` while the agent answers, ``"waiting"`` once it has finished while work
    it started in the background is still going, else None; it holds only while a container serves the
    session, since a container that dies mid-turn leaves it behind.
    """

    session_id: str
    fork_point_cost_usd: float
    name: str | None = None
    auto_name: str | None = None
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
    is_promoted: bool = False
    spawned_from_session_id: str | None = None
    bundle: str | None = None
    needs_user: str | None = None
    needs_user_replies: list[str] | None = None
    activity: str | None = None


class SessionNotFound(Exception):
    """Session ID does not exist on workspace disk."""

    def __init__(self, session_id: str) -> None:
        super().__init__(f"Session not found: {session_id}")
        self.session_id = session_id
