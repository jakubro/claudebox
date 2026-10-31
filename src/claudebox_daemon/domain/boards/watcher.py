"""Board file watcher - stamp polling with debounce for board.yaml and ticket file changes."""

from __future__ import annotations

from pathlib import Path

from claudebox import Broadcaster, MtimeWatcher
from .models import BoardUpdateEvent
from ...constants import BOARD_WATCHER_DEBOUNCE_DELAY, BOARD_WATCHER_POLL_INTERVAL


class BoardWatcher(MtimeWatcher):
    """Watch board.yaml and ticket files for changes, each reported as a change to its board.

    Uses polling instead of inotify for reliability across filesystems (NFS, container mounts, watcher limits).
    """

    def __init__(
        self,
        workspace_id: str,
        workspace_root: Path,
        events: Broadcaster,
    ) -> None:
        super().__init__(
            interval=BOARD_WATCHER_POLL_INTERVAL.total_seconds(),
            debounce=BOARD_WATCHER_DEBOUNCE_DELAY.total_seconds(),
            name="Board watcher",
        )

        self._workspace_id = workspace_id
        self._workspace_root = workspace_root
        self._events = events
        self._owners: dict[str, str] = {}

    def sync(self, owners: dict[Path, str]) -> None:
        """Watch exactly these files, each reported as a change to the board id it maps to."""

        self._owners = {str(path): board_id for path, board_id in owners.items()}
        self.sync_watches(list(owners))

    async def _on_changed(self, path: Path) -> None:
        """Broadcast a board update for the board that owns the changed file."""

        board_id = self._owners.get(str(path))

        if board_id is None:
            return

        await self._events.broadcast(
            BoardUpdateEvent(
                workspace_id=self._workspace_id,
                board_id=board_id,
            ),
        )

        self._logger.info("Board changed on disk", board_id=board_id, path=str(path))
