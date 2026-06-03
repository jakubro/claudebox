"""Tests for claudebox.agent_session.orchestration.pipeline — initialization and event processing."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.orchestration.pipeline import EventPipeline
from ._helpers import make_published_event as _make_event


# --- Helpers ---


def _make_pipeline(tmp_workspace, *, on_init=None, on_event=None):
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
    )


# --- _initialize ---


class TestInitialize:
    """Test pipeline initialization from session_id."""

    @pytest.mark.anyio
    async def test_sets_session_id_from_message(self, tmp_workspace):
        from claudebox.agent_session.events import AgentEvent

        on_init = AsyncMock()
        pipeline = _make_pipeline(tmp_workspace, on_init=on_init)

        agent_event = AgentEvent(
            kind="system",
            payload={"subtype": "init", "data": {"session_id": "sess-abc"}},
        )

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = []
            MockEventLog.return_value = mock_log

            await pipeline._initialize(agent_event=agent_event)

        assert pipeline._session_id == "sess-abc"
        assert pipeline._initialized is True
        on_init.assert_awaited_once_with("sess-abc")

    @pytest.mark.anyio
    async def test_sets_session_id_from_param(self, tmp_workspace):
        on_init = AsyncMock()
        pipeline = _make_pipeline(tmp_workspace, on_init=on_init)

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = []
            MockEventLog.return_value = mock_log

            await pipeline._initialize(session_id="sess-xyz")

        assert pipeline._session_id == "sess-xyz"
        assert pipeline._initialized is True

    @pytest.mark.anyio
    async def test_flushes_buffer_after_init(self, tmp_workspace):
        on_event = AsyncMock()
        pipeline = _make_pipeline(tmp_workspace, on_event=on_event)

        # Buffer an event before init
        await pipeline.inject_event(event_type="system", subtype="early_bird")
        assert len(pipeline._buffer) == 1

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = []
            MockEventLog.return_value = mock_log

            await pipeline._initialize(session_id="sess-1")

        # Buffer flushed
        assert len(pipeline._buffer) == 0
        # Event was persisted via _process_event (log.append + on_event)
        mock_log.append.assert_called_once()
        on_event.assert_awaited_once()

    @pytest.mark.anyio
    async def test_loads_historical_events(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        historical = [_make_event(id="h1"), _make_event(id="h2")]

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = historical
            MockEventLog.return_value = mock_log

            await pipeline._initialize(session_id="sess-1")

        assert len(pipeline._historical_events) == 2

    @pytest.mark.anyio
    async def test_subsequent_init_is_noop(self, tmp_workspace):
        on_init = AsyncMock()
        pipeline = _make_pipeline(tmp_workspace, on_init=on_init)

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = []
            MockEventLog.return_value = mock_log

            await pipeline._initialize(session_id="sess-abc")

        assert on_init.await_count == 1

        # Second call with different session_id — should be a no-op
        await pipeline._initialize(session_id="sess-different")

        assert pipeline._session_id == "sess-abc"
        assert on_init.await_count == 1


# --- _process_event ---


class TestProcessEvent:
    """Test event routing: buffer vs persist+notify."""

    @pytest.mark.anyio
    async def test_buffers_when_not_initialized(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        event = _make_event()

        await pipeline._process_event(event)

        assert event in pipeline._buffer

    @pytest.mark.anyio
    async def test_persists_and_notifies_when_initialized(self, tmp_workspace):
        on_event = AsyncMock()
        pipeline = _make_pipeline(tmp_workspace, on_event=on_event)
        pipeline._initialized = True
        mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
        pipeline._event_log = mock_log

        event = _make_event()
        await pipeline._process_event(event)

        mock_log.append.assert_awaited_once_with(event)
        on_event.assert_awaited_once_with(event)


# --- get_events ---


class TestGetEvents:
    """Test event retrieval from buffer or event log."""

    def test_returns_buffer_when_not_initialized(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        pipeline._buffer = [_make_event(id="b1"), _make_event(id="b2")]

        events = pipeline.get_events()

        assert len(events) == 2
        assert events[0].id == "b1"

    def test_returns_event_log_when_initialized(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        pipeline._initialized = True
        mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
        mock_log.read_all.return_value = [_make_event(id="l1")]
        pipeline._event_log = mock_log

        events = pipeline.get_events()

        assert len(events) == 1
        assert events[0].id == "l1"
        mock_log.read_all.assert_called_once()
