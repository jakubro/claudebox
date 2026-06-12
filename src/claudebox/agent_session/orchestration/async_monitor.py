"""Async task monitor - tail output files and emit events."""

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
    """Tail async task output file and emit transformed events.

    Monitors output file written by background Task agents, transforms each line
    to Event format, and calls on_event callback to inject into parent session.

    Attributes:
        agent_id: Background task agent ID for correlation.
        output_file: Path to the task output file being monitored.
        parent_tool_use_id: Tool use ID of the parent Task block.
        on_event: Callback for delivering parsed events.
    """

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
        """Tail output file and emit events until stopped.

        Waits for the output file to exist, then continuously reads new lines
        from the configured byte offset. Each valid JSON line is parsed and
        converted to Event objects via dict_message_to_events, then passed to
        the on_event callback.
        """

        self._running = True
        self._logger.info(
            "Starting async task monitor",
            agent_id=self.agent_id,
            offset=self._offset,
        )

        # Wait for file to exist
        while self._running and not self.output_file.exists():
            await asyncio.sleep(0.1)

        if not self._running:
            return

        async with aiofiles.open(self.output_file, "r") as f:
            await f.seek(self._offset)

            while self._running:
                line = await f.readline()

                if line:
                    self._offset = await f.tell()
                    await self._process_line(line.strip())
                else:
                    await asyncio.sleep(0.1)

    def stop(self) -> None:
        """Signal monitor to stop gracefully after processing current line."""

        self._running = False

    async def _process_line(self, line: str) -> None:
        """Parse line and emit events via unified converter."""

        if not line:
            return

        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            self._logger.warning("Invalid JSON in async task output", line=line[:100])

            return

        for event in dict_message_to_events(data):
            await self.on_event(event, str(self.output_file), self._offset)
