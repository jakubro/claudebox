"""Shared session repository - disk I/O for session.json files."""

from __future__ import annotations

from datetime import datetime
from functools import partial
from typing import TYPE_CHECKING, Any

from .models import SessionMetadata, SessionNotFound
from ..constants import SESSION_METADATA_FILE
from ..core.file_cache import FileCache
from ..core.io import read_json, write_json
from ..core.logging import get_logger


if TYPE_CHECKING:
    from pathlib import Path

    from ..workspace import Workspace


class SessionRepository:
    """Read and update session metadata from workspace disk.

    Shared list/get/update operations consumed by both daemon and web services; consumer-specific
    enrichment (container_id, projection) happens in the calling layer.
    """

    def __init__(self, workspace: Workspace) -> None:
        self._workspace = workspace
        self._logger = get_logger(__name__)
        self._records: FileCache[SessionMetadata | None] = FileCache()

    def list_all(self) -> list[SessionMetadata]:
        """List all sessions from workspace disk, sorted by updated_at descending.

        A record is re-read only when its session.json changed, or was still settling, at the previous listing.
        """

        sessions = []
        paths = []

        for session in self._workspace.list_sessions():
            path = session.path / SESSION_METADATA_FILE
            paths.append(path)

            try:
                metadata = self._records.get(path, partial(self._read_record, path, session.id))
            except ValueError:
                # Callers share one scan, so an unreadable record is skipped rather than failing all.
                self._logger.warning("Unreadable session metadata", path=str(path))

                continue

            if metadata is not None:
                sessions.append(metadata)

        self._records.retain(paths)

        # .replace(tzinfo=None) normalizes whichever operand wins to naive, so datetime.min (always
        # naive) sorts consistently against aware updated_at/started_at without a tz-mismatch error.
        return sorted(
            sessions,
            key=lambda s: (s.updated_at or s.started_at or datetime.min).replace(  # noqa: DTZ901
                tzinfo=None,
            ),
            reverse=True,
        )

    def get(self, session_id: str) -> SessionMetadata:
        """Read session metadata from disk.

        Raises SessionNotFound if the session or its metadata file is missing.
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
        data.setdefault("fork_point_cost_usd", 0.0)

        return SessionMetadata.fromdict(data)

    def update(self, session_id: str, **fields: Any) -> SessionMetadata:
        """Update session metadata fields on disk.

        Reads the raw dict, merges only the provided fields, and writes back - unknown keys in
        session.json are preserved. Returns the merged result as SessionMetadata.
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
        data.setdefault("fork_point_cost_usd", 0.0)

        return SessionMetadata.fromdict(data)

    @staticmethod
    def _read_record(path: Path, session_id: str) -> SessionMetadata | None:
        data = read_json(path, default=None)

        if not data:
            return None

        data.setdefault("session_id", session_id)
        data.setdefault("fork_point_cost_usd", 0.0)

        return SessionMetadata.fromdict(data)
