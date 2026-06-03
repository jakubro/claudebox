"""Tests for claudebox.agent_session.orchestration.pipeline — result-only turn and echo suppression."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from claude_agent_sdk import UserMessage

from claudebox.agent_session.orchestration.models import PublishedEvent
from claudebox.agent_session.orchestration.pipeline import EventPipeline


# --- Helpers ---


def _make_pipeline() -> EventPipeline:
    """Create a pipeline with mocked dependencies for unit testing."""

    pipeline = EventPipeline(
        sdk_client=MagicMock(),
        workspace=MagicMock(),
        on_init=AsyncMock(),
        on_event=AsyncMock(),
    )
    # Bypass initialization gate so injected events go through _process_event
    pipeline._initialized = True
    pipeline._event_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
    return pipeline


def _make_result_event(content: str = "Unknown skill: absort") -> PublishedEvent:
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
        pipeline.set_prompt("/absort everything")
        assert pipeline._prompt == "/absort everything"

    def test_clears_prompt(self):
        pipeline = _make_pipeline()
        pipeline.set_prompt("/absort everything")
        pipeline.set_prompt(None)
        assert pipeline._prompt is None


# --- _surface_result_only_turn ---


class TestSurfaceResultOnlyTurn:
    """Test synthetic event injection for result-only turns."""

    @pytest.mark.anyio
    async def test_injects_user_and_assistant_when_no_user_event(self):
        pipeline = _make_pipeline()
        pipeline.set_prompt("/absort everything")
        result_event = _make_result_event()

        with patch.object(pipeline, "inject_event", wraps=pipeline.inject_event) as spy:
            await pipeline._surface_result_only_turn(result_event, saw_user_event=False)

        assert spy.call_count == 2

        # First: synthetic user message
        user_call = spy.call_args_list[0].kwargs
        assert user_call["event_type"] == "user"
        assert user_call["subtype"] == "message"
        assert user_call["content"] == "/absort everything"
        assert user_call["is_human"] is True
        assert user_call["primary"] is True

        # Second: synthetic assistant text
        asst_call = spy.call_args_list[1].kwargs
        assert asst_call["event_type"] == "assistant"
        assert asst_call["subtype"] == "text"
        assert asst_call["content"] == "Unknown skill: absort"
        assert asst_call["primary"] is True

        # Result event subtype overridden
        assert result_event.subtype == "error"

    @pytest.mark.anyio
    async def test_skips_user_injection_when_user_event_seen(self):
        pipeline = _make_pipeline()
        pipeline.set_prompt("/absort everything")
        result_event = _make_result_event()

        with patch.object(pipeline, "inject_event", wraps=pipeline.inject_event) as spy:
            await pipeline._surface_result_only_turn(result_event, saw_user_event=True)

        # Only assistant text injected, no user message
        assert spy.call_count == 1
        assert spy.call_args_list[0].kwargs["event_type"] == "assistant"
        assert result_event.subtype == "error"

    @pytest.mark.anyio
    async def test_skips_user_injection_when_no_prompt(self):
        pipeline = _make_pipeline()
        # No prompt set
        result_event = _make_result_event()

        with patch.object(pipeline, "inject_event", wraps=pipeline.inject_event) as spy:
            await pipeline._surface_result_only_turn(result_event, saw_user_event=False)

        # Only assistant text injected (no prompt available for user message)
        assert spy.call_count == 1
        assert spy.call_args_list[0].kwargs["event_type"] == "assistant"
        assert result_event.subtype == "error"


# --- suppress_next_user_echo ---


class TestSuppressNextUserEcho:
    """Test SDK echo suppression for attachment user messages."""

    def test_sets_flag(self):
        pipeline = _make_pipeline()
        pipeline.suppress_next_user_echo()
        assert pipeline._suppress_user_echo is True

    def test_flag_defaults_to_false(self):
        pipeline = _make_pipeline()
        assert pipeline._suppress_user_echo is False


# --- Echo suppression ordering in _run() ---


class TestEchoSuppressionInRun:
    """Test that _run() correctly suppresses/passes user messages based on the flag."""

    @staticmethod
    def _patch_pipeline_for_run(pipeline, messages):
        """Prepare a pipeline to execute _run() with a controlled message sequence.

        Sets up the SDK client mock so that ``receive_events`` yields *messages*
        exactly once (one full response cycle), then a second call stops the loop.
        This mirrors real behaviour where _run() loops over response cycles.
        """

        from claudebox.agent_session.runtime_claude import ClaudeRuntime

        call_count = 0

        async def _fake_receive():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                for m in messages:
                    yield ClaudeRuntime._translate_sdk_message(m)
            else:
                # Second iteration: stop the loop
                pipeline._running = False
                return

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = _fake_receive

    @pytest.mark.anyio
    async def test_user_message_suppressed_when_flag_set(self):
        """When _suppress_user_echo is True, a plain UserMessage is dropped."""

        pipeline = _make_pipeline()
        user_msg = UserMessage("hello from attachment")
        self._patch_pipeline_for_run(pipeline, [user_msg])
        pipeline.suppress_next_user_echo()

        await pipeline._run()

        # The user message should have been suppressed — on_event never called
        pipeline._on_event.assert_not_called()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    @pytest.mark.anyio
    async def test_flag_resets_after_suppression(self):
        """The flag is one-shot: after suppressing one message it resets to False."""

        pipeline = _make_pipeline()
        user_msg = UserMessage("first — suppressed")
        self._patch_pipeline_for_run(pipeline, [user_msg])
        pipeline.suppress_next_user_echo()

        await pipeline._run()

        assert pipeline._suppress_user_echo is False

    @pytest.mark.anyio
    async def test_second_user_message_not_suppressed(self):
        """Only the first user message is suppressed; the second passes through."""

        pipeline = _make_pipeline()
        msg1 = UserMessage("suppressed echo")
        msg2 = UserMessage("real follow-up")
        self._patch_pipeline_for_run(pipeline, [msg1, msg2])
        pipeline.suppress_next_user_echo()

        await pipeline._run()

        # msg1 suppressed, msg2 forwarded — on_event should have been called
        assert pipeline._on_event.call_count >= 1  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        forwarded_types = [call.args[0].type for call in pipeline._on_event.call_args_list]  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert "user" in forwarded_types

    @pytest.mark.anyio
    async def test_non_user_event_unaffected_by_flag(self):
        """An assistant message is forwarded even when the suppress flag is set."""

        from claude_agent_sdk import AssistantMessage
        from claude_agent_sdk.types import TextBlock

        pipeline = _make_pipeline()
        assistant_msg = AssistantMessage(
            content=[TextBlock(text="I can help with that.")],
            model="claude-sonnet",
        )
        self._patch_pipeline_for_run(pipeline, [assistant_msg])
        pipeline.suppress_next_user_echo()

        await pipeline._run()

        # Assistant message must not be suppressed
        assert pipeline._on_event.call_count >= 1  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        forwarded_types = [call.args[0].type for call in pipeline._on_event.call_args_list]  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert "assistant" in forwarded_types
        # Flag still True because no UserMessage arrived to consume it
        assert pipeline._suppress_user_echo is True

    @pytest.mark.anyio
    async def test_tool_use_result_not_suppressed(self):
        """A UserMessage with tool_use_result is NOT suppressed by the flag."""

        pipeline = _make_pipeline()
        tool_result_msg = UserMessage(
            "tool output",
            tool_use_result={"tool_use_id": "tu_1", "content": "result"},
        )
        self._patch_pipeline_for_run(pipeline, [tool_result_msg])
        pipeline.suppress_next_user_echo()

        await pipeline._run()

        # tool_use_result messages bypass suppression — should be forwarded
        assert pipeline._on_event.call_count >= 1  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        # Flag should still be True (not consumed by a tool result message)
        assert pipeline._suppress_user_echo is True


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
            yield  # noqa: unreachable — makes this an async generator for async for

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _error_then_stop  # Test coroutine structurally replaces the SDK receive method.
        )
        pipeline.inject_event = AsyncMock()  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

        await pipeline._run()

        assert pipeline._prompt is None


# --- Compact boundary fallback on pipeline error ---


class TestCompactBoundaryFallbackOnError:
    """Test that _run() emits compact_boundary if the loop errors mid-compaction."""

    @pytest.mark.anyio
    async def test_emits_boundary_when_compacting(self):
        """If _turn_tracker.is_compacting is True when the loop errors, a synthetic
        compact_boundary is injected before the system/error event so the frontend
        clears its compaction state cleanly."""

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
            yield  # noqa: unreachable — keeps this an async generator

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _error_then_stop  # Test coroutine structurally replaces the SDK receive method.
        )
        pipeline.inject_event = AsyncMock()  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

        await pipeline._run()

        # Boundary emitted before the error event — order matters so the frontend
        # unsticks isCompacting before rendering the error.
        injected = [c.kwargs for c in pipeline.inject_event.await_args_list]  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
            yield  # noqa: unreachable

        pipeline._running = True
        pipeline._sdk_client.ready = asyncio.Event()
        pipeline._sdk_client.ready.set()
        pipeline._sdk_client.receive_events = (  # ty: ignore[invalid-assignment]
            _error_then_stop  # Test coroutine structurally replaces the SDK receive method.
        )
        pipeline.inject_event = AsyncMock()  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

        await pipeline._run()

        injected = [c.kwargs for c in pipeline.inject_event.await_args_list]  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert all(c["subtype"] != "compact_boundary" for c in injected)
        assert any(c["subtype"] == "error" for c in injected)


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
