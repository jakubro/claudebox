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

    container_id scopes the event to one container for mutation-triggered changes;
    it is absent for explicit operations (create, resume, fork, update).
    """

    workspace_id: str
    container_id: str | None = None
    type: str = "sessions_changed"


@dataclass
class SessionInfo(SessionMetadata):
    """Session metadata extended with daemon-specific container state."""

    container_id: str | None = None
    workspace: str | None = None
    permission_mode: str | None = None
    effort_level: str | None = None
