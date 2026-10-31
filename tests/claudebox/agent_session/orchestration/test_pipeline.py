"""Tests for claudebox.agent_session.orchestration.pipeline - result-only turn and echo suppression."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from claude_agent_sdk import UserMessage

from claudebox.agent_session.events import (
    AgentEvent,
    AssistantMessagePayload,
    CompactBoundaryPayload,
    ResultPayload,
    TaskNotificationPayload,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessagePayload,
)
from claudebox.agent_session.orchestration.models import Event, PublishedEvent
from claudebox.agent_session.orchestration.pipeline import EventPipeline
from claudebox.agent_session.orchestration.trace import TraceClient


# --- Helpers ---


def _make_pipeline() -> EventPipeline:
    """Create a pipeline with mocked dependencies for unit testing."""

    pipeline = EventPipeline(
        sdk_client=MagicMock(),
        workspace=MagicMock(),
        on_init=AsyncMock(),
        on_event=AsyncMock(),
    )
    # A bare MagicMock auto-vivifies connect_error as a (truthy) mock, not the real default -
    # set it explicitly so _run() doesn't treat every mocked client as a failed connect.
    pipeline._sdk_client.connect_error = None  # ty: ignore[unresolved-attribute]
    # Bypass initialization gate so injected events go through _process_event
    pipeline._initialized = True
    pipeline._event_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())

    return pipeline


def _make_result_event(content: str = "Unknown skill: reveiw") -> PublishedEvent:
    """Create a result event simulating an unknown command response."""

    return PublishedEvent(
        type="result",
        subtype="success",
        content=content,
        primary=False,
        is_human=False,
        raw={},
        id="evt_000000001",
        ts=datetime(2026, 3, 7, 12, 0, 0, tzinfo=UTC),
        turn_id="t1",
    )


# --- set_prompt ---


class TestSetPrompt:
    """Test prompt storage for result-only turn detection."""

    def test_stores_prompt(self):
        pipeline = _make_pipeline()
        pipeline.set_prompt("/reveiw everything")
        assert pipeline._prompt == "/reveiw everything"

    def test_clears_prompt(self):
        pipeline = _make_pipeline()
        pipeline.set_prompt("/reveiw everything")
        pipeline.set_prompt(None)
        assert pipeline._prompt is None


# --- _surface_result_only_turn ---


class TestSurfaceResultOnlyTurn:
    """A result-only turn's text shows as the reply, and the result is marked failed."""

    @pytest.mark.anyio
    async def test_injects_the_result_text_as_the_reply_and_marks_the_result_failed(self):
        pipeline = _make_pipeline()
        result_event = _make_result_event()

        with patch.object(pipeline, "inject_event", wraps=pipeline.inject_event) as spy:
            await pipeline._surface_result_only_turn(result_event)

        assert [(c.kwargs["event_type"], c.kwargs["content"]) for c in spy.call_args_list] == [
            ("assistant", "Unknown skill: reveiw"),
        ]
        assert spy.call_args_list[0].kwargs["primary"] is True
        assert result_event.subtype == "error"


# --- suppress_user_echo ---


class TestSuppressUserEcho:
    """Test SDK echo suppression for synthetic user messages."""

    def test_arms_a_pending_suppression(self):
        pipeline = _make_pipeline()
        pipeline.suppress_user_echo("U1")
        assert pipeline._pending_echo_uuids == {"U1"}

    def test_no_pending_suppressions_by_default(self):
        pipeline = _make_pipeline()
        assert pipeline._pending_echo_uuids == set()


# --- Echo suppression ordering in _run() ---


def _sdk_result(session_id: str = "s1"):
    from claude_agent_sdk import ResultMessage

    return ResultMessage(
        subtype="success",
        duration_ms=1,
        duration_api_ms=1,
        is_error=False,
        num_turns=1,
        session_id=session_id,
        result="done",
    )


class TestEchoSuppressionInRun:
    """Test that _run() drops exactly the echoes carrying an armed message uuid."""

    @staticmethod
    def _patch_pipeline_for_run(pipeline, messages):
        """Make ``receive_events`` yield *messages* once, then stop the loop - a stop, not a stream
        ending without a result, which the pipeline would report as lost.
        """

        from claudebox.agent_session.runtime_claude import ClaudeRuntime

        async def _fake_receive():
            for m in messages:
                yield ClaudeRuntime._translate_sdk_message(m)

            pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = _fake_receive

    @staticmethod
    def _forwarded_types(pipeline):
        return [call.args[0].type for call in pipeline._on_event.call_args_list]

    @pytest.mark.anyio
    async def test_an_echo_with_the_armed_uuid_is_dropped_whatever_its_text(self):
        """The CLI echoes every content block, a text file's contents included."""

        from claude_agent_sdk.types import TextBlock

        pipeline = _make_pipeline()
        echo = UserMessage(
            [TextBlock(text="please review"), TextBlock(text="[File: notes.txt]\nline one")],
            uuid="U1",
        )
        self._patch_pipeline_for_run(pipeline, [echo])
        pipeline.suppress_user_echo("U1")

        await pipeline._run()

        pipeline._on_event.assert_not_called()  # ty: ignore[unresolved-attribute]
        assert pipeline._pending_echo_uuids == set()

    @pytest.mark.anyio
    async def test_an_echo_with_another_uuid_passes(self):
        pipeline = _make_pipeline()
        self._patch_pipeline_for_run(pipeline, [UserMessage("an ordinary message", uuid="U2")])
        pipeline.suppress_user_echo("U1")

        await pipeline._run()

        assert "user" in self._forwarded_types(pipeline)
        assert pipeline._pending_echo_uuids == {"U1"}

    @pytest.mark.anyio
    @pytest.mark.parametrize("order", [("U1", "U2"), ("U2", "U1")])
    async def test_two_armed_uuids_each_drop_their_own_echo_in_either_order(self, order):
        pipeline = _make_pipeline()
        echoes = [UserMessage(f"text of {u}", uuid=u) for u in order]
        self._patch_pipeline_for_run(pipeline, echoes)
        pipeline.suppress_user_echo("U1")
        pipeline.suppress_user_echo("U2")

        await pipeline._run()

        pipeline._on_event.assert_not_called()  # ty: ignore[unresolved-attribute]
        assert pipeline._pending_echo_uuids == set()

    @pytest.mark.anyio
    async def test_non_user_event_unaffected_by_pending_suppression(self):
        """An assistant message is forwarded even with a suppression still pending."""

        from claude_agent_sdk import AssistantMessage
        from claude_agent_sdk.types import TextBlock

        pipeline = _make_pipeline()
        assistant_msg = AssistantMessage(
            content=[TextBlock(text="I can help with that.")],
            model="claude-sonnet",
        )
        self._patch_pipeline_for_run(pipeline, [assistant_msg])
        pipeline.suppress_user_echo("U1")

        await pipeline._run()

        assert "assistant" in self._forwarded_types(pipeline)
        assert pipeline._pending_echo_uuids == {"U1"}

    @pytest.mark.anyio
    async def test_tool_use_result_not_suppressed(self):
        """A UserMessage with tool_use_result is never suppressed, even under an armed uuid."""

        pipeline = _make_pipeline()
        tool_result_msg = UserMessage(
            "result",
            uuid="U1",
            tool_use_result={"tool_use_id": "tu_1", "content": "result"},
        )
        self._patch_pipeline_for_run(pipeline, [tool_result_msg])
        pipeline.suppress_user_echo("U1")

        await pipeline._run()

        assert pipeline._on_event.call_count >= 1  # ty: ignore[unresolved-attribute]
        assert pipeline._pending_echo_uuids == {"U1"}

    @pytest.mark.anyio
    async def test_expire_pending_echo_suppressions_clears_everything(self):
        """interrupt() calls this - its echoes will now never arrive."""

        pipeline = _make_pipeline()
        pipeline.suppress_user_echo("U1")
        pipeline.suppress_user_echo("U2")

        pipeline.expire_pending_echo_suppressions()

        assert pipeline._pending_echo_uuids == set()

    @pytest.mark.anyio
    async def test_a_result_expires_its_own_turns_uuid_and_leaves_another_armed(self):
        """The runtime answers U1 without echoing it; U2, still in flight, stays armed."""

        pipeline = _make_pipeline()
        pipeline.suppress_user_echo("U1")
        pipeline.suppress_user_echo("U2")
        pipeline._turn_tracker._current = "U1"
        self._patch_pipeline_for_run(pipeline, [_sdk_result()])

        await pipeline._run()

        assert pipeline._pending_echo_uuids == {"U2"}


# --- _run() on a runtime that never connected ---


class TestRunOnConnectFailure:
    """A connect_error on the sdk_client must end _run() before it ever reads a message."""

    @pytest.mark.anyio
    async def test_never_calls_receive_events(self):
        pipeline = _make_pipeline()
        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.connect_error = "agent process would not start"  # ty: ignore[unresolved-attribute]
        pipeline._sdk_client.receive_events = MagicMock(  # ty: ignore[invalid-assignment]
            side_effect=AssertionError("receive_events must not be called"),
        )

        # A regression here (the connect_error check dropped from _run()) would otherwise spin
        # this mock forever - bound it so the failure is a fast, clean timeout, not a CI hang.
        await asyncio.wait_for(pipeline._run(), timeout=2.0)

        pipeline._sdk_client.receive_events.assert_not_called()

    @pytest.mark.anyio
    async def test_stops_running_so_is_alive_reports_false(self):
        pipeline = _make_pipeline()
        pipeline._running = True
        pipeline._task = asyncio.create_task(asyncio.sleep(0))
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.connect_error = "agent process would not start"  # ty: ignore[unresolved-attribute]

        await pipeline._run()

        assert pipeline._running is False


# --- Prompt cleanup on error ---


class TestPromptCleanupOnError:
    """Test that _prompt state is managed correctly when pipeline errors occur."""

    @pytest.mark.anyio
    async def test_prompt_cleared_after_error(self):
        """Prompt is cleared in finally block even when _run() catches an exception."""

        pipeline = _make_pipeline()
        pipeline.set_prompt("test prompt")

        call_count = 0

        async def _error_then_stop():
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                raise RuntimeError("SDK error")

            pipeline._running = False

            raise RuntimeError("SDK error 2")
            yield  # unreachable - makes this an async generator for async for

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _error_then_stop
        )
        pipeline.inject_event = AsyncMock()

        await pipeline._run()

        assert pipeline._prompt is None


# --- Compact boundary fallback on pipeline error ---


class TestCompactBoundaryFallbackOnError:
    """Test that _run() emits compact_boundary if the loop errors mid-compaction."""

    @pytest.mark.anyio
    async def test_emits_boundary_when_compacting(self):
        """A loop error while compacting injects a synthetic compact_boundary
        before the error event, so the frontend still clears its compaction state."""

        pipeline = _make_pipeline()
        pipeline._turn_tracker = MagicMock(is_compacting=True)

        call_count = 0

        async def _error_then_stop():
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                raise RuntimeError("mid-compaction failure")

            pipeline._running = False

            return
            yield  # unreachable - keeps this an async generator

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _error_then_stop
        )
        pipeline.inject_event = AsyncMock()

        await pipeline._run()

        injected = [c.kwargs for c in pipeline.inject_event.await_args_list]
        assert injected[0]["subtype"] == "compact_boundary"
        assert injected[0]["message_data"]["compact_metadata"]["status"] == "error"
        assert injected[1]["subtype"] == "error"

    @pytest.mark.anyio
    async def test_no_boundary_when_not_compacting(self):
        """When no compaction is in flight, only the system/error event is emitted."""

        pipeline = _make_pipeline()
        pipeline._turn_tracker = MagicMock(is_compacting=False)

        call_count = 0

        async def _error_then_stop():
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                raise RuntimeError("post-turn failure")

            pipeline._running = False

            return
            yield  # unreachable

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _error_then_stop
        )
        pipeline.inject_event = AsyncMock()

        await pipeline._run()

        injected = [c.kwargs for c in pipeline.inject_event.await_args_list]
        assert all(c["subtype"] != "compact_boundary" for c in injected)
        assert any(c["subtype"] == "error" for c in injected)


# --- Compact boundary normal path (translated SDK boundary) ---


class TestCompactBoundaryNormalPath:
    """A translated compact_boundary flows through _run once and clears is_compacting."""

    @pytest.mark.anyio
    async def test_boundary_published_once_and_clears_compacting(self):
        pipeline = _make_pipeline()

        # Seed a compaction in flight through the real turn tracker.
        pipeline._turn_tracker.on_event(
            AgentEvent(kind="user_message", payload=UserMessagePayload(uuid="t1", content="")),
        )
        pipeline._turn_tracker.on_inject(subtype="compact_start", is_human=False, turn_id=None)
        assert pipeline._turn_tracker.is_compacting is True

        boundary = AgentEvent(
            kind="compact_boundary",
            payload=CompactBoundaryPayload(trigger="context_limit", pre_tokens=128000),
        )

        async def _yield_boundary_then_stop():
            yield boundary
            pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _yield_boundary_then_stop
        )

        await pipeline._run()

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        boundaries = [e for e in published if e.subtype == "compact_boundary"]
        assert len(boundaries) == 1
        assert boundaries[0].message_data == {
            "compact_metadata": {"trigger": "context_limit", "pre_tokens": 128000},
        }
        assert pipeline._turn_tracker.is_compacting is False


class TestTaskNotificationNormalPath:
    """A translated task_notification flows through _run and publishes a system event with message_data."""

    @pytest.mark.anyio
    async def test_notification_published_with_message_data(self):
        pipeline = _make_pipeline()

        notification = AgentEvent(
            kind="task_notification",
            payload=TaskNotificationPayload(
                task_id="agent_abc",
                status="completed",
                summary="Done",
            ),
        )

        async def _yield_notification_then_stop():
            yield notification
            pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _yield_notification_then_stop
        )

        await pipeline._run()

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        notifs = [e for e in published if e.subtype == "task_notification"]
        assert len(notifs) == 1
        assert notifs[0].message_data == {
            "task_id": "agent_abc",
            "status": "completed",
            "summary": "Done",
        }


# --- turn_tracker property ---


class TestTurnTrackerProperty:
    """Test the public turn_tracker property exposes the underlying tracker."""

    def test_returns_tracker_instance(self):
        pipeline = _make_pipeline()
        assert pipeline.turn_tracker is pipeline._turn_tracker


# --- Edit line offset enrichment ---


class TestEnrichEditLineOffset:
    """Test that _enrich_edit_line_offset sets source_offset for Edit tool_use events."""

    @pytest.mark.anyio
    async def test_sets_line_offset_when_old_string_found(self, tmp_path):
        """source_offset set to 1-based line number of old_string match."""

        target = tmp_path / "example.py"
        target.write_text("line1\nline2\nold_value\nline4\n")

        pipeline = _make_pipeline()
        event = PublishedEvent(
            type="assistant",
            subtype="tool_use",
            content="Edit",
            primary=False,
            is_human=False,
            raw={},
            id="evt_000000001",
            ts=datetime(2026, 3, 7, 12, 0, 0, tzinfo=UTC),
            turn_id="t1",
            tool_input={"file_path": str(target), "old_string": "old_value", "new_string": "new"},
        )

        await pipeline._enrich_edit_line_offset(event)
        assert event.source_offset == 3

    @pytest.mark.anyio
    async def test_none_when_file_not_found(self):
        """source_offset stays None when file doesn't exist."""

        pipeline = _make_pipeline()
        event = PublishedEvent(
            type="assistant",
            subtype="tool_use",
            content="Edit",
            primary=False,
            is_human=False,
            raw={},
            id="evt_000000001",
            ts=datetime(2026, 3, 7, 12, 0, 0, tzinfo=UTC),
            turn_id="t1",
            tool_input={
                "file_path": "/nonexistent/file.py",
                "old_string": "x",
                "new_string": "y",
            },
        )

        await pipeline._enrich_edit_line_offset(event)
        assert event.source_offset is None

    @pytest.mark.anyio
    async def test_skips_non_edit_events(self):
        """Non-Edit tool_use events are not enriched."""

        pipeline = _make_pipeline()
        event = PublishedEvent(
            type="assistant",
            subtype="tool_use",
            content="Read",
            primary=False,
            is_human=False,
            raw={},
            id="evt_000000001",
            ts=datetime(2026, 3, 7, 12, 0, 0, tzinfo=UTC),
            turn_id="t1",
            tool_input={"file_path": "/some/file.py"},
        )

        await pipeline._enrich_edit_line_offset(event)
        assert event.source_offset is None


# --- Bash command layout enrichment ---


class TestEnrichBashLayout:
    """A Bash call's tool_use carries its laid-out command, from the loop and from a subagent."""

    @staticmethod
    def _call(name: str, tool_input: dict) -> AgentEvent:
        block = ToolUseBlock(id="tu_1", name=name, input=tool_input)

        return AgentEvent(
            kind="assistant_message",
            payload=AssistantMessagePayload(uuid=None, content=[block]),
        )

    @staticmethod
    async def _publish(pipeline, call: AgentEvent) -> PublishedEvent:
        async def _fake_receive():
            yield call

            pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = _fake_receive

        await pipeline._run()

        (published,) = [c.args[0] for c in pipeline._on_event.call_args_list]

        return published

    @pytest.mark.anyio
    @pytest.mark.parametrize("name", ["Bash", "bash"])
    async def test_a_call_from_either_runtime_carries_its_layout(self, name):
        published = await self._publish(
            _make_pipeline(),
            self._call(name, {"command": "cd /srv; ls"}),
        )

        assert published.command_layout == "cd /srv\nls"
        assert published.tool_input == {"command": "cd /srv; ls"}

    @pytest.mark.anyio
    async def test_a_command_that_reads_the_same_carries_none(self):
        published = await self._publish(_make_pipeline(), self._call("Bash", {"command": "ls -la"}))

        assert published.command_layout is None

    @pytest.mark.anyio
    async def test_another_tool_carries_none(self):
        published = await self._publish(_make_pipeline(), self._call("Read", {"command": "a; b"}))

        assert published.command_layout is None

    @pytest.mark.anyio
    async def test_a_layout_failure_still_publishes_the_call(self):
        pipeline = _make_pipeline()

        with patch(
            "claudebox.agent_session.orchestration.pipeline.layout_bash_command",
            side_effect=RecursionError("too deep"),
        ):
            published = await self._publish(pipeline, self._call("Bash", {"command": "a; b"}))

        assert published.command_layout is None
        assert published.tool_input == {"command": "a; b"}

    @pytest.mark.anyio
    async def test_a_subagent_call_carries_its_layout(self):
        pipeline = _make_pipeline()
        block = {"type": "tool_use", "id": "tu_9", "name": "Bash", "input": {"command": "a; b"}}
        event = Event(
            type="assistant",
            subtype="tool_use",
            content="Bash",
            primary=False,
            is_human=False,
            raw={"block": block},
        )

        await pipeline._process_nested_event(event, "task_1", "agent.jsonl", 0)

        (published,) = [c.args[0] for c in pipeline._on_event.call_args_list]  # ty: ignore[unresolved-attribute]
        assert published.command_layout == "a\nb"


class TestEnrichBashReadOnly:
    """A Bash call whose command changes nothing is marked, from the loop and from a subagent."""

    @pytest.mark.anyio
    @pytest.mark.parametrize("name", ["Bash", "bash"])
    async def test_a_call_from_either_runtime_that_changes_nothing_is_marked(self, name):
        call = TestEnrichBashLayout._call(name, {"command": "ls -a; echo done"})
        published = await TestEnrichBashLayout._publish(_make_pipeline(), call)

        assert published.command_read_only is True

    @pytest.mark.anyio
    @pytest.mark.parametrize("command", ["echo x > notes.txt", "git status", None])
    async def test_a_call_that_changes_something_carries_none(self, command):
        call = TestEnrichBashLayout._call("Bash", {"command": command})
        published = await TestEnrichBashLayout._publish(_make_pipeline(), call)

        assert published.command_read_only is None

    @pytest.mark.anyio
    async def test_another_tool_carries_none(self):
        call = TestEnrichBashLayout._call("Read", {"command": "ls"})
        published = await TestEnrichBashLayout._publish(_make_pipeline(), call)

        assert published.command_read_only is None

    @pytest.mark.anyio
    async def test_a_foreground_subagent_call_is_marked(self):
        block = ToolUseBlock(id="tu_2", name="Bash", input={"command": "cat notes.txt"})
        call = AgentEvent(
            kind="assistant_message",
            payload=AssistantMessagePayload(
                uuid=None,
                content=[block],
                parent_tool_use_id="task_1",
            ),
        )
        published = await TestEnrichBashLayout._publish(_make_pipeline(), call)

        assert published.parent_tool_use_id == "task_1"
        assert published.command_read_only is True

    @pytest.mark.anyio
    async def test_a_background_subagent_call_is_marked(self):
        pipeline = _make_pipeline()
        block = {"type": "tool_use", "id": "tu_9", "name": "Bash", "input": {"command": "ls"}}
        event = Event(
            type="assistant",
            subtype="tool_use",
            content="Bash",
            primary=False,
            is_human=False,
            raw={"block": block},
        )

        await pipeline._process_nested_event(event, "task_1", "agent.jsonl", 0)

        (published,) = [c.args[0] for c in pipeline._on_event.call_args_list]  # ty: ignore[unresolved-attribute]
        assert published.command_read_only is True

    @pytest.mark.anyio
    async def test_a_failing_check_still_publishes_the_call(self):
        pipeline = _make_pipeline()

        with (
            patch(
                "claudebox.agent_session.orchestration.pipeline.is_read_only_command",
                side_effect=RecursionError("too deep"),
            ),
            patch("claudebox.agent_session.orchestration.pipeline.logger") as log,
        ):
            call = TestEnrichBashLayout._call("Bash", {"command": "ls"})
            published = await TestEnrichBashLayout._publish(pipeline, call)

        assert published.command_read_only is None
        assert published.tool_input == {"command": "ls"}
        log.warning.assert_called_once()


class TestEnrichBashTraced:
    """A Bash call is registered with the supervisor and its result carries what the call did."""

    COMMAND = "python3 -c 'print(1)'"

    @staticmethod
    def _call(name: str = "Bash", parent: str | None = None) -> AgentEvent:
        block = ToolUseBlock(id="tu_1", name=name, input={"command": TestEnrichBashTraced.COMMAND})

        return AgentEvent(
            kind="assistant_message",
            payload=AssistantMessagePayload(uuid=None, content=[block], parent_tool_use_id=parent),
        )

    @staticmethod
    def _result(parent: str | None = None) -> AgentEvent:
        return AgentEvent(
            kind="user_message",
            payload=UserMessagePayload(
                uuid="R1",
                content=[ToolResultBlock(tool_use_id="tu_1", content="1")],
                parent_tool_use_id=parent,
            ),
        )

    @staticmethod
    def _copy(subtype: str) -> PublishedEvent:
        return PublishedEvent(
            type="assistant" if subtype == "tool_use" else "user",
            subtype=subtype,
            content="Bash",
            primary=False,
            is_human=False,
            raw={},
            id="e1",
            ts=datetime(2026, 3, 7, 12, 0, 0, tzinfo=UTC),
            turn_id="t1",
            tool_use_id="tu_1",
            tool_input={"command": TestEnrichBashTraced.COMMAND},
        )

    @staticmethod
    async def _publish(pipeline, *events: AgentEvent) -> list[PublishedEvent]:
        async def _fake_receive():
            for event in events:
                yield event

            pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = _fake_receive

        await pipeline._run()

        return [c.args[0] for c in pipeline._on_event.call_args_list]

    @pytest.mark.anyio
    @pytest.mark.parametrize("name", ["Bash", "bash"])
    @pytest.mark.parametrize("changed", [True, False])
    async def test_the_result_carries_the_measured_verdict(self, name, changed):
        pipeline = _make_pipeline()
        pipeline._trace = trace = _FakeTrace({"tu_1": changed})

        call, result = await self._publish(pipeline, self._call(name), self._result())

        assert trace.registered == [("tu_1", self.COMMAND)]
        assert (call.command_changed, result.command_changed) == (None, changed)

    @pytest.mark.anyio
    async def test_an_unknown_verdict_leaves_the_result_unmarked(self):
        pipeline = _make_pipeline()
        pipeline._trace = trace = _FakeTrace({})

        _, result = await self._publish(pipeline, self._call(), self._result())

        assert trace.asked == ["tu_1"]
        assert result.command_changed is None

    @pytest.mark.anyio
    async def test_another_tools_call_is_neither_registered_nor_asked(self):
        pipeline = _make_pipeline()
        pipeline._trace = trace = _FakeTrace({"tu_1": False})

        _, result = await self._publish(pipeline, self._call("Read"), self._result())

        assert (trace.registered, trace.asked) == ([], [])
        assert result.command_changed is None

    @pytest.mark.anyio
    async def test_a_foreground_subagents_result_carries_its_verdict(self):
        pipeline = _make_pipeline()
        pipeline._trace = _FakeTrace({"tu_1": False})

        call, result = await self._publish(
            pipeline,
            self._call(parent="task_1"),
            self._result(parent="task_1"),
        )

        assert (call.parent_tool_use_id, result.parent_tool_use_id) == ("task_1", "task_1")
        assert result.command_changed is False

    @pytest.mark.anyio
    async def test_a_background_subagents_result_carries_its_verdict(self):
        pipeline = _make_pipeline()
        pipeline._trace = trace = _FakeTrace({"tu_9": True})
        call = {"type": "tool_use", "id": "tu_9", "name": "Bash", "input": {"command": "ls"}}
        result = {"type": "tool_result", "tool_use_id": "tu_9", "content": "a"}

        for subtype, block in (("tool_use", call), ("tool_result", result)):
            event = Event(
                type="assistant" if subtype == "tool_use" else "user",
                subtype=subtype,
                content="Bash" if subtype == "tool_use" else "a",
                primary=False,
                is_human=False,
                raw={"block": block},
            )
            await pipeline._process_nested_event(event, "task_1", "agent.jsonl", 0)

        published = [c.args[0] for c in pipeline._on_event.call_args_list]  # ty: ignore[unresolved-attribute]
        assert trace.registered == [("tu_9", "ls")]
        assert published[1].command_changed is True

    @pytest.mark.anyio
    async def test_every_copy_of_a_call_shares_one_registration_and_one_verdict(self):
        pipeline = _make_pipeline()
        pipeline._trace = trace = _FakeTrace({"tu_1": False})

        calls = [self._copy("tool_use"), self._copy("tool_use")]
        results = [self._copy("tool_result"), self._copy("tool_result")]

        for event in [*calls, *results]:
            await pipeline._enrich_bash_traced(event)

        assert (trace.registered, trace.asked) == ([("tu_1", self.COMMAND)], ["tu_1"])
        assert [r.command_changed for r in results] == [False, False]

    @pytest.mark.anyio
    async def test_a_verdict_waits_for_its_registration_still_in_flight(self):
        pipeline = _make_pipeline()
        gate = asyncio.Event()

        class GatedTrace(_FakeTrace):
            async def register_command(self, tool_use_id: str, command: str) -> None:
                await gate.wait()
                self.asked.append("register")

            async def verdict_for(self, tool_use_id: str) -> bool | None:
                self.asked.append("verdict")

                return True

        pipeline._trace = trace = GatedTrace({})
        call, result = self._copy("tool_use"), self._copy("tool_result")

        registering = asyncio.create_task(pipeline._enrich_bash_traced(call))
        stamping = asyncio.create_task(pipeline._enrich_bash_traced(result))
        await asyncio.sleep(0)
        gate.set()
        await asyncio.gather(registering, stamping)

        assert trace.asked == ["register", "verdict"]
        assert result.command_changed is True

    @pytest.mark.anyio
    async def test_a_failing_client_logs_and_both_events_still_publish(self):
        pipeline = _make_pipeline()
        pipeline._trace = _FakeTrace({}, error=RuntimeError("socket broke"))

        with patch("claudebox.agent_session.orchestration.pipeline.logger") as log:
            published = await self._publish(pipeline, self._call(), self._result())

        assert [e.subtype for e in published] == ["tool_use", "tool_result"]
        assert published[1].command_changed is None
        assert log.warning.call_count == 1


class _FakeTrace(TraceClient):
    def __init__(self, verdicts: dict[str, bool], error: Exception | None = None):
        self.registered: list[tuple[str, str]] = []
        self.asked: list[str] = []
        self._verdicts = verdicts
        self._error = error

    async def register_command(self, tool_use_id: str, command: str) -> None:
        if self._error:
            raise self._error

        self.registered.append((tool_use_id, command))

    async def verdict_for(self, tool_use_id: str) -> bool | None:
        self.asked.append(tool_use_id)

        return self._verdicts.get(tool_use_id)


MCP_STATUS = {
    "mcpServers": [
        {
            "name": "claude.ai Notes",
            "status": "connected",
            "tools": [
                {"name": "read", "annotations": {"readOnly": True}},
                {"name": "write", "annotations": {"readOnly": False}},
                {"name": "list"},
            ],
        },
        {"name": "pending-server", "status": "pending"},
    ],
}


class TestEnrichMcpReadOnly:
    """An MCP call its server declares read-only is marked, from the runtime's MCP status."""

    @staticmethod
    def _pipeline(status=None, *, delegation=True, error=None) -> EventPipeline:
        pipeline = _make_pipeline()
        client = cast(MagicMock, pipeline._sdk_client)
        client.capabilities.supports_mcp_delegation = delegation
        client.get_mcp_status = AsyncMock(return_value=status, side_effect=error)

        return pipeline

    @staticmethod
    async def _publish(pipeline, name: str) -> PublishedEvent:
        call = TestEnrichBashLayout._call(name, {})
        published = await TestEnrichBashLayout._publish(pipeline, call)
        cast(MagicMock, pipeline._on_event).reset_mock()

        return published

    @pytest.mark.anyio
    async def test_a_tool_its_server_declares_read_only_is_marked(self):
        published = await self._publish(self._pipeline(MCP_STATUS), "mcp__claude_ai_Notes__read")

        assert published.mcp_read_only is True

    @pytest.mark.anyio
    @pytest.mark.parametrize("name", ["mcp__claude_ai_Notes__write", "mcp__claude_ai_Notes__list"])
    async def test_a_tool_that_declares_nothing_carries_none(self, name):
        published = await self._publish(self._pipeline(MCP_STATUS), name)

        assert published.mcp_read_only is None

    @pytest.mark.anyio
    async def test_a_server_with_no_tools_yet_is_asked_about_once(self):
        pipeline = self._pipeline(MCP_STATUS)

        await self._publish(pipeline, "mcp__late__fetch")
        await self._publish(pipeline, "mcp__late__fetch")
        await self._publish(pipeline, "mcp__claude_ai_Notes__read")

        assert cast(MagicMock, pipeline._sdk_client).get_mcp_status.await_count == 1

    @pytest.mark.anyio
    async def test_a_runtime_without_mcp_delegation_is_never_asked(self):
        pipeline = self._pipeline(MCP_STATUS, delegation=False)
        published = await self._publish(pipeline, "mcp__claude_ai_Notes__read")

        assert published.mcp_read_only is None
        cast(MagicMock, pipeline._sdk_client).get_mcp_status.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_failed_status_read_still_publishes_the_call(self):
        pipeline = self._pipeline(error=RuntimeError("closed"))

        with patch("claudebox.agent_session.orchestration.pipeline.logger") as log:
            published = await self._publish(pipeline, "mcp__claude_ai_Notes__read")

        assert published.mcp_read_only is None
        log.warning.assert_called_once()

    @pytest.mark.anyio
    async def test_a_background_subagent_call_is_marked(self):
        pipeline = self._pipeline(MCP_STATUS)
        block = {
            "type": "tool_use",
            "id": "tu_9",
            "name": "mcp__claude_ai_Notes__read",
            "input": {},
        }
        event = Event(
            type="assistant",
            subtype="tool_use",
            content="mcp__claude_ai_Notes__read",
            primary=False,
            is_human=False,
            raw={"block": block},
        )

        await pipeline._process_nested_event(event, "task_1", "agent.jsonl", 0)

        (published,) = [c.args[0] for c in cast(MagicMock, pipeline._on_event).call_args_list]
        assert published.mcp_read_only is True

    def test_a_reconnect_status_replaces_what_is_known(self):
        pipeline = self._pipeline()
        pipeline.note_mcp_status(MCP_STATUS)
        pipeline.note_mcp_status({"mcpServers": []})

        assert pipeline._mcp_read_only_tools == set()


# --- Mid-stream crash-restart duplicate guard ---


class TestNoDuplicateOnMidStreamCrash:
    """A mid-turn crash-restart must not re-surface the turn's final assistant message."""

    @staticmethod
    def _patch_crash_restart(pipeline):
        """Yield user+assistant then raise mid-stream; yield the trailing result on restart."""

        call_count = 0

        async def _fake_receive():
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                yield AgentEvent(
                    kind="user_message",
                    payload=UserMessagePayload(uuid="t1", content="hi"),
                )
                yield AgentEvent(
                    kind="assistant_message",
                    payload=AssistantMessagePayload(uuid=None, content=[TextBlock(text="X")]),
                )

                raise ValueError("Unknown SDK message type: _StubMidStream")
            elif call_count == 2:
                yield AgentEvent(
                    kind="result",
                    payload=ResultPayload(subtype="success", result="X"),
                )
            else:
                pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = _fake_receive

    @staticmethod
    def _patch_result_only(pipeline, content):
        """Yield a single result event with no assistant - a genuine result-only turn."""

        call_count = 0

        async def _fake_receive():
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                yield AgentEvent(
                    kind="result",
                    payload=ResultPayload(subtype="success", result=content),
                )
            else:
                pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = _fake_receive

    @staticmethod
    def _assistant_texts(pipeline, content):
        calls = pipeline._on_event.call_args_list

        return [
            call.args[0]
            for call in calls
            if call.args[0].type == "assistant"
            and call.args[0].subtype == "text"
            and call.args[0].content == content
        ]

    @pytest.mark.anyio
    async def test_trailing_result_does_not_duplicate_assistant(self):
        """The turn already emitted 'X'; the post-crash result must not re-surface it."""

        pipeline = _make_pipeline()
        self._patch_crash_restart(pipeline)

        await pipeline._run()

        assert len(self._assistant_texts(pipeline, "X")) == 1

    @pytest.mark.anyio
    async def test_genuine_result_only_turn_still_surfaces(self):
        """A turn with no assistant event still injects the synthetic assistant message."""

        pipeline = _make_pipeline()
        pipeline.set_prompt("/unknowncmd")
        self._patch_result_only(pipeline, "Unknown command")

        await pipeline._run()

        assert len(self._assistant_texts(pipeline, "Unknown command")) == 1


class TestAgentReportedFailure:
    """A labelled failure shows once as the turn's failure, never again as text."""

    @pytest.mark.anyio
    async def test_failure_turn_is_not_surfaced_again_from_its_result(self):
        pipeline = _make_pipeline()
        pipeline.set_prompt("say hi")
        agent_text = "Not logged in · Please run /login"
        call_count = 0

        async def _fake_receive():
            nonlocal call_count
            call_count += 1

            if call_count == 1:
                yield AgentEvent(
                    kind="user_message",
                    payload=UserMessagePayload(uuid="t1", content="say hi"),
                )
                yield AgentEvent(
                    kind="assistant_message",
                    payload=AssistantMessagePayload(
                        uuid=None,
                        content=[TextBlock(text=agent_text)],
                        error="authentication_failed",
                    ),
                )
                yield AgentEvent(
                    kind="result",
                    payload=ResultPayload(subtype="success", result=agent_text, is_error=True),
                )
            else:
                pipeline._running = False

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = _fake_receive  # ty: ignore[invalid-assignment]

        await pipeline._run()

        published = [call.args[0] for call in pipeline._on_event.call_args_list]  # ty: ignore[unresolved-attribute]

        assert [(e.type, e.subtype) for e in published] == [
            ("user", "message"),
            ("system", "error"),
            ("result", "success"),
        ]
        assert not any(agent_text in (e.content or "") for e in published[:2])


def _tool_turn(*closing: AgentEvent) -> list[AgentEvent]:
    return [
        AgentEvent(
            kind="user_message",
            payload=UserMessagePayload(uuid="P1", content="run the migration"),
        ),
        AgentEvent(
            kind="assistant_message",
            payload=AssistantMessagePayload(
                uuid=None,
                content=[ToolUseBlock(id="tu_1", name="Bash", input={"command": "ls migrations/"})],
            ),
        ),
        AgentEvent(
            kind="user_message",
            payload=UserMessagePayload(
                uuid="R1",
                content=[ToolResultBlock(tool_use_id="tu_1", content="0007_add_index.py")],
                tool_use_result={"stdout": "0007_add_index.py"},
            ),
        ),
        *closing,
    ]


def _background_tool_result() -> AgentEvent:
    return AgentEvent(
        kind="user_message",
        payload=UserMessagePayload(
            uuid="N1",
            content=[ToolResultBlock(tool_use_id="tu_9", content="12 files")],
            parent_tool_use_id="tu_bg",
        ),
    )


class TestTurnIdentity:
    """Every event of a turn carries the id of the message the person sent to open it."""

    @staticmethod
    async def _run_turn(script: list[AgentEvent]) -> list[PublishedEvent]:
        pipeline, on_event, _ = _stream_pipeline(_FakeRuntime(script, None))

        await pipeline.start()

        async with asyncio.timeout(5):
            while not any(call.args[0].type == "result" for call in on_event.await_args_list):
                await asyncio.sleep(0.01)

        await pipeline.stop()

        return [call.args[0] for call in on_event.await_args_list]

    @pytest.mark.anyio
    async def test_a_closing_message_before_a_background_result_is_kept_once(self):
        answer = "Migration 0007 is pending."
        published = await self._run_turn(
            _tool_turn(
                AgentEvent(
                    kind="assistant_message",
                    payload=AssistantMessagePayload(uuid=None, content=[TextBlock(text=answer)]),
                ),
                _background_tool_result(),
                AgentEvent(kind="result", payload=ResultPayload(subtype="success", result=answer)),
            ),
        )

        (result,) = [e for e in published if e.type == "result"]

        assert {e.turn_id for e in published} == {"P1"}
        assert [e.content for e in published if e.type == "assistant"].count(answer) == 1
        assert result.subtype == "success"

    @pytest.mark.anyio
    async def test_a_failure_after_a_tool_call_is_recorded_against_the_persons_turn(self):
        published = await self._run_turn(
            _tool_turn(
                _background_tool_result(),
                AgentEvent(
                    kind="assistant_message",
                    payload=AssistantMessagePayload(
                        uuid=None,
                        content=[TextBlock(text="Not logged in · Please run /login")],
                        error="authentication_failed",
                    ),
                ),
                AgentEvent(
                    kind="result",
                    payload=ResultPayload(
                        subtype="success",
                        result="Not logged in · Please run /login",
                        is_error=True,
                    ),
                ),
            ),
        )

        failures = [e for e in published if e.type == "system" and e.subtype == "error"]

        assert [e.turn_id for e in failures] == ["P1"]
        assert [e.turn_id for e in published if e.type == "result"] == ["P1"]


# --- Nested event dedup (background Task, live stream vs tailed monitor) ---


def _make_nested_event(
    subtype: str,
    *,
    parent_tool_use_id: str = "task_1",
    tool_use_id: str | None = None,
    content: str | None = None,
    source_file: str | None = None,
    event_id: str = "evt_000000001",
) -> PublishedEvent:
    """A nested event under a background Task - `source_file` set marks a tailed copy, unset
    marks the live stream."""

    return PublishedEvent(
        type="assistant" if subtype != "tool_result" else "user",
        subtype=subtype,
        content=content,
        primary=True,
        is_human=False,
        raw={},
        id=event_id,
        ts=datetime(2026, 3, 7, 12, 0, 0, tzinfo=UTC),
        turn_id="t1",
        parent_tool_use_id=parent_tool_use_id,
        tool_use_id=tool_use_id,
        source_file=source_file,
    )


class TestNestedEventDedup:
    """A tailed copy of an already-published live nested event (or vice versa) is dropped;
    same-source repeats and events under different parents are not."""

    @pytest.mark.anyio
    async def test_tailed_copy_of_live_call_is_dropped(self):
        pipeline = _make_pipeline()
        live = _make_nested_event("tool_use", tool_use_id="tu_1", event_id="evt_000000001")
        tailed = _make_nested_event(
            "tool_use",
            tool_use_id="tu_1",
            source_file="agent.jsonl",
            event_id="evt_000000002",
        )

        await pipeline._process_event(live)
        await pipeline._process_event(tailed)

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        assert published == [live]

    @pytest.mark.anyio
    async def test_live_copy_arriving_second_is_also_dropped(self):
        """Symmetric: whichever source arrives first wins, live included."""

        pipeline = _make_pipeline()
        tailed = _make_nested_event(
            "tool_use",
            tool_use_id="tu_1",
            source_file="agent.jsonl",
            event_id="evt_000000001",
        )
        live = _make_nested_event("tool_use", tool_use_id="tu_1", event_id="evt_000000002")

        await pipeline._process_event(tailed)
        await pipeline._process_event(live)

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        assert published == [tailed]

    @pytest.mark.anyio
    async def test_a_call_and_its_own_result_both_persist(self):
        """Same tool_use_id, different subtype - the key must include subtype or a result would
        look like a duplicate of its own call."""

        pipeline = _make_pipeline()
        call = _make_nested_event("tool_use", tool_use_id="tu_1", event_id="evt_000000001")
        result = _make_nested_event(
            "tool_result",
            tool_use_id="tu_1",
            source_file="agent.jsonl",
            event_id="evt_000000002",
        )

        await pipeline._process_event(call)
        await pipeline._process_event(result)

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        assert published == [call, result]

    @pytest.mark.anyio
    async def test_repeated_live_narration_both_persist(self):
        """Two genuinely repeated lines from the SAME source are never deduped against each
        other - only a cross-source match is dropped."""

        pipeline = _make_pipeline()
        first = _make_nested_event("text", content="Checking files...", event_id="evt_000000001")
        second = _make_nested_event("text", content="Checking files...", event_id="evt_000000002")

        await pipeline._process_event(first)
        await pipeline._process_event(second)

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        assert published == [first, second]

    @pytest.mark.anyio
    async def test_tailed_copy_of_live_narration_is_dropped(self):
        pipeline = _make_pipeline()
        live = _make_nested_event("text", content="Checking files...", event_id="evt_000000001")
        tailed = _make_nested_event(
            "text",
            content="  Checking files...  ",
            source_file="agent.jsonl",
            event_id="evt_000000002",
        )

        await pipeline._process_event(live)
        await pipeline._process_event(tailed)

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        assert published == [live]

    @pytest.mark.anyio
    async def test_different_parents_are_never_deduped_against_each_other(self):
        pipeline = _make_pipeline()
        under_a = _make_nested_event(
            "tool_use",
            parent_tool_use_id="task_a",
            tool_use_id="tu_1",
            event_id="evt_000000001",
        )
        under_b = _make_nested_event(
            "tool_use",
            parent_tool_use_id="task_b",
            tool_use_id="tu_1",
            source_file="agent.jsonl",
            event_id="evt_000000002",
        )

        await pipeline._process_event(under_a)
        await pipeline._process_event(under_b)

        published = [c.args[0] for c in pipeline._on_event.await_args_list]  # ty: ignore[unresolved-attribute]
        assert published == [under_a, under_b]

    @pytest.mark.anyio
    async def test_seeds_from_historical_events_so_a_reattached_replay_is_dropped(self):
        """A session resuming with a live-only nested event already on disk must not republish it
        when the reattached monitor tails the same call for the first time post-restart."""

        historical_live = _make_nested_event(
            "tool_use",
            tool_use_id="tu_1",
            event_id="evt_000000001",
        )

        mock_log = MagicMock(
            read_all=MagicMock(return_value=[historical_live]),
            open=AsyncMock(),
            append=AsyncMock(),
        )
        pipeline = EventPipeline(
            sdk_client=MagicMock(),
            workspace=MagicMock(),
            on_init=AsyncMock(),
            on_event=AsyncMock(),
        )

        with patch(
            "claudebox.agent_session.orchestration.pipeline.EventLog",
            return_value=mock_log,
        ):
            await pipeline._initialize(session_id="s1")

        replay = _make_nested_event(
            "tool_use",
            tool_use_id="tu_1",
            source_file="agent.jsonl",
            event_id="evt_000000002",
        )
        await pipeline._process_event(replay)

        pipeline._on_event.assert_not_called()  # ty: ignore[unresolved-attribute]


# --- stream loss ---


class _FakeRuntime:
    """Runtime scripted per `receive_events()` call: None parks, a callable item runs in place."""

    def __init__(self, *scripts, connect_error=None) -> None:
        self.ready = asyncio.Event()
        self.ready.set()
        self.connect_error = connect_error
        self._scripts = list(scripts)

    async def receive_events(self):
        script = self._scripts.pop(0) if self._scripts else None

        if script is None:
            await asyncio.Event().wait()

            return

        for item in script:
            if isinstance(item, BaseException):
                raise item

            if callable(item):
                item()

                continue

            yield item


def _user_turn() -> AgentEvent:
    return AgentEvent(
        kind="user_message",
        payload=UserMessagePayload(uuid="u1", content="hello"),
    )


def _result() -> AgentEvent:
    return AgentEvent(kind="result", payload=ResultPayload(subtype="success", result="done"))


def _stream_pipeline(runtime: _FakeRuntime) -> tuple[EventPipeline, AsyncMock, MagicMock]:
    on_event = AsyncMock()
    on_stream_lost = MagicMock()
    pipeline = EventPipeline(
        sdk_client=runtime,  # ty: ignore[invalid-argument-type]
        workspace=MagicMock(),
        on_init=AsyncMock(),
        on_event=on_event,
        on_stream_lost=on_stream_lost,
    )
    pipeline._initialized = True
    pipeline._event_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())

    return pipeline, on_event, on_stream_lost


def _errors(on_event: AsyncMock) -> list[str]:
    events = [call.args[0] for call in on_event.await_args_list]

    return [e.content for e in events if e.type == "system" and e.subtype == "error"]


def _failure_turns(on_event: AsyncMock) -> list[str | None]:
    events = [call.args[0] for call in on_event.await_args_list]

    return [e.turn_id for e in events if e.type == "system" and e.subtype == "error"]


def _notification() -> AgentEvent:
    return AgentEvent(
        kind="task_notification",
        payload=TaskNotificationPayload(task_id="agent_1", status="completed", summary="Done"),
    )


def _text(text: str) -> AgentEvent:
    return AgentEvent(
        kind="assistant_message",
        payload=AssistantMessagePayload(uuid=None, content=[TextBlock(text=text)]),
    )


class TestStreamLoss:
    """A consumer that loses its stream reports it once, and the cut-off turn ends with one error."""

    @pytest.mark.anyio
    async def test_a_stream_ending_without_a_result_is_reported(self):
        pipeline, on_event, on_stream_lost = _stream_pipeline(_FakeRuntime([_user_turn()]))

        await pipeline.start()
        await _consumer_ended(pipeline)

        assert _errors(on_event) == ["The agent's connection ended before it answered"]
        on_stream_lost.assert_called_once_with()

    @pytest.mark.anyio
    async def test_a_turn_that_already_failed_gets_no_second_error(self):
        runtime = _FakeRuntime([_user_turn(), RuntimeError("cli exited 1")], [])
        pipeline, on_event, on_stream_lost = _stream_pipeline(runtime)

        await pipeline.start()
        await _consumer_ended(pipeline)

        assert _errors(on_event) == ["Message failed to process: cli exited 1"]
        on_stream_lost.assert_called_once_with()

    @pytest.mark.anyio
    async def test_a_turn_ending_on_its_result_reports_nothing(self):
        pipeline, on_event, on_stream_lost = _stream_pipeline(
            _FakeRuntime([_user_turn(), _result()], None),
        )

        await pipeline.start()
        await asyncio.sleep(0.05)
        await pipeline.stop()

        assert _errors(on_event) == []
        on_stream_lost.assert_not_called()

    @pytest.mark.anyio
    async def test_a_stopped_consumer_reports_nothing(self):
        pipeline, on_event, on_stream_lost = _stream_pipeline(_FakeRuntime(None))

        await pipeline.start()
        await asyncio.sleep(0)
        await pipeline.stop()

        assert _errors(on_event) == []
        on_stream_lost.assert_not_called()

    @pytest.mark.anyio
    async def test_a_connection_ending_while_the_turn_runs_marks_that_turn(self):
        pipeline, on_event, _ = _stream_pipeline(_FakeRuntime([_user_turn(), _text("Reading.")]))

        await pipeline.start()
        await _consumer_ended(pipeline)

        assert _failure_turns(on_event) == ["u1"]

    @pytest.mark.anyio
    async def test_a_connection_ending_after_the_turn_finished_marks_no_turn(self):
        pipeline, on_event, _ = _stream_pipeline(_FakeRuntime([_user_turn(), _result()], []))

        await pipeline.start()
        await _consumer_ended(pipeline)

        assert _errors(on_event) == ["The agent's connection ended before it answered"]
        assert _failure_turns(on_event) == [None]

    @pytest.mark.anyio
    async def test_a_connection_ending_during_a_follow_up_marks_the_turn(self):
        runtime = _FakeRuntime([_user_turn(), _result()], [_notification(), _text("Found it.")])
        pipeline, on_event, _ = _stream_pipeline(runtime)

        await pipeline.start()
        await _consumer_ended(pipeline)

        assert _failure_turns(on_event) == ["u1"]

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("ending", "failure"),
        [
            ([], "The agent's connection ended before it answered"),
            ([RuntimeError("cli exited 1")], "Message failed to process: cli exited 1"),
        ],
        ids=["connection-ended", "consumer-error"],
    )
    async def test_a_message_never_acknowledged_shows_as_its_own_failed_turn(self, ending, failure):
        pipeline = None

        def send_unechoed():
            pipeline.set_prompt("and the next one")  # ty: ignore[unresolved-attribute]

        runtime = _FakeRuntime([_user_turn(), _result()], [send_unechoed, *ending], [])
        pipeline, on_event, _ = _stream_pipeline(runtime)

        await pipeline.start()
        await _consumer_ended(pipeline)

        published = [call.args[0] for call in on_event.await_args_list]
        question = next(e for e in published if e.content == "and the next one")
        assert question.is_human and question.turn_id not in (None, "u1")
        assert _errors(on_event) == [failure]
        assert _failure_turns(on_event) == [question.turn_id]
        assert [e.turn_id for e in published if e.type == "result"] == ["u1"]

    @pytest.mark.anyio
    async def test_a_runtime_that_never_connected_reports_nothing(self):
        pipeline, on_event, on_stream_lost = _stream_pipeline(
            _FakeRuntime(connect_error="agent process would not start"),
        )

        await pipeline.start()
        await _consumer_ended(pipeline)

        assert _errors(on_event) == []
        on_stream_lost.assert_not_called()


async def _consumer_ended(pipeline: EventPipeline) -> None:
    task = pipeline._task
    assert task is not None
    await task


class TestResultOnlyReply:
    """A reply that is only a result shows under the question that asked it."""

    @staticmethod
    async def _published(pipeline: EventPipeline, on_event: AsyncMock, results: int) -> list:
        await pipeline.start()

        async with asyncio.timeout(5):
            while sum(c.args[0].type == "result" for c in on_event.await_args_list) < results:
                await asyncio.sleep(0.01)

        await pipeline.stop()

        return [c.args[0] for c in on_event.await_args_list]

    @staticmethod
    def _shape(published: list) -> list[tuple]:
        return [(e.type, e.subtype, e.content) for e in published if e.type != "system"]

    @pytest.mark.anyio
    async def test_an_unechoed_reply_after_an_answered_turn_lands_on_its_own_question(self):
        pipeline = None

        def send_unechoed():
            pipeline.set_prompt("/reveiw everything")  # ty: ignore[unresolved-attribute]

        unknown = AgentEvent(
            kind="result",
            payload=ResultPayload(subtype="success", result="Unknown skill: reveiw"),
        )
        runtime = _FakeRuntime(
            [_user_turn(), _text("Hi."), _result()],
            [send_unechoed, unknown],
            None,
        )
        pipeline, on_event, _ = _stream_pipeline(runtime)

        published = await self._published(pipeline, on_event, results=2)

        question = next(e for e in published if e.content == "/reveiw everything")
        assert self._shape(published) == [
            ("user", "message", "hello"),
            ("assistant", "text", "Hi."),
            ("result", "success", "done"),
            ("user", "message", "/reveiw everything"),
            ("assistant", "text", "Unknown skill: reveiw"),
            ("result", "error", "Unknown skill: reveiw"),
        ]
        assert question.turn_id not in (None, "u1")
        assert [e.turn_id for e in published[3:]] == [question.turn_id] * 3
        assert [e.turn_id for e in published[:3]] == ["u1"] * 3

    @pytest.mark.anyio
    async def test_a_first_message_answered_only_by_a_result_lands_on_its_question(self):
        unknown = AgentEvent(
            kind="result",
            payload=ResultPayload(subtype="success", result="Unknown skill: reveiw"),
        )
        pipeline, on_event, _ = _stream_pipeline(_FakeRuntime([unknown], None))
        pipeline.set_prompt("/reveiw everything")

        published = await self._published(pipeline, on_event, results=1)

        assert self._shape(published) == [
            ("user", "message", "/reveiw everything"),
            ("assistant", "text", "Unknown skill: reveiw"),
            ("result", "error", "Unknown skill: reveiw"),
        ]
        assert published[0].turn_id is not None
        assert {e.turn_id for e in published} == {published[0].turn_id}

    @pytest.mark.anyio
    async def test_a_question_already_shown_before_it_was_sent_is_not_shown_again(self):
        compacted = AgentEvent(
            kind="result",
            payload=ResultPayload(subtype="success", result="Compacted."),
        )
        pipeline, on_event, _ = _stream_pipeline(_FakeRuntime([compacted], None))
        await pipeline.inject_event(
            event_type="user",
            subtype="message",
            content="/compact",
            is_human=True,
            primary=True,
        )
        pipeline.set_prompt("/compact")

        published = await self._published(pipeline, on_event, results=1)

        assert [e.content for e in published if e.type == "user"] == ["/compact"]
        assert {e.turn_id for e in published} == {published[0].turn_id}
