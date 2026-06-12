"""Shared session metadata model and errors for daemon and web consumers."""

from dataclasses import dataclass
from datetime import datetime

from ..core.structures import DataClass


@dataclass
class SessionMetadata(DataClass):
    """Base session metadata read from session.json on disk.

    Contains the common fields shared by both daemon (SessionInfo) and web
    (SessionSummary) consumers. Consumer-specific fields live in subclasses.

    Attributes:
        session_id: Unique session identifier.
        fork_point_cost_usd: Cost inherited from the ancestor at the fork point; 0 for
            root sessions. Rollup consumers subtract this when summing across sibling
            sessions to avoid double-counting the shared pre-fork transcript.
        name: User-assigned session name.
        model: Model used for the session.
        started_at: Session start timestamp.
        updated_at: Last activity timestamp.
        num_turns: Number of conversation turns.
        total_cost_usd: Cumulative session cost.
        first_message: Preview of the first user message.
        last_message: Preview of the most recent message.
        parent_session_id: Parent session ID if forked.
        session_dir: Claudebox session directory path on disk.
    """

    session_id: str
    fork_point_cost_usd: float
    name: str | None = None
    model: str | None = None
    started_at: datetime | None = None
    updated_at: datetime | None = None
    num_turns: int | None = None
    total_cost_usd: float | None = None
    first_message: str | None = None
    last_message: str | None = None
    parent_session_id: str | None = None
    session_dir: str | None = None


class SessionNotFound(Exception):
    """Session ID does not exist on workspace disk.

    Attributes:
        session_id: The session ID that was not found.
    """

    def __init__(self, session_id: str) -> None:
        super().__init__(f"Session not found: {session_id}")
        self.session_id = session_id
