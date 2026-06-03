"""Board file watcher — mtime polling with debounce for board.yaml changes."""

from pathlib import Path

from claudebox import Broadcaster, MtimeWatcher
from claudebox.extensions.tickets import board_id_from_path
from .models import BoardUpdateEvent
from ...constants import BOARD_WATCHER_DEBOUNCE_DELAY, BOARD_WATCHER_POLL_INTERVAL


class BoardWatcher(MtimeWatcher):
    """Watch board.yaml files for changes via mtime polling.

    Uses polling instead of inotify for reliability across filesystems
    (NFS, container mounts, watcher limit exhaustion).

    Attributes:
        _workspace_id: Workspace ID for SSE event scoping.
        _workspace_root: Absolute path to workspace root.
        _events: Broadcaster for pushing board_update events.
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

    async def _on_changed(self, path: Path) -> None:
        """Broadcast board update event when a board.yaml changes."""

        board_id = board_id_from_path(path, self._workspace_root)
        await self._events.broadcast(
            BoardUpdateEvent(
                workspace_id=self._workspace_id,
                board_id=board_id,
            ),
        )

        self._logger.info("Board changed on disk", board_id=board_id, path=str(path))
