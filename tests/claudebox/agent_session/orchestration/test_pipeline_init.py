"""Tests for claudebox.agent_session.orchestration.pipeline - initialization and event processing."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.orchestration.persistence import EventLog
from claudebox.agent_session.orchestration.pipeline import EventPipeline
from claudebox.constants import SESSION_EVENTS_FILE
from claudebox.core import serialization
from claudebox.workspace import Workspace
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
        from claudebox.agent_session.events import AgentEvent, SystemInitPayload

        on_init = AsyncMock()
        pipeline = _make_pipeline(tmp_workspace, on_init=on_init)

        agent_event = AgentEvent(
            kind="system_init",
            payload=SystemInitPayload(subtype="init", session_id="sess-abc"),
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

        await pipeline.inject_event(event_type="system", subtype="early_bird")
        assert len(pipeline._buffer) == 1

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = []
            MockEventLog.return_value = mock_log

            await pipeline._initialize(session_id="sess-1")

        assert len(pipeline._buffer) == 0
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
    async def test_a_resumed_pipeline_continues_the_turn_the_person_last_opened(
        self,
        tmp_workspace,
    ):
        pipeline = _make_pipeline(tmp_workspace)
        historical = [
            _make_event(id="h1", type="user", subtype="message", is_human=True, turn_id="T1"),
            _make_event(id="h2", content="Done.", turn_id="T1"),
            _make_event(id="h3", type="user", subtype="message", is_human=True, turn_id="T2"),
            _make_event(id="h4", type="user", subtype="tool_result", turn_id="R1"),
        ]

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = historical
            MockEventLog.return_value = mock_log

            await pipeline._initialize(session_id="sess-1")

        assert pipeline.turn_tracker.current == "T2"

    @pytest.mark.anyio
    async def test_a_send_before_the_history_is_read_keeps_its_own_turn(self, tmp_workspace):
        pipeline = _make_pipeline(tmp_workspace)
        await pipeline.inject_event(
            event_type="user",
            subtype="message",
            content="/compact",
            is_human=True,
            primary=True,
            turn_id="T-new",
        )

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = [
                _make_event(id="h1", type="user", subtype="message", is_human=True, turn_id="T1"),
            ]
            MockEventLog.return_value = mock_log

            await pipeline._initialize(session_id="sess-1")

        await pipeline.inject_event(event_type="system", subtype="error", content="failed")

        assert [call.args[0].turn_id for call in mock_log.append.await_args_list] == [
            "T-new",
            "T-new",
        ]

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

        # Second call with different session_id - should be a no-op
        await pipeline._initialize(session_id="sess-different")

        assert pipeline._session_id == "sess-abc"
        assert on_init.await_count == 1


# --- _process_event ---


class TestConcurrentInitialize:
    @pytest.mark.anyio
    async def test_concurrent_initialize_runs_once(self, tmp_workspace):
        """An on-demand init racing the agent's system_init opens the log and runs on_init once."""

        import asyncio

        from claudebox.agent_session.events import AgentEvent, SystemInitPayload

        async def slow_init(_session_id):
            await asyncio.sleep(0.05)

        on_init = AsyncMock(side_effect=slow_init)
        pipeline = _make_pipeline(tmp_workspace, on_init=on_init)
        init = AgentEvent(
            kind="system_init",
            payload=SystemInitPayload(subtype="init", session_id="sid"),
        )

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as MockEventLog:
            mock_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())
            mock_log.read_all.return_value = []
            MockEventLog.return_value = mock_log

            await asyncio.gather(
                pipeline.ensure_initialized("sid"),
                pipeline._initialize(agent_event=init),
            )

        on_init.assert_awaited_once_with("sid")
        mock_log.open.assert_awaited_once()


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


class TestResumeOverATornTail:
    """The restart divider injected on resume survives a log torn by the run before."""

    @pytest.mark.anyio
    async def test_the_divider_persists(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        events_path = ws.ensure_session("sess-1").path / SESSION_EVENTS_FILE
        history = serialization.dumps(_make_event(id="h1")).encode() + b"\n"
        events_path.write_bytes(history + b'{"id": "h2", "content": "hal')

        holder = {}

        async def on_init(session_id: str) -> None:
            assert session_id == "sess-1"
            await holder["pipeline"].inject_event(
                event_type="system",
                subtype="container_restarted",
            )

        sdk_client = MagicMock()
        sdk_client.ready = MagicMock()
        sdk_client.ready.wait = AsyncMock()
        pipeline = EventPipeline(
            sdk_client=sdk_client,
            workspace=ws,
            on_init=on_init,
            on_event=AsyncMock(),
        )
        holder["pipeline"] = pipeline

        await pipeline._initialize(session_id="sess-1")
        event_log = pipeline._event_log
        assert event_log is not None
        await event_log.close()

        assert "container_restarted" in [event.subtype for event in pipeline.get_events()]
        reread = EventLog("sess-1", ws).read_all()
        assert [event.subtype for event in reread][-1] == "container_restarted"
