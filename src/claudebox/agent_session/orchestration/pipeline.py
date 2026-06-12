"""Event pipeline - SDK messages to persisted, broadcast events."""

import asyncio
import dataclasses
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from .async_tasks import AsyncTaskManager
from .conversion import agent_event_to_events, to_published_event
from .models import Event, EventSubtype, EventType, PublishedEvent
from .persistence import EventLog
from .turn_tracker import TurnTracker
from ..events import AgentEvent, SystemInitPayload, UserMessagePayload
from ..protocol import AgentSession
from ...core.logging import get_logger
from ...workspace import Workspace


class OnInit(Protocol):
    """Callback invoked when the pipeline discovers the session ID."""

    async def __call__(self, session_id: str) -> None: ...


class OnEvent(Protocol):
    """Callback invoked for each published event."""

    async def __call__(self, event: PublishedEvent) -> None: ...


class EventPipeline:
    """Pipeline: SDK message -> enriched, persisted, broadcast PublishedEvent."""

    def __init__(
        self,
        sdk_client: AgentSession,
        workspace: Workspace,
        on_init: OnInit,
        on_event: OnEvent,
        resume_session_id: str | None = None,
    ):
        self._logger = get_logger(__name__)

        self._sdk_client = sdk_client
        self._workspace = workspace
        self._on_init = on_init
        self._on_event = on_event
        self._resume_session_id = resume_session_id

        # State
        self._session_id: str | None = None
        self._event_counter = 0
        self._turn_tracker = TurnTracker()

        # Historical events from resumed session (for replay only, not re-persisted)
        self._historical_events: list[PublishedEvent] = []

        # Buffering before session_id available
        self._buffer: list[PublishedEvent] = []
        self._initialized = False

        # Persistence
        self._event_log: EventLog | None = None

        # Lifecycle
        self._running = False
        self._task: asyncio.Task | None = None

        # Async task monitoring
        self._async_task_manager = AsyncTaskManager(on_event=self._process_nested_event)

        # Prompt for result-only turn detection (set by session before each query)
        self._prompt: str | None = None

        # Suppress next SDK user echo (set by session before attachment queries)
        self._suppress_user_echo = False

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def turn_tracker(self) -> TurnTracker:
        """The turn tracker - exposes is_compacting for fallback emitters."""

        return self._turn_tracker

    # Pipeline API
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Start background task that processes SDK messages, reattaching monitors if resuming."""

        if self._resume_session_id:
            await self._initialize(session_id=self._resume_session_id)
            self._async_task_manager.reattach(self._historical_events)

        self._running = True
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Cancel background task, stop monitors, and close files."""

        self._running = False
        self._async_task_manager.stop_all()

        if self._task:
            self._task.cancel()

            try:
                await self._task
            except asyncio.CancelledError:
                pass
            finally:
                self._task = None

        await self._close_files()

    def get_events(self) -> list[PublishedEvent]:
        """Return persisted events or buffered events if not yet initialized."""

        return list(self._event_log.read_all()) if self._initialized else list(self._buffer)  # ty: ignore[unresolved-attribute]

    def get_historical_events(self) -> Sequence[PublishedEvent]:
        """Return events that existed on disk before this pipeline run."""

        return self._historical_events

    def set_prompt(self, prompt: str | None) -> None:
        """Store the user prompt for result-only turn detection."""

        self._prompt = prompt

    def suppress_next_user_echo(self) -> None:
        """Signal that the next SDK user message echo should be suppressed.

        Called by session.send() after injecting a synthetic user event for
        attachment messages. One-shot: clears itself after suppressing one message.
        """

        self._suppress_user_echo = True

    # Event injection
    # ----------------------------------------------------------------------------------------------

    async def inject_event(
        self,
        event_type: str,
        subtype: str,
        content: str | None = None,
        *,
        is_human: bool = False,
        primary: bool = False,
        turn_id: str | None = None,
        attachments: list[dict] | None = None,
        **kwargs,
    ) -> None:
        """Inject a synthetic event into the pipeline."""

        turn_id = self._turn_tracker.on_inject(subtype, is_human, turn_id)

        self._event_counter += 1
        event = PublishedEvent(
            type=event_type,
            subtype=subtype,
            content=content,
            primary=primary,
            is_human=is_human,
            raw={},
            id=f"evt_{self._event_counter:09d}",
            ts=datetime.now(UTC),
            turn_id=turn_id,
            attachments=attachments,
            **kwargs,
        )
        await self._process_event(event)

    # Event processing
    # ----------------------------------------------------------------------------------------------

    async def _run(self) -> None:
        """Main loop: read SDK messages, enrich, persist, broadcast.

        Tracks the user event per response cycle and assistant emission per turn.
        When a result arrives for a turn that produced no assistant event (e.g.,
        unknown slash command), injects synthetic user and assistant events to
        surface the SDK's response content. Turn-scoped assistant tracking keeps a
        trailing result after a mid-response crash-restart from duplicating the
        already-emitted message.
        """

        await self._sdk_client.ready.wait()

        while self._running:
            self._logger.debug("Waiting for SDK messages...")

            try:
                saw_user_event = False

                async for agent_event in self._sdk_client.receive_events():
                    self._logger.debug("Received agent event", kind=agent_event.kind)

                    if not self._running:
                        break

                    if agent_event.kind == "system_init":
                        await self._initialize(agent_event=agent_event)

                    # Suppress SDK echo of user message when synthetic injection
                    # is canonical (e.g., attachments). Must go before turn_tracker
                    # and conversion to prevent spurious turn state updates.
                    # The tool_use_result guard ensures we only suppress human-typed
                    # messages, not tool result messages which share the user kind.
                    if (
                        self._suppress_user_echo
                        and isinstance(agent_event.payload, UserMessagePayload)
                        and agent_event.payload.tool_use_result is None
                    ):
                        self._suppress_user_echo = False
                        self._logger.debug("Suppressed SDK echo of attachment user message")
                        continue

                    self._turn_tracker.on_event(agent_event)

                    for event in agent_event_to_events(agent_event):
                        self._event_counter += 1

                        published = to_published_event(
                            event,
                            id_=f"evt_{self._event_counter:09d}",
                            ts=datetime.now(UTC),
                            turn_id=self._turn_tracker.resolve(event),  # ty: ignore[invalid-argument-type]
                        )

                        await self._enrich_edit_line_offset(published)
                        self._enrich_init_capabilities(published)

                        # User echo is per-cycle; assistant emission is turn-scoped
                        # (via TurnTracker) so a crash-restart's trailing result is
                        # not mistaken for a result-only turn.
                        if published.type == "user" and published.is_human:
                            saw_user_event = True
                        elif published.type == "assistant":
                            self._turn_tracker.mark_assistant_emitted(published.turn_id)

                        # Result-only turn: SDK returned a result without any
                        # assistant response (e.g., unknown slash command).
                        # Inject synthetic events so the turn is visible.
                        if (
                            published.type == "result"
                            and not self._turn_tracker.has_assistant_emitted(published.turn_id)
                            and published.content
                        ):
                            await self._surface_result_only_turn(published, saw_user_event)

                        if published.subtype == "task_notification":
                            self._async_task_manager.enrich_notification(published)

                        await self._process_event(published)
                        self._async_task_manager.check_event(published)
            except Exception as exc:
                self._logger.exception("Pipeline error")

                # Unstick frontend compaction state before surfacing the error,
                # so the next pending Turn renders the regular Working spinner
                # rather than the Compacting indicator.
                if self._turn_tracker.is_compacting:
                    await self.inject_event(
                        event_type=EventType.SYSTEM,
                        subtype=EventSubtype.COMPACT_BOUNDARY,
                        message_data={"compact_metadata": {"status": "error"}},
                    )

                await self.inject_event(
                    event_type=EventType.SYSTEM,
                    subtype=EventSubtype.ERROR,
                    content=f"Message failed to process: {exc}",
                )
            finally:
                self._prompt = None

    async def _initialize(
        self,
        *,
        agent_event: AgentEvent | None = None,
        session_id: str | None = None,
    ) -> None:
        """Extract session_id, setup storage, flush buffered events."""

        if self._initialized:
            return

        if agent_event is not None:
            assert isinstance(agent_event.payload, SystemInitPayload)
            self._session_id = agent_event.payload.session_id
        else:
            self._session_id = session_id

        assert self._session_id is not None, (
            "_initialize requires system_init AgentEvent or explicit session_id"
        )

        self._event_log = EventLog(session_id=self._session_id, workspace=self._workspace)
        self._historical_events = list(self._event_log.read_all())
        await self._event_log.open()

        await self._on_init(self._session_id)

        self._initialized = True
        self._logger.info("Session initialized", session_id=self._session_id)

        # Now that we have session_id, persist events that arrived before init
        for event in self._buffer:
            await self._process_event(event)

        self._buffer.clear()

    async def _process_event(self, event: PublishedEvent) -> None:
        """Persist event and notify callback, or buffer if not yet initialized."""

        if not self._initialized:
            self._buffer.append(event)

            return

        await self._event_log.append(event)  # ty: ignore[unresolved-attribute]
        await self._on_event(event)

    async def _process_nested_event(
        self,
        event: Event,
        parent_tool_use_id: str,
        source_file: str,
        source_offset: int,
    ) -> None:
        """Process an event from async task monitor with source tracking."""

        self._event_counter += 1
        published = to_published_event(
            event,
            id_=f"evt_{self._event_counter:09d}",
            ts=datetime.now(UTC),
            turn_id=self._turn_tracker.current,  # ty: ignore[invalid-argument-type]
            parent_tool_use_id=parent_tool_use_id,
            source_file=source_file,
            source_offset=source_offset,
        )
        await self._process_event(published)

    def _enrich_init_capabilities(self, event: PublishedEvent) -> None:
        """Attach capabilities + runtime_name to system_init events for race-free initial render."""

        if event.type != EventType.SYSTEM or event.subtype != EventSubtype.INIT:
            return

        event.capabilities = dataclasses.asdict(self._sdk_client.capabilities)
        event.runtime_name = self._sdk_client.runtime_name

    @staticmethod
    async def _enrich_edit_line_offset(event: PublishedEvent) -> None:
        """Set source_offset on Edit tool_use events to the 1-based line number of old_string."""

        if event.subtype != "tool_use" or event.content != "Edit":
            return

        inp = event.tool_input

        if not inp or not inp.get("file_path") or not inp.get("old_string"):
            return

        try:
            content = await asyncio.to_thread(Path(inp["file_path"]).read_text, encoding="utf-8")
            idx = content.find(inp["old_string"])

            if idx >= 0:
                event.source_offset = content[:idx].count("\n") + 1
        except Exception:
            pass

    async def _surface_result_only_turn(
        self,
        result_event: PublishedEvent,
        saw_user_event: bool,
    ) -> None:
        """Inject synthetic events for a result-only turn so it becomes visible.

        When the SDK returns a result without emitting any assistant events (e.g.,
        unknown slash command), the frontend would show nothing because result events
        are hidden. This injects a synthetic user message (if needed) and assistant
        text to surface the SDK's response, then overrides the result subtype to
        "error" for red border styling.
        """

        if not saw_user_event and self._prompt:
            await self.inject_event(
                event_type=EventType.USER,
                subtype=EventSubtype.MESSAGE,
                content=self._prompt,
                is_human=True,
                primary=True,
            )

        await self.inject_event(
            event_type=EventType.ASSISTANT,
            subtype=EventSubtype.TEXT,
            content=result_event.content,
            primary=True,
        )

        result_event.subtype = "error"

    # Disposal
    # ----------------------------------------------------------------------------------------------

    async def _close_files(self) -> None:
        """Stop task monitoring and close event log file handle."""

        self._async_task_manager.stop_all()

        if self._event_log:
            await self._event_log.close()
            self._event_log = None
