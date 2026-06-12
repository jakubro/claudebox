"""Async task manager - monitor lifecycle and event detection."""

import asyncio
import json
from pathlib import Path
from typing import Protocol

from .async_monitor import AsyncTaskMonitor
from .models import Event, PublishedEvent
from ...core.logging import get_logger


class OnNestedEvent(Protocol):
    """Callback invoked for events from async task monitors, with source tracking."""

    async def __call__(
        self,
        event: Event,
        parent_tool_use_id: str,
        source_file: str,
        source_offset: int,
    ) -> None: ...


class AsyncTaskManager:
    """Detect async task launch/completion and manage monitor lifecycle.

    Listens to session events to detect when background Task agents are launched,
    starts monitors to tail their output files, and stops monitors when task
    completion notifications arrive. Handles session resume by reattaching
    monitors for in-progress tasks.

    Attributes:
        _on_event: Callback for delivering parsed events to the pipeline.
        _monitors: Active monitors keyed by agent_id.
        _output_files: Agent output file paths keyed by agent_id.
    """

    def __init__(
        self,
        on_event: OnNestedEvent,
    ):
        self._logger = get_logger(__name__)

        self._on_event = on_event
        self._monitors: dict[str, tuple[AsyncTaskMonitor, asyncio.Task]] = {}
        self._output_files: dict[str, str] = {}

    # Event Detection
    # ----------------------------------------------------------------------------------------------

    def check_event(self, event: PublishedEvent) -> None:
        """Check event for async task launch or completion signals.

        Inspects tool_result events for async task launches and
        task_notification events for completions.
        """

        if event.subtype == "tool_result":
            self._check_launch(event)
        elif event.subtype == "task_notification":
            self._check_notification(event)

    def reattach(self, events: list[PublishedEvent]) -> None:
        """Scan historical events and reattach monitors for in-progress tasks.

        Used during session resume to restart monitoring of background tasks that
        were launched before the session was interrupted. Determines the byte
        offset to resume from to avoid duplicate event emission.
        """

        in_progress = self._detect_in_progress(events)

        for agent_id, task_info in in_progress.items():
            offset = self._get_resume_offset(events, agent_id)
            self._start_monitor(
                agent_id=agent_id,
                output_file=task_info["output_file"],
                parent_tool_use_id=task_info["parent_tool_use_id"],
                start_offset=offset,
            )

    def stop_all(self) -> None:
        for agent_id in list(self._monitors.keys()):
            self._stop_monitor(agent_id, force=True)

    def _check_launch(self, event: PublishedEvent) -> None:
        """Check if tool_result indicates async task launch."""

        res = event.tool_use_result

        if not res:
            return

        is_async = res.get("isAsync") or res.get("is_async")
        status = res.get("status")

        if not (is_async or status == "async_launched"):
            return

        agent_id = res.get("agentId") or res.get("agent_id")
        output_file = res.get("outputFile") or res.get("output_file")
        parent_tool_use_id = event.tool_use_id

        if agent_id and output_file and parent_tool_use_id:
            self._output_files[agent_id] = output_file
            self._start_monitor(
                agent_id=agent_id,
                output_file=output_file,
                parent_tool_use_id=parent_tool_use_id,
            )

    def _check_notification(self, event: PublishedEvent) -> None:
        """Stop monitor when task_notification system event arrives."""

        msg = event.message_data

        if not isinstance(msg, dict):
            return

        task_id = msg.get("task_id") or msg.get("agent_id")

        if task_id:
            self._stop_monitor(task_id)

    # Notification Enrichment
    # ----------------------------------------------------------------------------------------------

    def enrich_notification(self, event: PublishedEvent) -> None:
        """Replace generic summary with actual agent output from output file.

        Must be called BEFORE the event is persisted/broadcast so the enriched
        summary is stored and sent to subscribers.
        """

        msg = event.message_data

        if not isinstance(msg, dict):
            return

        task_id = msg.get("task_id")
        output_file = self._output_files.get(task_id) if task_id else None

        if not output_file:
            return

        text = self._extract_summary(Path(output_file))

        if text:
            msg["content"] = text
            msg["summary"] = text[:200]

    # Monitor Lifecycle
    # ----------------------------------------------------------------------------------------------

    def _start_monitor(
        self,
        agent_id: str,
        output_file: str,
        parent_tool_use_id: str,
        start_offset: int = 0,
    ) -> None:
        """Start monitoring async task output file."""

        if agent_id in self._monitors:
            return

        async def on_event(event: Event, source_file: str, source_offset: int) -> None:
            await self._on_event(event, parent_tool_use_id, source_file, source_offset)

        monitor = AsyncTaskMonitor(
            agent_id=agent_id,
            output_file=output_file,
            parent_tool_use_id=parent_tool_use_id,
            on_event=on_event,
            start_offset=start_offset,
        )
        task = asyncio.create_task(monitor.run())
        self._monitors[agent_id] = (monitor, task)
        self._logger.info("Started async task monitor", agent_id=agent_id)

    def _stop_monitor(self, agent_id: str, *, force: bool = False) -> None:
        """Stop monitoring async task output file. Use force=True to cancel immediately."""

        entry = self._monitors.pop(agent_id, None)

        if not entry:
            return

        monitor, task = entry

        if force:
            task.cancel()
        else:
            monitor.stop()

        self._logger.info("Stopped async task monitor", agent_id=agent_id)

    # Resume Support
    # ----------------------------------------------------------------------------------------------

    def _extract_summary(self, output_path: Path) -> str:
        """Extract last assistant text from agent output file."""

        if not output_path.exists():
            return ""

        last_text = ""

        with open(output_path) as f:
            for line in f:
                line = line.strip()

                if not line:
                    continue

                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    self._logger.warning("Invalid JSON in task notification", line=line[:100])
                    continue

                if data.get("type") != "assistant":
                    continue

                message = data.get("message", {})
                blocks = message.get("content", [])

                if not isinstance(blocks, list):
                    continue

                for block in blocks:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text = block.get("text", "").strip()

                        if text:
                            last_text = text

        return last_text

    @staticmethod
    def _detect_in_progress(events: list[PublishedEvent]) -> dict:
        """Find async tasks that launched but haven't completed."""

        async_tasks = {}
        completed = set()

        for event in events:
            if event.subtype == "tool_result":
                res = event.tool_use_result

                if not res:
                    continue

                is_async = res.get("isAsync") or res.get("is_async")
                status = res.get("status")

                if is_async or status == "async_launched":
                    agent_id = res.get("agentId") or res.get("agent_id")
                    output_file = res.get("outputFile") or res.get("output_file")
                    parent_tool_use_id = event.tool_use_id

                    if agent_id and output_file and parent_tool_use_id:
                        async_tasks[agent_id] = {
                            "output_file": output_file,
                            "parent_tool_use_id": parent_tool_use_id,
                        }

            # task_notification system event (normalized by container API)
            if event.subtype == "task_notification":
                msg = event.message_data

                if isinstance(msg, dict):
                    tid = msg.get("task_id") or msg.get("agent_id")

                    if tid:
                        completed.add(tid)

        return {k: v for k, v in async_tasks.items() if k not in completed}

    @staticmethod
    def _get_resume_offset(events: list[PublishedEvent], agent_id: str) -> int:
        """Find highest source_offset for nested events from this agent."""

        max_offset = 0

        for event in events:
            if event.parent_tool_use_id and event.source_offset:
                if agent_id in str(event.source_file or ""):
                    max_offset = max(max_offset, event.source_offset)

        return max_offset
