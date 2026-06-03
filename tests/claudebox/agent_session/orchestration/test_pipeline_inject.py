"""Tests for claudebox.agent_session.orchestration.pipeline — event injection and buffering."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.orchestration.pipeline import EventPipeline


# --- Helpers ---


def _make_pipeline(tmp_workspace, *, on_init=None, on_event=None, resume_session_id=None):
    """Create a pipeline with mocked SDK client and callbacks."""

    sdk_client = MagicMock()
    sdk_client.ready = MagicMock()
    sdk_client.ready.wait = AsyncMock()

    workspace = MagicMock()
    workspace.path = tmp_workspace

    return EventPipeline(
        sdk_client=sdk_client,
        workspace=workspace,
        on_init=on_init or AsyncMock(),
        on_event=on_event or AsyncMock(),
        resume_session_id=resume_session_id,
    )


# --- Event Injection ---


class TestInjectEvent:
    """Test synthetic event injection."""

    @pytest.mark.anyio
    async def test_inject_creates_published_event(self, tmp_workspace):
        events = []

        async def capture_event(event):
            events.append(event)

        pipeline = _make_pipeline(tmp_workspace, on_event=capture_event)
        pipeline._initialized = True
        pipeline._event_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())

        await pipeline.inject_event(
            event_type="system",
            subtype="model_changed",
            model="opus",
        )

        assert len(events) == 1
        assert events[0].type == "system"
        assert events[0].subtype == "model_changed"
        assert events[0].model == "opus"

    @pytest.mark.anyio
    async def test_inject_assigns_sequential_ids(self, tmp_workspace):
        events = []

        async def capture_event(event):
            events.append(event)

        pipeline = _make_pipeline(tmp_workspace, on_event=capture_event)
        pipeline._initialized = True
        pipeline._event_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())

        await pipeline.inject_event(event_type="system", subtype="a")
        await pipeline.inject_event(event_type="system", subtype="b")

        assert events[0].id == "evt_000000001"
        assert events[1].id == "evt_000000002"

    @pytest.mark.anyio
    async def test_inject_human_event_generates_turn_id(self, tmp_workspace):
        events = []

        async def capture_event(event):
            events.append(event)

        pipeline = _make_pipeline(tmp_workspace, on_event=capture_event)
        pipeline._initialized = True
        pipeline._event_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())

        await pipeline.inject_event(
            event_type="user",
            subtype="message",
            content="hello",
            is_human=True,
        )

        assert events[0].turn_id is not None


# --- Buffering ---


class TestBuffering:
    """Test event buffering before initialization."""

    @pytest.mark.anyio
    async def test_events_buffered_before_init(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)

        await pipeline.inject_event(event_type="system", subtype="early")

        assert len(pipeline._buffer) == 1
        assert pipeline._buffer[0].subtype == "early"

    @pytest.mark.anyio
    async def test_get_events_returns_buffer_when_not_initialized(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)

        await pipeline.inject_event(event_type="system", subtype="buffered")

        events = pipeline.get_events()
        assert len(events) == 1
        assert events[0].subtype == "buffered"


# --- Stop ---


class TestStop:
    """Test pipeline shutdown."""

    @pytest.mark.anyio
    async def test_stop_closes_event_log(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        mock_log = AsyncMock()
        pipeline._event_log = mock_log

        await pipeline.stop()

        mock_log.close.assert_awaited_once()
        assert pipeline._event_log is None

    @pytest.mark.anyio
    async def test_stop_stops_task_monitors(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)

        with patch.object(pipeline._async_task_manager, "stop_all") as mock_stop:
            await pipeline.stop()
            assert mock_stop.call_count >= 1


# --- Prompt ---


class TestPrompt:
    """Test prompt storage for result-only turn detection."""

    def test_set_prompt(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        pipeline.set_prompt("test prompt")
        assert pipeline._prompt == "test prompt"

    def test_set_prompt_none(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        pipeline.set_prompt(None)
        assert pipeline._prompt is None
