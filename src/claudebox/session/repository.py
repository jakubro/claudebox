"""Shared session repository — disk I/O for session.json files."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from .models import SessionMetadata, SessionNotFound
from ..constants import SESSION_METADATA_FILE
from ..core.io import read_json, write_json


if TYPE_CHECKING:
    from ..workspace import Workspace


class SessionRepository:
    """Read and update session metadata from workspace disk.

    Provides the shared list/get/update operations consumed by both daemon
    and web services. Consumer-specific enrichment (container_id, projection)
    happens in the calling layer.
    """

    def __init__(self, workspace: "Workspace") -> None:
        self._workspace = workspace

    def list_all(self) -> list[SessionMetadata]:
        """List all sessions from workspace disk, sorted by updated_at descending."""

        sessions = []

        for session in self._workspace.list_sessions():
            path = session.path / SESSION_METADATA_FILE

            if not path.exists():
                continue

            data = read_json(path, default=None)

            if not data:
                continue

            data.setdefault("session_id", session.id)
            sessions.append(SessionMetadata.fromdict(data))

        return sorted(
            sessions,
            key=lambda s: (s.updated_at or s.started_at or datetime.min).replace(tzinfo=None),
            reverse=True,
        )

    def get(self, session_id: str) -> SessionMetadata:
        """Read session metadata from disk.

        Raises SessionNotFound if session directory or session.json is missing.
        """

        session = self._workspace.find_session(session_id)
        if session is None:
            raise SessionNotFound(session_id)

        path = session.path / SESSION_METADATA_FILE

        if not path.exists():
            raise SessionNotFound(session_id)

        data = read_json(path, default=None)
        if not data:
            raise SessionNotFound(session_id)

        data.setdefault("session_id", session_id)
        return SessionMetadata.fromdict(data)

    def update(self, session_id: str, **fields: Any) -> SessionMetadata:
        """Update session metadata fields on disk.

        Reads the raw dict from disk, merges only the provided fields, writes
        back. Unknown keys in session.json are preserved. Returns the merged
        result as SessionMetadata.
        """

        session = self._workspace.find_session(session_id)
        if session is None:
            raise SessionNotFound(session_id)

        path = session.path / SESSION_METADATA_FILE

        if not path.exists():
            raise SessionNotFound(session_id)

        data = read_json(path, default={})
        data.update(fields)
        write_json(path, data)

        data.setdefault("session_id", session_id)
        return SessionMetadata.fromdict(data)
