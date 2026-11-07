"""Async task monitor - tail output files and emit events."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Protocol

import aiofiles

from .conversion import dict_message_to_events
from .models import Event
from ...core.logging import get_logger


class OnMonitorEvent(Protocol):
    """Callback invoked for each event parsed from a task output file."""

    async def __call__(self, event: Event, source_file: str, source_offset: int) -> None: ...


class AsyncTaskMonitor:
    """Tail async task output file and emit transformed events."""

    def __init__(
        self,
        agent_id: str,
        output_file: str | Path,
        parent_tool_use_id: str,
        on_event: OnMonitorEvent,
        start_offset: int = 0,
    ):
        self._logger = get_logger(__name__)

        self.agent_id = agent_id
        self.output_file = Path(output_file)
        self.parent_tool_use_id = parent_tool_use_id
        self.on_event = on_event
        self._offset = start_offset
        self._running = False

    async def run(self) -> None:
        """Tail output file and emit events until stopped."""

        self._running = True
        self._logger.info(
            "Starting async task monitor",
            agent_id=self.agent_id,
            offset=self._offset,
        )

        while self._running and not self.output_file.exists():
            await asyncio.sleep(0.1)

        if not self._running:
            return

        async with aiofiles.open(self.output_file, "r", encoding="utf-8") as f:
            await f.seek(self._offset)

            while self._running:
                line = await f.readline()

                if line.endswith("\n"):
                    self._offset = await f.tell()
                    await self._process_line(line.strip())
                else:
                    await f.seek(self._offset)
                    await asyncio.sleep(0.1)

    def stop(self) -> None:
        """Signal monitor to stop gracefully after processing current line."""

        self._running = False

    async def _process_line(self, line: str) -> None:
        """Parse line and emit events via unified converter."""

        if not line:
            return

        try:
            events = list(dict_message_to_events(json.loads(line)))
        except Exception as exc:  # noqa: BLE001 - one unparseable line must not stop the tail
            self._logger.warning(
                "Unparseable async task output line",
                line=line[:100],
                error=str(exc),
            )

            return

        for event in events:
            await self.on_event(event, str(self.output_file), self._offset)
