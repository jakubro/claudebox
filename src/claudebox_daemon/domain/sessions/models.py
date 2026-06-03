"""Session metadata models for daemon-side session management."""

from dataclasses import dataclass

from claudebox import DataClass, SessionMetadata


@dataclass
class SessionProgressEvent(DataClass):
    """Session lifecycle progress broadcast via SSE."""

    workspace_id: str
    message: str
    session_id: str | None = None
    type: str = "session_progress"


@dataclass
class SessionsChangedEvent(DataClass):
    """Lightweight signal broadcast via SSE when the sessions list changes.

    Attributes:
        container_id: When set, scopes the event to a specific container.
            Present for mutation-triggered changes, absent for explicit
            operations (create, resume, fork, update).
    """

    workspace_id: str
    container_id: str | None = None
    type: str = "sessions_changed"


@dataclass
class SessionInfo(SessionMetadata):
    """Session metadata extended with daemon-specific container state.

    Attributes:
        container_id: ID of the container currently serving this session.
        workspace: Path to the workspace root.
        permission_mode: Active permission mode for this session.
        effort_level: Active effort level for this session.
    """

    container_id: str | None = None
    workspace: str | None = None
    permission_mode: str | None = None
    effort_level: str | None = None
