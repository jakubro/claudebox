"""Async polling primitives - start/stop lifecycle with cancellation handling."""

import asyncio
from abc import ABC, abstractmethod
from pathlib import Path

from .logging import get_logger


# Module-level so tests can shrink MIN_POLL_BOUND instead of waiting out the full 60s.
MIN_POLL_BOUND = 60.0
POLL_BOUND_INTERVAL_MULTIPLIER = 4


class AsyncPoller(ABC):
    """Base class for background polling tasks with start/stop lifecycle; subclasses implement _poll()."""

    def __init__(self, *, interval: float, name: str) -> None:
        self._logger = get_logger(__name__)
        self._interval = interval
        self._name = name
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the background polling task."""

        self._logger.debug("Starting %s...", self._name)
        self._task = asyncio.create_task(self._loop())
        self._logger.info("%s started", self._name)

    async def stop(self) -> None:
        """Cancel the polling task and await completion."""

        self._logger.debug("Stopping %s...", self._name)

        if self._task:
            self._task.cancel()

            try:
                await self._task
            except asyncio.CancelledError:
                pass

            self._task = None

        self._logger.info("%s stopped", self._name)

    @abstractmethod
    async def _poll(self) -> None:
        """Single poll iteration. Called every interval seconds."""

    async def _loop(self) -> None:
        """Run poll iterations with sleep, a bounded wait, and error isolation."""

        poll_bound = max(MIN_POLL_BOUND, self._interval * POLL_BOUND_INTERVAL_MULTIPLIER)

        while True:
            await asyncio.sleep(self._interval)

            try:
                await asyncio.wait_for(self._poll(), timeout=poll_bound)
            except Exception:
                self._logger.warning("%s poll failed", self._name, exc_info=True)


class MtimeWatcher(AsyncPoller):
    """Watch files for mtime changes with debounce; subclasses implement _on_changed()."""

    def __init__(self, *, interval: float, debounce: float, name: str) -> None:
        super().__init__(interval=interval, name=name)
        self._debounce = debounce
        self._watched: dict[str, float] = {}

    def sync_watches(self, paths: list[Path]) -> None:
        """Replace watched set with the given paths."""

        new_watched = {}

        for path in paths:
            key = str(path)
            new_watched[key] = self._watched.get(key, self._get_mtime(path))

        self._watched = new_watched

    async def _poll(self) -> None:
        """Check watched files for mtime changes."""

        for key in list(self._watched.keys()):
            path = Path(key)
            current_mtime = self._get_mtime(path)
            previous_mtime = self._watched.get(key, 0)

            if current_mtime != previous_mtime and current_mtime > 0:
                self._watched[key] = current_mtime

                if self._debounce > 0:
                    await asyncio.sleep(self._debounce)

                await self._on_changed(path)

    @abstractmethod
    async def _on_changed(self, path: Path) -> None:
        """React to a file change. Called after debounce."""

    @classmethod
    def _get_mtime(cls, path: Path) -> float:
        """Return file modification time, or 0 if unavailable."""

        try:
            return path.stat().st_mtime
        except OSError:
            return 0
