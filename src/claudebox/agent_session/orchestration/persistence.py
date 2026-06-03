"""Event persistence — JSONL append-only session log."""

from collections.abc import Iterable

import aiofiles

from .models import PublishedEvent
from ...constants import SESSION_EVENTS_FILE
from ...core import serialization
from ...core.io import read_jsonl
from ...workspace import Workspace


class EventLog:
    """Append-only JSONL session event log (async + flushed per write)."""

    def __init__(self, session_id: str, workspace: Workspace):
        session = workspace.ensure_session(session_id)
        self._path = session.path / SESSION_EVENTS_FILE
        self._file = None

    async def open(self) -> None:
        """Open the log file for async appending."""

        self._file = await aiofiles.open(self._path, "a")

    async def append(self, event: PublishedEvent) -> None:
        """Serialize and append event to log asynchronously."""

        await self._file.write(serialization.dumps(event) + "\n")  # ty: ignore[unresolved-attribute]
        await self._file.flush()  # ty: ignore[unresolved-attribute]

    def read_all(self) -> Iterable[PublishedEvent]:
        if not self._path.exists():
            return []

        return [PublishedEvent.fromdict(data) for data in read_jsonl(self._path)]

    async def close(self) -> None:
        """Flush and close the log file."""

        if self._file:
            await self._file.flush()
            await self._file.close()
            self._file = None
