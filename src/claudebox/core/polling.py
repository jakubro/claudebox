"""Async polling primitives - start/stop lifecycle with cancellation handling."""

import asyncio
from abc import ABC, abstractmethod
from pathlib import Path

from .logging import get_logger


class AsyncPoller(ABC):
    """Base class for background polling tasks with start/stop lifecycle.

    Subclasses implement _poll() for a single iteration. The base handles
    task creation/cancellation, sleep interval, error isolation, and
    structured logging.

    Attributes:
        _interval: Seconds between poll iterations.
        _name: Human-readable name for logging.
    """

    def __init__(self, *, interval: float, name: str) -> None:
        """Initialize poller with interval and display name."""

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
        """Run poll iterations with sleep and error isolation."""

        while True:
            await asyncio.sleep(self._interval)

            try:
                await self._poll()
            except Exception:
                self._logger.warning("%s poll failed", self._name, exc_info=True)


class MtimeWatcher(AsyncPoller):
    """Watch files for mtime changes with debounce.

    General-purpose file watcher using mtime polling. Subclasses implement
    _on_changed(path) to react to detected changes.

    Attributes:
        _debounce: Seconds to wait after detecting a change before notifying.
        _watched: Map of file path string -> last known mtime.
    """

    def __init__(self, *, interval: float, debounce: float, name: str) -> None:
        """Initialize watcher with poll interval and debounce delay."""

        super().__init__(interval=interval, name=name)
        self._debounce = debounce
        self._watched: dict[str, float] = {}

    def watch(self, path: Path) -> None:
        """Register a file for watching."""

        key = str(path)
        self._watched[key] = self._get_mtime(path)

    def unwatch(self, path: Path) -> None:
        """Remove a file from watching."""

        self._watched.pop(str(path), None)

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
