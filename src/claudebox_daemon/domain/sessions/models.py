"""Session metadata models for daemon-side session management."""

from __future__ import annotations

from dataclasses import dataclass

from claudebox import DataClass, SessionMetadata


@dataclass(frozen=True)
class RenderedListing:
    """A sessions listing rendered once and shared by every caller of the same scan."""

    body: bytes
    session_count: int
    sessions: tuple[SessionInfo, ...] = ()


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
    """Session metadata extended with daemon-specific container state - ``failed_prompts`` differs
    from ``undelivered_messages`` (new_session's own, unrelated allowlist-rejection field).
    """

    container_id: str | None = None
    workspace: str | None = None
    permission_mode: str | None = None
    effort_level: str | None = None
    failed_prompts: list[str] | None = None
    failed_seeds: list[str] | None = None


@dataclass
class SiblingSummary(DataClass):
    """One session a caller spawned, as the spawn socket's list verb reports it."""

    session_id: str
    name: str | None
    state: str
