"""Tests for claudebox.agent_session.orchestration.session - dispose, projection resolution, state tracking."""

from __future__ import annotations

import asyncio
import threading
import time
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.catalogs import StreamHealth
from claudebox.agent_session.hooks import CompactStartPayload
from claudebox.agent_session.orchestration import projection as projection_module
from claudebox.agent_session.orchestration.models import SessionSummary
from claudebox.agent_session.orchestration.pipeline import EventPipeline
from claudebox.agent_session.orchestration.projection import Projection
from claudebox.agent_session.orchestration.session import SessionService
from claudebox.agent_session.orchestration.turn_tracker import TurnTracker
from claudebox.constants import SESSION_STALL_TIMEOUT
from claudebox.core import serialization
from claudebox.core.io import read_json, write_json
from claudebox.workspace import Workspace
from ._helpers import make_published_event as _make_event


_CHECK_INTERVAL = "claudebox.agent_session.orchestration.session.SESSION_STALL_CHECK_INTERVAL"


# --- Helpers ---


def _make_session(tmp_workspace) -> SessionService:
    """Create a SessionService with minimal workspace, suitable for testing internal methods."""

    session = SessionService(workspace=tmp_workspace)

    return session


async def _until(predicate, timeout: float = 5.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


# --- _dispose ---


class TestDispose:
    """Test generic component disposal."""

    @pytest.mark.anyio
    async def test_cancels_asyncio_task(self, tmp_workspace):
        session = _make_session(tmp_workspace)

        async def forever():
            await asyncio.sleep(999)

        session._client_task = asyncio.create_task(forever())

        await session._dispose("_client_task", "cancel")

        assert session._client_task is None

    @pytest.mark.anyio
    async def test_calls_async_method_on_object(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        mock_pipeline = MagicMock()
        mock_pipeline.stop = AsyncMock()
        session._event_pipeline = mock_pipeline

        await session._dispose("_event_pipeline", "stop")

        mock_pipeline.stop.assert_awaited_once()
        assert session._event_pipeline is None

    @pytest.mark.anyio
    async def test_handles_error_in_method(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        mock_client = MagicMock()
        mock_client.disconnect = AsyncMock(side_effect=RuntimeError("connection lost"))
        session._sdk_client = mock_client

        # Should not raise
        await session._dispose("_sdk_client", "disconnect")

        assert session._sdk_client is None

    @pytest.mark.anyio
    async def test_noop_for_none_member(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = None  # ty: ignore[invalid-assignment]

        # Should not raise
        await session._dispose("_event_pipeline", "stop")

        assert session._event_pipeline is None


# --- _resolve_projection ---


class TestResolveProjection:
    """Test projection lookup logic."""

    def test_no_session_id_returns_active(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        mock_proj = MagicMock()
        session._projection = mock_proj

        result = session._resolve_projection(None)

        assert result is mock_proj

    def test_matching_id_returns_active(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        mock_proj = MagicMock()
        mock_proj.session_id = "abc-123"
        session._projection = mock_proj

        result = session._resolve_projection("abc-123")

        assert result is mock_proj

    def test_different_id_creates_new(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        mock_proj = MagicMock()
        mock_proj.session_id = "abc-123"
        session._projection = mock_proj

        with patch("claudebox.agent_session.orchestration.session.Projection") as MockProjection:
            mock_new = MagicMock()
            MockProjection.return_value = mock_new

            result = session._resolve_projection("xyz-789")

            assert result is mock_new
            MockProjection.assert_called_once_with(
                session_id="xyz-789",
                workspace=session._workspace,
            )

    def test_no_active_projection_returns_none(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._projection = None  # ty: ignore[invalid-assignment]

        result = session._resolve_projection(None)

        assert result is None


# --- _on_compact_start ---


class TestOnCompactStart:
    """Test compact start callback - typed CompactStartPayload signature."""

    @pytest.mark.anyio
    async def test_captures_session_prompt(self, tmp_workspace):

        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        mock_proj = MagicMock()
        mock_proj.value = SessionSummary(
            session_id="s1",
            fork_point_cost_usd=0.0,
            session_prompt="Remember: you are a helpful assistant",
        )
        session._projection = mock_proj

        await session._on_compact_start(CompactStartPayload(trigger="manual"))

        assert session._pending_compaction_reminder == "Remember: you are a helpful assistant"
        session._event_pipeline.inject_event.assert_awaited_once()
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["subtype"] == "compact_start"

    @pytest.mark.anyio
    async def test_trigger_flows_into_pipeline_event(self, tmp_workspace):
        """Translated trigger from runtime adapter reaches the pipeline event's message_data."""

        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._projection = None  # ty: ignore[invalid-assignment]

        await session._on_compact_start(CompactStartPayload(trigger="context_limit"))

        assert session._pending_compact_trigger == "context_limit"
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["message_data"]["compact_metadata"]["trigger"] == "context_limit"

    @pytest.mark.anyio
    async def test_manual_trigger_preserved(self, tmp_workspace):

        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._projection = None  # ty: ignore[invalid-assignment]

        await session._on_compact_start(CompactStartPayload(trigger="manual"))

        assert session._pending_compact_trigger == "manual"
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["message_data"]["compact_metadata"]["trigger"] == "manual"


# --- _emit_compact_boundary_fallback ---


class TestEmitCompactBoundaryFallback:
    """Test the synthetic compact_boundary emission for interrupt/error exit paths."""

    @pytest.mark.anyio
    async def test_noop_when_not_compacting(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._event_pipeline.turn_tracker = MagicMock(is_compacting=False)

        await session._emit_compact_boundary_fallback(status="interrupted")

        session._event_pipeline.inject_event.assert_not_awaited()

    @pytest.mark.anyio
    async def test_noop_when_pipeline_missing(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = None  # ty: ignore[invalid-assignment]
        # Should not raise, should not emit anything
        await session._emit_compact_boundary_fallback(status="interrupted")

    @pytest.mark.anyio
    async def test_emits_boundary_with_status_when_compacting(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._event_pipeline.turn_tracker = MagicMock(is_compacting=True)
        session._pending_compact_trigger = "context_limit"
        session._pending_compaction_reminder = "carry-over"

        await session._emit_compact_boundary_fallback(status="interrupted")

        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["event_type"] == "system"
        assert call_kwargs["subtype"] == "compact_boundary"
        assert call_kwargs["message_data"] == {
            "compact_metadata": {"trigger": "context_limit", "status": "interrupted"},
        }
        assert session._pending_compact_trigger is None
        assert session._pending_compaction_reminder is None

    @pytest.mark.anyio
    async def test_emits_unknown_trigger_when_not_captured(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._event_pipeline.turn_tracker = MagicMock(is_compacting=True)
        session._pending_compact_trigger = None

        await session._emit_compact_boundary_fallback(status="error")

        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["message_data"]["compact_metadata"]["trigger"] == "unknown"
        assert call_kwargs["message_data"]["compact_metadata"]["status"] == "error"


# --- interrupt() ---


class TestInterrupt:
    """Test interrupt path emits interrupt_sent and (if compacting) a synthetic boundary."""

    @pytest.mark.anyio
    async def test_emits_interrupt_sent_only_when_not_compacting(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._event_pipeline.turn_tracker = MagicMock(is_compacting=False)
        session._sdk_client = MagicMock()
        session._sdk_client.interrupt = AsyncMock()

        await session.interrupt()

        session._event_pipeline.inject_event.assert_awaited_once()
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["subtype"] == "interrupt_sent"
        session._sdk_client.interrupt.assert_awaited_once()

    @pytest.mark.anyio
    async def test_emits_boundary_fallback_when_compacting(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._event_pipeline.turn_tracker = MagicMock(is_compacting=True)
        session._sdk_client = MagicMock()
        session._sdk_client.interrupt = AsyncMock()
        session._pending_compact_trigger = "manual"

        await session.interrupt()

        assert session._event_pipeline.inject_event.await_count == 2

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("finished", "running"),
        [(False, True), (True, False)],
        ids=["while-running", "after-the-result"],
    )
    async def test_records_whether_a_turn_was_running(self, tmp_workspace, finished, running):
        tracker = TurnTracker()
        tracker.observe(_make_event(type="user", subtype="message", is_human=True, turn_id="T1"))

        if finished:
            tracker.observe(_make_event(type="result", subtype="success", turn_id="T1"))

        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._event_pipeline.turn_tracker = tracker
        session._sdk_client = MagicMock()
        session._sdk_client.interrupt = AsyncMock()

        await session.interrupt()

        sent = session._event_pipeline.inject_event.call_args_list[0].kwargs
        assert (sent["subtype"], sent["turn_running"]) == ("interrupt_sent", running)

    @pytest.mark.anyio
    async def test_expires_pending_echo_suppressions(self, tmp_workspace):
        """An attachment message's suppression must not outlive an interrupted turn."""

        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._event_pipeline.turn_tracker = MagicMock(is_compacting=False)
        session._sdk_client = MagicMock()
        session._sdk_client.interrupt = AsyncMock()

        await session.interrupt()

        session._event_pipeline.expire_pending_echo_suppressions.assert_called_once()

    @pytest.mark.anyio
    async def test_no_projection_sets_none(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._projection = None  # ty: ignore[invalid-assignment]

        await session._on_compact_start(CompactStartPayload(trigger="manual"))

        assert session._pending_compaction_reminder is None

    @pytest.mark.anyio
    async def test_no_session_prompt_sets_none(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        mock_proj = MagicMock()
        mock_proj.value = SessionSummary(
            session_id="s1",
            fork_point_cost_usd=0.0,
            session_prompt=None,
        )
        session._projection = mock_proj

        await session._on_compact_start(CompactStartPayload(trigger="manual"))

        assert session._pending_compaction_reminder is None


# --- _handle_event ---


class TestHandleEvent:
    """Test event handler - broadcast + projection update + compact boundary prompt."""

    @pytest.mark.anyio
    async def test_broadcasts_and_updates_projection(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._projection.update.return_value = False
        session._sdk_client = MagicMock()

        event = _make_event(subtype="text")
        await session._handle_event(event)

        session._broadcaster.broadcast.assert_awaited_once_with(
            event,
        )
        session._projection.update.assert_called_once_with(
            event,
        )
        session._projection.schedule_save.assert_called_once()

    @pytest.mark.anyio
    async def test_a_change_of_activity_reaches_the_record_at_once(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = Projection("activity-record", Workspace(start_dir=tmp_workspace))
        session._sdk_client = MagicMock()
        record = session._projection._path

        await session._handle_event(_make_event(type="assistant", subtype="text", content="ok"))

        assert read_json(record)["activity"] == "working"

        await session._handle_event(_make_event(type="assistant", subtype="text", content="more"))
        record.unlink()
        await session._handle_event(_make_event(type="assistant", subtype="thinking", content="hm"))

        assert not record.exists()

    @pytest.mark.anyio
    async def test_a_slower_write_already_in_flight_never_has_the_last_word(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = Projection("activity-race", Workspace(start_dir=tmp_workspace))
        session._sdk_client = MagicMock()
        record = session._projection._path
        release = threading.Event()
        held = []
        held_landed = threading.Event()
        landed_after_it = threading.Event()
        real_write_json = projection_module.write_json

        def write_json(path, data):
            if threading.current_thread() is threading.main_thread():
                real_write_json(path, data)

                return

            if held:
                real_write_json(path, data)

                if held_landed.is_set():
                    landed_after_it.set()

                return

            held.append(serialization.dumps(data))
            release.wait(5)
            path.write_text(held[0])
            held_landed.set()

        with patch.object(projection_module, "write_json", write_json):
            await session._handle_event(_make_event(type="assistant", subtype="text", content="a"))
            await session._handle_event(_make_event(type="assistant", subtype="text", content="b"))
            await _until(lambda: bool(held))
            await session._handle_event(_make_event(type="result", subtype="success"))
            release.set()
            await _until(landed_after_it.is_set)

        assert read_json(record)["activity"] is None

    @pytest.mark.anyio
    async def test_compact_boundary_sends_pending_prompt(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._sdk_client.query = AsyncMock()
        session._pending_compaction_reminder = "Stay focused on the task"

        event = _make_event(subtype="compact_boundary")
        await session._handle_event(event)

        session._sdk_client.query.assert_awaited_once()
        query_arg = session._sdk_client.query.call_args.args[0]
        assert "Stay focused on the task" in query_arg
        assert session._pending_compaction_reminder is None

    @pytest.mark.anyio
    async def test_tool_use_and_result_track_outstanding_work(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()

        await session._handle_event(_make_event(subtype="tool_use"))
        await session._handle_event(_make_event(subtype="tool_use"))

        assert session._tools_outstanding == 2

        await session._handle_event(_make_event(type="user", subtype="tool_result"))

        assert session._tools_outstanding == 1

    @pytest.mark.anyio
    async def test_result_disarms_the_stall_watchdog(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._turn_dispatched_at = time.monotonic()

        await session._handle_event(_make_event(type="result", subtype="success"))

        assert session._turn_dispatched_at is None
        assert session._context_refresh_timer is not None

        session._context_refresh_timer.cancel()

    @pytest.mark.anyio
    async def test_compact_boundary_no_pending_prompt(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._sdk_client.query = AsyncMock()
        session._pending_compaction_reminder = None

        event = _make_event(subtype="compact_boundary")
        await session._handle_event(event)

        session._sdk_client.query.assert_not_awaited()


class TestSessionTitle:
    """An unnamed session is titled in the background at its third, sixth and tenth user message."""

    def _session(self, tmp_workspace, monkeypatch, title="Fixing the CSV parser"):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = Projection("titled", Workspace(start_dir=tmp_workspace))
        session._sdk_client = MagicMock()
        session._sdk_client.generate_title = AsyncMock(return_value=title)

        return session

    @staticmethod
    async def _send(session, *messages):
        for message in messages:
            await session._handle_event(_make_event(type="user", is_human=True, content=message))

    @pytest.mark.anyio
    async def test_third_message_titles_the_session_from_the_first_three(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch)

        await self._send(session, "one", "two", "three")
        await session._title_task

        session._sdk_client.generate_title.assert_awaited_once_with(["one", "two", "three"])
        assert read_json(session._projection._path)["auto_name"] == "Fixing the CSV parser"
        assert session._projection.value.name is None

    @pytest.mark.anyio
    async def test_subagent_prompts_do_not_count_as_user_messages(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch)
        await self._send(session, "one")

        for prompt in ("explore the parser", "read the tests"):
            await session._handle_event(
                _make_event(type="user", is_human=True, content=prompt, parent_tool_use_id="t1"),
            )

        await self._send(session, "two")

        assert session._title_task is None

        await self._send(session, "three")
        await session._title_task

        session._sdk_client.generate_title.assert_awaited_once_with(["one", "two", "three"])

    @pytest.mark.anyio
    async def test_two_messages_leave_the_session_unnamed(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch)

        await self._send(session, "one", "two")

        assert session._title_task is None
        assert session._projection.value.auto_name is None

    @pytest.mark.anyio
    async def test_only_the_third_sixth_and_tenth_messages_retitle(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch)
        counts = []

        for n in range(1, 15):
            calls = session._sdk_client.generate_title.await_count
            await self._send(session, f"m{n}")

            if session._title_task is not None:
                await session._title_task

            if session._sdk_client.generate_title.await_count > calls:
                counts.append(n)

        assert counts == [3, 6, 10]

    @pytest.mark.anyio
    async def test_sixth_and_tenth_messages_retitle_from_the_longer_opening(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch)
        session._sdk_client.generate_title = AsyncMock(side_effect=["Three", "Six", "Ten"])
        messages = [f"m{n}" for n in range(1, 11)]

        await self._send(session, *messages[:3])
        await session._title_task
        await self._send(session, *messages[3:6])
        await session._title_task

        assert session._projection.value.auto_name == "Six"

        await self._send(session, *messages[6:])
        await session._title_task

        assert [c.args[0] for c in session._sdk_client.generate_title.await_args_list] == [
            messages[:3],
            messages[:6],
            messages,
        ]
        assert read_json(session._projection._path)["auto_name"] == "Ten"

    @pytest.mark.anyio
    async def test_failed_refresh_keeps_the_previous_title(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch)
        session._sdk_client.generate_title = AsyncMock(
            side_effect=["Three", RuntimeError("model down")],
        )

        await self._send(session, "one", "two", "three")
        await session._title_task
        await self._send(session, "four", "five", "six")
        await session._title_task

        assert session._projection.value.auto_name == "Three"

    @pytest.mark.anyio
    async def test_failed_first_title_is_filled_at_the_sixth(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch)
        session._sdk_client.generate_title = AsyncMock(side_effect=[RuntimeError("down"), "Six"])

        await self._send(session, "one", "two", "three")
        await session._title_task

        assert session._projection.value.auto_name is None

        await self._send(session, "four", "five", "six")
        await session._title_task

        assert session._projection.value.auto_name == "Six"

    @pytest.mark.anyio
    async def test_hand_name_after_the_first_title_stops_later_ones(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch)

        await self._send(session, "one", "two", "three")
        await session._title_task
        data = read_json(session._projection._path)
        write_json(session._projection._path, {**data, "name": "My name"})
        await self._send(session, *[f"m{n}" for n in range(4, 11)])

        session._sdk_client.generate_title.assert_awaited_once()
        assert session._projection.value.name == "My name"

    @pytest.mark.anyio
    async def test_slow_title_is_superseded_by_the_next_checkpoint(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch)
        never = asyncio.Event()

        async def slow_then_fast(messages):
            if len(messages) == 3:
                await never.wait()

            return f"From {len(messages)}"

        session._sdk_client.generate_title = AsyncMock(side_effect=slow_then_fast)

        await self._send(session, "one", "two", "three")
        slow = session._title_task
        await self._send(session, "four", "five", "six")

        assert session._title_task is not slow

        await session._title_task
        never.set()
        await asyncio.sleep(0)

        assert slow.cancelled()
        assert session._projection.value.auto_name == "From 6"

    @pytest.mark.anyio
    async def test_resumed_session_titles_only_when_a_checkpoint_arrives(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        """History seeds the count, so resume never backfills a checkpoint already passed."""

        session = self._session(tmp_workspace, monkeypatch)
        session._user_message_count = 8
        session._opening_messages = [f"m{n}" for n in range(1, 9)]

        await self._send(session, "m9")

        assert session._title_task is None

        await self._send(session, "m10")
        await session._title_task

        session._sdk_client.generate_title.assert_awaited_once_with(
            [f"m{n}" for n in range(1, 11)],
        )

    @pytest.mark.anyio
    async def test_hand_named_session_is_never_titled(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch)
        session._projection.save()
        write_json(session._projection._path, {"session_id": "titled", "name": "My name"})

        await self._send(session, "one", "two", "three")

        assert session._title_task is None
        session._sdk_client.generate_title.assert_not_awaited()

    @pytest.mark.anyio
    async def test_hand_name_given_while_titling_wins(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch)

        async def rename_then_title(_messages):
            session._projection.save()
            data = read_json(session._projection._path)
            write_json(session._projection._path, {**data, "name": "My name"})

            return "Fixing the CSV parser"

        session._sdk_client.generate_title = AsyncMock(side_effect=rename_then_title)

        await self._send(session, "one", "two", "three")
        await session._title_task

        assert session._projection.value.name == "My name"
        assert session._projection.value.auto_name is None

    @pytest.mark.anyio
    async def test_failed_title_leaves_the_session_unnamed(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch)
        session._sdk_client.generate_title = AsyncMock(side_effect=RuntimeError("model down"))

        await self._send(session, "one", "two", "three")
        await session._title_task

        assert session._projection.value.auto_name is None

    @pytest.mark.anyio
    async def test_empty_title_leaves_the_session_unnamed(self, tmp_workspace, monkeypatch):
        session = self._session(tmp_workspace, monkeypatch, title=None)

        await self._send(session, "one", "two", "three")
        await session._title_task

        assert session._projection.value.auto_name is None

    @pytest.mark.anyio
    async def test_titling_bumps_updated_at(self, tmp_workspace, monkeypatch):
        """The listing refreshes on a changed `updated_at`, so a title must move it."""

        session = self._session(tmp_workspace, monkeypatch)
        await self._send(session, "one", "two", "three")
        before = session._projection.value.updated_at

        await session._title_task

        assert session._projection.value.updated_at > before


class TestTurnCompleteScheduling:
    """A side thread's on_turn_complete fires once per turn, however that turn ends."""

    def _member_session(self, tmp_workspace):
        """A session wired the way the registry wires a non-primary member."""

        on_turn_complete = AsyncMock()
        session = SessionService(workspace=tmp_workspace, on_turn_complete=on_turn_complete)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._base_session = MagicMock(id="side-1")

        return session, on_turn_complete

    @pytest.mark.anyio
    async def test_result_schedules_turn_complete_for_a_member(self, tmp_workspace):
        session, on_turn_complete = self._member_session(tmp_workspace)

        await session._handle_event(_make_event(type="result", subtype="success"))
        await session._turn_complete_task

        on_turn_complete.assert_awaited_once_with("side-1")

    @pytest.mark.anyio
    async def test_injected_error_schedules_turn_complete(self, tmp_workspace):
        session, on_turn_complete = self._member_session(tmp_workspace)

        await session._handle_event(_make_event(type="system", subtype="error"))
        await session._turn_complete_task

        on_turn_complete.assert_awaited_once_with("side-1")

    @pytest.mark.anyio
    async def test_unrelated_events_do_not_schedule(self, tmp_workspace):
        session, on_turn_complete = self._member_session(tmp_workspace)

        await session._handle_event(_make_event(subtype="text"))
        await session._handle_event(_make_event(subtype="tool_use"))

        assert session._turn_complete_task is None
        on_turn_complete.assert_not_awaited()

    @pytest.mark.anyio
    async def test_scheduling_is_idempotent_within_a_turn(self, tmp_workspace):
        """Result and injected-error can both fire for one turn; only one schedule happens."""

        session, on_turn_complete = self._member_session(tmp_workspace)

        await session._handle_event(_make_event(type="result", subtype="success"))
        await session._handle_event(_make_event(type="system", subtype="error"))
        await session._turn_complete_task

        on_turn_complete.assert_awaited_once()

    @pytest.mark.anyio
    async def test_a_primary_never_schedules(self, tmp_workspace):
        """No on_turn_complete callback means a primary session - the default, unwired."""

        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._base_session = MagicMock(id="primary-1")

        await session._handle_event(_make_event(type="result", subtype="success"))

        assert session._turn_complete_task is None

    @pytest.mark.anyio
    async def test_cancel_turn_complete_stops_a_member_from_scheduling(self, tmp_workspace):
        """Promotion's one state change: a cancelled member behaves like a primary from then on."""

        session, on_turn_complete = self._member_session(tmp_workspace)

        session.cancel_turn_complete()
        await session._handle_event(_make_event(type="result", subtype="success"))

        assert session._turn_complete_task is None
        on_turn_complete.assert_not_awaited()

    def test_cancel_turn_complete_is_a_harmless_no_op_on_a_primary(self, tmp_workspace):
        """A primary has no disposition to cancel - calling it anyway raises nothing."""

        session = _make_session(tmp_workspace)

        session.cancel_turn_complete()

        assert session._on_turn_complete is None

    @pytest.mark.anyio
    async def test_settle_turn_complete_awaits_a_scheduled_disposition(self, tmp_workspace):
        """The registry's guard against resuming into a stopping entry: settling waits for an
        already-fired disposition rather than returning while it is still in flight."""

        session, on_turn_complete = self._member_session(tmp_workspace)
        await session._handle_event(_make_event(type="result", subtype="success"))

        await session.settle_turn_complete()

        assert session._turn_complete_task.done()
        on_turn_complete.assert_awaited_once_with("side-1")

    @pytest.mark.anyio
    async def test_settle_turn_complete_is_a_no_op_when_nothing_was_scheduled(self, tmp_workspace):
        session, _ = self._member_session(tmp_workspace)

        await session.settle_turn_complete()  # must not raise

        assert session._turn_complete_task is None

    @pytest.mark.anyio
    async def test_settle_turn_complete_swallows_a_failed_disposition(self, tmp_workspace):
        """The done-callback already logs a failed disposition - settling only needs to know
        it finished, not that it succeeded."""

        on_turn_complete = AsyncMock(side_effect=RuntimeError("boom"))
        session = SessionService(workspace=tmp_workspace, on_turn_complete=on_turn_complete)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._base_session = MagicMock(id="side-1")

        await session._handle_event(_make_event(type="result", subtype="success"))

        await session.settle_turn_complete()  # must not raise

    @staticmethod
    def _lost_stream_runtime():
        runtime = MagicMock()
        runtime.ready = asyncio.Event()
        runtime.ready.set()
        runtime.connect_error = None

        async def receive_events():
            for _ in ():
                yield

        runtime.receive_events = receive_events

        return runtime

    def _pipeline_for(self, session, runtime):
        pipeline = EventPipeline(
            sdk_client=runtime,
            workspace=MagicMock(),
            on_init=AsyncMock(),
            on_event=AsyncMock(),
            on_stream_lost=session._schedule_turn_complete,
        )
        pipeline._initialized = True
        pipeline._event_log = MagicMock(open=AsyncMock(), append=AsyncMock(), close=AsyncMock())

        return pipeline

    @pytest.mark.anyio
    async def test_a_member_whose_stream_ends_is_stopped(self, tmp_workspace):
        session, on_turn_complete = self._member_session(tmp_workspace)
        pipeline = self._pipeline_for(session, self._lost_stream_runtime())

        await pipeline.start()
        await pipeline._task
        await session._turn_complete_task

        on_turn_complete.assert_awaited_once_with("side-1")

    @pytest.mark.anyio
    async def test_a_rebuilt_consumer_reports_its_stream_loss_too(self, tmp_workspace):
        session, on_turn_complete = self._member_session(tmp_workspace)
        session._sdk_client = self._lost_stream_runtime()
        session._handle_init = AsyncMock()
        dead = MagicMock(is_alive=False, stream_lost=False, session_id="side-1", stop=AsyncMock())
        session._event_pipeline = dead

        with patch("claudebox.agent_session.orchestration.pipeline.EventLog") as event_log:
            event_log.return_value = MagicMock(
                open=AsyncMock(),
                append=AsyncMock(),
                close=AsyncMock(),
                read_all=MagicMock(return_value=[]),
            )
            await session._ensure_pipeline_alive()
            await session._event_pipeline._task

        await session._turn_complete_task

        on_turn_complete.assert_awaited_once_with("side-1")

    @pytest.mark.anyio
    async def test_a_primary_whose_stream_ends_schedules_nothing(self, tmp_workspace):
        session = SessionService(workspace=tmp_workspace)
        session._base_session = MagicMock(id="primary-1")
        pipeline = self._pipeline_for(session, self._lost_stream_runtime())

        await pipeline.start()
        await pipeline._task

        assert session._turn_complete_task is None
        errors = [
            call.args[0].content
            for call in pipeline._on_event.await_args_list
            if call.args[0].subtype == "error"
        ]
        assert errors == ["The agent's connection ended before it answered"]

    @pytest.mark.anyio
    async def test_stopping_a_live_member_schedules_no_disposition(self, tmp_workspace):
        session, _on_turn_complete = self._member_session(tmp_workspace)
        runtime = self._lost_stream_runtime()

        async def parked():
            await asyncio.Event().wait()
            yield

        runtime.receive_events = parked
        pipeline = self._pipeline_for(session, runtime)

        await pipeline.start()
        await asyncio.sleep(0)
        await pipeline.stop()

        assert session._turn_complete_task is None


# --- _fold_rate_limit / _drop_unannounced_rate_limits (via _handle_event) ---


class TestFoldRateLimit:
    """A live rate_limit event upserts or clears its window and marks it re-announced."""

    @pytest.mark.anyio
    async def test_non_allowed_status_upserts_the_window(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()

        event = _make_event(
            type="system",
            subtype="rate_limit",
            message_data={
                "rate_limit_type": "five_hour",
                "status": "allowed_warning",
                "resets_at": None,
                "utilization": 0.86,
            },
        )
        await session._handle_event(event)

        entries = session._rate_limit_store.get()
        assert entries == [
            {
                "rate_limit_type": "five_hour",
                "status": "allowed_warning",
                "resets_at": None,
                "utilization": 0.86,
                "session_id": None,
            },
        ]

    @pytest.mark.anyio
    async def test_upsert_stamps_the_sessions_own_id(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._base_session = MagicMock(id="session-a")

        event = _make_event(
            type="system",
            subtype="rate_limit",
            message_data={
                "rate_limit_type": "five_hour",
                "status": "allowed_warning",
                "resets_at": None,
                "utilization": 0.86,
            },
        )
        await session._handle_event(event)

        assert session._rate_limit_store.get()[0]["session_id"] == "session-a"

    @pytest.mark.anyio
    async def test_allowed_status_clears_the_window(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._rate_limit_store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.9,
        )

        event = _make_event(
            type="system",
            subtype="rate_limit",
            message_data={
                "rate_limit_type": "five_hour",
                "status": "allowed",
                "resets_at": None,
                "utilization": None,
            },
        )
        await session._handle_event(event)

        assert session._rate_limit_store.get() == []

    @pytest.mark.anyio
    async def test_discards_the_type_from_pending_reconcile(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._rate_limit_pending_reconcile = {"five_hour"}

        event = _make_event(
            type="system",
            subtype="rate_limit",
            message_data={
                "rate_limit_type": "five_hour",
                "status": "allowed_warning",
                "resets_at": None,
                "utilization": 0.9,
            },
        )
        await session._handle_event(event)

        assert session._rate_limit_pending_reconcile == set()

    @pytest.mark.anyio
    async def test_missing_rate_limit_type_is_a_noop(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()

        event = _make_event(type="system", subtype="rate_limit", message_data={"status": "allowed"})
        await session._handle_event(event)  # must not raise

        assert session._rate_limit_store.get() == []


class TestDropUnannouncedRateLimits:
    """The first result of a session drops windows it never re-announced."""

    @pytest.mark.anyio
    async def test_result_drops_a_window_never_reannounced(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._rate_limit_store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.9,
        )
        session._rate_limit_pending_reconcile = {"five_hour"}

        await session._handle_event(_make_event(type="result", subtype="success"))
        assert session._context_refresh_timer is not None
        session._context_refresh_timer.cancel()

        assert session._rate_limit_store.get() == []
        assert session._rate_limit_pending_reconcile == set()

    @pytest.mark.anyio
    async def test_result_keeps_a_window_reannounced_this_session(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._rate_limit_store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.9,
        )
        # Not in pending - as if a rate_limit event already re-announced and discarded it.
        session._rate_limit_pending_reconcile = set()

        await session._handle_event(_make_event(type="result", subtype="success"))
        assert session._context_refresh_timer is not None
        session._context_refresh_timer.cancel()

        assert len(session._rate_limit_store.get()) == 1

    @pytest.mark.anyio
    async def test_result_with_nothing_pending_is_a_noop(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()

        await session._handle_event(_make_event(type="result", subtype="success"))  # must not raise
        assert session._context_refresh_timer is not None
        session._context_refresh_timer.cancel()

        assert session._rate_limit_store.get() == []


# --- _on_permission_mode_changed (hook) ---


class TestOnStateChangedCallbacks:
    """_on_*_changed callbacks emit pipeline events unconditionally; delta detection lives in the runtime, not here."""

    @pytest.mark.anyio
    async def test_on_model_changed_emits_with_previous(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._last_known_model = "claude-sonnet-5"
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        await session._on_model_changed("claude-opus-5")

        assert session._last_known_model == "claude-opus-5"
        session._event_pipeline.inject_event.assert_awaited_once()
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["subtype"] == "model_changed"
        assert call_kwargs["model"] == "claude-opus-5"
        assert call_kwargs["previous_model"] == "claude-sonnet-5"

    @pytest.mark.anyio
    async def test_on_permission_mode_changed_emits_with_previous(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._last_known_permission_mode = "default"
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        await session._on_permission_mode_changed("plan")

        assert session._last_known_permission_mode == "plan"
        session._event_pipeline.inject_event.assert_awaited_once()
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["subtype"] == "permission_mode_changed"
        assert call_kwargs["permission_mode"] == "plan"
        assert call_kwargs["previous_permission_mode"] == "default"

    @pytest.mark.anyio
    async def test_on_effort_level_changed_emits_with_previous(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._last_known_effort_level = "medium"
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        await session._on_effort_level_changed("low")

        assert session._last_known_effort_level == "low"
        session._event_pipeline.inject_event.assert_awaited_once()
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["subtype"] == "effort_level_changed"
        assert call_kwargs["content"] == "low"
        assert call_kwargs["previous_effort_level"] == "medium"

    @pytest.mark.anyio
    async def test_on_model_changed_with_no_prior_baseline(self, tmp_workspace):
        """Even with previous=None, emission proceeds - runtime owns the baseline check."""

        session = _make_session(tmp_workspace)
        # _last_known_model defaults to None
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        await session._on_model_changed("claude-opus-5")

        assert session._last_known_model == "claude-opus-5"
        session._event_pipeline.inject_event.assert_awaited_once()
        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["previous_model"] is None


# --- _handle_init projection replay ---


class TestHandleInitProjectionReplay:
    """Test that _handle_init replays events.jsonl through projection when session.json is missing."""

    @pytest.mark.anyio
    async def test_replays_events_when_no_session_json(self, tmp_workspace):
        """Fork scenario: events.jsonl exists but no session.json - projection is rebuilt."""

        session = _make_session(tmp_workspace)
        session._sdk_client = MagicMock()
        session._sdk_client.set_model = AsyncMock()
        session._sdk_client.set_permission_mode = AsyncMock()
        session._sdk_client.set_effort_level = AsyncMock()

        events = [
            _make_event(is_human=True, content="hello"),
            _make_event(model="claude-sonnet-5", cost_usd=0.01),
            _make_event(is_human=True, content="world"),
        ]

        mock_projection = MagicMock()
        mock_projection.loaded_from_disk = False
        mock_projection.value = SessionSummary(session_id="fork-session", fork_point_cost_usd=0.0)

        mock_pipeline = MagicMock()
        mock_pipeline.get_historical_events.return_value = events
        mock_pipeline.inject_event = AsyncMock()
        session._event_pipeline = mock_pipeline

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=mock_projection,
            ),
        ):
            await session._handle_init("fork-session")

        assert mock_projection.update.call_count == 3
        mock_projection.save.assert_called_once()
        mock_projection.seed_last_result_cost.assert_called_once_with(events)
        # get_historical_events is called twice: once by the replay block, once by container-restart emit.
        assert mock_pipeline.get_historical_events.call_count == 2

    @pytest.mark.anyio
    async def test_counts_only_top_level_user_messages_from_history(self, tmp_workspace):
        """A resumed session continues toward its title from the user messages already sent."""

        session = _make_session(tmp_workspace)
        session._sdk_client = MagicMock()
        mock_projection = MagicMock()
        mock_projection.loaded_from_disk = True
        mock_projection.value = SessionSummary(session_id="resumed", fork_point_cost_usd=0.0)
        mock_pipeline = MagicMock()
        mock_pipeline.get_historical_events.return_value = [
            _make_event(type="user", is_human=True, content="hello"),
            _make_event(type="user", is_human=True, content="nested", parent_tool_use_id="t1"),
            _make_event(type="user", is_human=True, content="world"),
        ]
        mock_pipeline.inject_event = AsyncMock()
        session._event_pipeline = mock_pipeline

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=mock_projection,
            ),
        ):
            await session._handle_init("resumed")

        assert session._user_message_count == 2
        assert session._opening_messages == ["hello", "world"]

    @pytest.mark.anyio
    async def test_skips_replay_when_session_json_exists(self, tmp_workspace):
        """Normal resume: session.json exists - no replay needed."""

        session = _make_session(tmp_workspace)
        session._sdk_client = MagicMock()
        session._sdk_client.set_model = AsyncMock()
        session._sdk_client.set_permission_mode = AsyncMock()
        session._sdk_client.set_effort_level = AsyncMock()

        mock_projection = MagicMock()
        mock_projection.loaded_from_disk = True
        mock_projection.value = SessionSummary(session_id="resume-session", fork_point_cost_usd=0.0)

        mock_pipeline = MagicMock()
        # Empty history keeps the container-restart emit a no-op; replay is what this test asserts on.
        mock_pipeline.get_historical_events.return_value = []
        mock_pipeline.inject_event = AsyncMock()
        session._event_pipeline = mock_pipeline

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=mock_projection,
            ),
        ):
            await session._handle_init("resume-session")

        mock_projection.update.assert_not_called()
        mock_pipeline.inject_event.assert_not_awaited()

    @pytest.mark.anyio
    async def test_no_save_when_events_empty(self, tmp_workspace):
        """Fork with empty events.jsonl - no save triggered."""

        session = _make_session(tmp_workspace)
        session._sdk_client = MagicMock()
        session._sdk_client.set_model = AsyncMock()
        session._sdk_client.set_permission_mode = AsyncMock()
        session._sdk_client.set_effort_level = AsyncMock()

        mock_projection = MagicMock()
        mock_projection.loaded_from_disk = False
        mock_projection.value = SessionSummary(session_id="empty-fork", fork_point_cost_usd=0.0)

        mock_pipeline = MagicMock()
        mock_pipeline.get_historical_events.return_value = []
        session._event_pipeline = mock_pipeline

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=mock_projection,
            ),
        ):
            await session._handle_init("empty-fork")

        mock_projection.update.assert_not_called()
        mock_projection.save.assert_called_once()


# --- _handle_init capability guards ---


class TestHandleInitCapabilityGuards:
    """Persisted model/permission/effort are re-applied only where the runtime allows it.

    A runtime raising (not no-op) must not crash _handle_init, or the session stays connected, never streaming.
    """

    @staticmethod
    def _session_with(tmp_workspace, *, supported: bool) -> tuple[SessionService, MagicMock]:
        """Build a session whose runtime reports uniform capability support."""

        session = _make_session(tmp_workspace)
        session._sdk_client = MagicMock()
        session._sdk_client.capabilities = MagicMock(
            supports_set_model_mid_session=supported,
            supports_set_permission_mode=supported,
            supports_set_effort_level=supported,
        )

        # Unsupported mutation raises rather than no-ops, so an unguarded call fails loud.
        error = NotImplementedError("runtime pins this at construction")
        session._sdk_client.set_model = AsyncMock(side_effect=None if supported else error)
        session._sdk_client.set_permission_mode = AsyncMock(
            side_effect=None if supported else error,
        )
        session._sdk_client.set_effort_level = AsyncMock(side_effect=None if supported else error)

        projection = MagicMock()
        projection.loaded_from_disk = True
        projection.value = SessionSummary(
            session_id="resumed",
            fork_point_cost_usd=0.0,
            model="provider:some-model",
            permission_mode="default",
            effort_level="high",
        )

        pipeline = MagicMock()
        pipeline.get_historical_events.return_value = []
        pipeline.inject_event = AsyncMock()
        session._event_pipeline = pipeline

        return session, projection

    @pytest.mark.anyio
    async def test_skips_setters_the_runtime_does_not_support(self, tmp_workspace):
        session, projection = self._session_with(tmp_workspace, supported=False)

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=projection,
            ),
        ):
            await session._handle_init("resumed")

        session._sdk_client.set_model.assert_not_awaited()  # ty: ignore[unresolved-attribute]
        session._sdk_client.set_permission_mode.assert_not_awaited()  # ty: ignore[unresolved-attribute]
        session._sdk_client.set_effort_level.assert_not_awaited()  # ty: ignore[unresolved-attribute]

        # Nothing applied -> nothing cached, or a later delta-fire would misreport a change that never took effect.
        assert session._last_known_model is None
        assert session._last_known_permission_mode is None
        assert session._last_known_effort_level is None

    @pytest.mark.anyio
    async def test_replays_the_supported_setters_without_waiting(self, tmp_workspace):
        session, projection = self._session_with(tmp_workspace, supported=True)

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=projection,
            ),
        ):
            await session._handle_init("resumed")

        session._sdk_client.set_model.assert_awaited_once_with("provider:some-model", wait=False)  # ty: ignore[unresolved-attribute]
        session._sdk_client.set_permission_mode.assert_awaited_once_with("default", wait=False)  # ty: ignore[unresolved-attribute]
        session._sdk_client.set_effort_level.assert_awaited_once_with("high", wait=False)  # ty: ignore[unresolved-attribute]
        assert session._last_known_model == "provider:some-model"


# --- _handle_init rate-limit reconcile snapshot ---


class TestHandleInitRateLimitSnapshot:
    """At session start, this session's own previously-stored windows are marked unannounced -
    never another session's, since the store is shared across a multi-session container."""

    @pytest.mark.anyio
    async def test_snapshots_this_sessions_own_windows_as_pending(self, tmp_workspace):
        session, projection = TestHandleInitCapabilityGuards._session_with(
            tmp_workspace,
            supported=False,
        )
        session._rate_limit_store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.9,
            session_id="resumed",
        )
        session._rate_limit_store.set(
            "seven_day",
            status="allowed_warning",
            resets_at=None,
            utilization=0.5,
            session_id="resumed",
        )

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=projection,
            ),
        ):
            await session._handle_init("resumed")

        assert session._rate_limit_pending_reconcile == {"five_hour", "seven_day"}

    @pytest.mark.anyio
    async def test_does_not_snapshot_another_sessions_windows(self, tmp_workspace):
        """A shared store must not hand this session another session's window to prune on its
        own first turn."""

        session, projection = TestHandleInitCapabilityGuards._session_with(
            tmp_workspace,
            supported=False,
        )
        session._rate_limit_store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.9,
            session_id="a-different-session",
        )

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=projection,
            ),
        ):
            await session._handle_init("resumed")

        assert session._rate_limit_pending_reconcile == set()

    @pytest.mark.anyio
    async def test_empty_store_snapshots_to_empty_pending(self, tmp_workspace):
        session, projection = TestHandleInitCapabilityGuards._session_with(
            tmp_workspace,
            supported=False,
        )

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=projection,
            ),
        ):
            await session._handle_init("resumed")

        assert session._rate_limit_pending_reconcile == set()


# --- _emit_container_restarted_if_resumed ---


class TestContainerRestartedEmit:
    """_emit_container_restarted_if_resumed fires per the divider behavior matrix."""

    @staticmethod
    def _wire(
        session,
        *,
        historical: list,
        parent_session_id: str | None,
        runtime: str | None = None,
    ):
        """Attach the mocks _emit_container_restarted_if_resumed depends on. `runtime` defaults
        to None (real Claude never stamps it) since a MagicMock auto-attribute would always
        compare unequal to `_expected_runtime_name`."""

        session._event_pipeline = MagicMock()
        session._event_pipeline.get_historical_events = MagicMock(return_value=historical)
        session._event_pipeline.inject_event = AsyncMock()

        session._projection = MagicMock()
        session._projection.value = MagicMock(parent_session_id=parent_session_id, runtime=runtime)

    @pytest.mark.anyio
    async def test_pristine_session_emits_nothing(self, tmp_workspace):
        """No historical events on disk -> no container_restarted event."""

        session = _make_session(tmp_workspace)
        self._wire(session, historical=[], parent_session_id=None)

        await session._emit_container_restarted_if_resumed()

        session._event_pipeline.inject_event.assert_not_awaited()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_restart_no_fork_emits_plain(self, tmp_workspace):
        """Historical events present, no fork ancestry -> emit with message_data=None."""

        session = _make_session(tmp_workspace)
        self._wire(
            session,
            historical=[_make_event(type="user", subtype="message", content="hi")],
            parent_session_id=None,
        )

        await session._emit_container_restarted_if_resumed()

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["event_type"] == "system"
        assert kwargs["subtype"] == "container_restarted"
        assert kwargs["message_data"] is None

    @pytest.mark.anyio
    async def test_fork_first_boot_emits_with_parent(self, tmp_workspace):
        """Historical events + parent_session_id set + no prior fork-tagged restart -> emit with parent payload."""

        session = _make_session(tmp_workspace)
        self._wire(
            session,
            historical=[_make_event(type="user", subtype="message", content="seeded")],
            parent_session_id="parent-abc",
        )

        await session._emit_container_restarted_if_resumed()

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["subtype"] == "container_restarted"
        assert kwargs["message_data"] == {"fork_parent_session_id": "parent-abc"}

    @pytest.mark.anyio
    async def test_fork_subsequent_restart_emits_plain(self, tmp_workspace):
        """Historical events include a prior fork-tagged restart -> next restart emits without payload."""

        session = _make_session(tmp_workspace)
        prior_fork_event = _make_event(
            type="system",
            subtype="container_restarted",
            message_data={"fork_parent_session_id": "parent-abc"},
        )
        self._wire(
            session,
            historical=[prior_fork_event],
            parent_session_id="parent-abc",
        )

        await session._emit_container_restarted_if_resumed()

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["subtype"] == "container_restarted"
        assert kwargs["message_data"] is None

    @pytest.mark.anyio
    async def test_plain_restart_history_does_not_suppress_fork_announce(self, tmp_workspace):
        """Prior plain container_restarted (no fork payload) does NOT mark fork as already announced."""

        session = _make_session(tmp_workspace)
        prior_plain_restart = _make_event(
            type="system",
            subtype="container_restarted",
            message_data=None,
        )
        self._wire(
            session,
            historical=[prior_plain_restart],
            parent_session_id="parent-abc",
        )

        await session._emit_container_restarted_if_resumed()

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["message_data"] == {"fork_parent_session_id": "parent-abc"}

    @pytest.mark.anyio
    async def test_runtime_mismatch_emits_warning_payload(self, tmp_workspace):
        """Persisted runtime differs from the workspace's current agent -> warning payload."""

        session = _make_session(tmp_workspace)
        session._expected_runtime_name = "Claude"
        self._wire(
            session,
            historical=[_make_event(type="user", subtype="message", content="hi")],
            parent_session_id=None,
            runtime="LangGraph",
        )

        await session._emit_container_restarted_if_resumed()

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["message_data"] == {
            "runtime_mismatch": {"persisted": "LangGraph", "expected": "Claude"},
        }

    @pytest.mark.anyio
    async def test_matching_runtime_emits_no_mismatch_payload(self, tmp_workspace):
        """Persisted runtime equals the workspace's current agent -> no mismatch key."""

        session = _make_session(tmp_workspace)
        session._expected_runtime_name = "Claude"
        self._wire(
            session,
            historical=[_make_event(type="user", subtype="message", content="hi")],
            parent_session_id=None,
            runtime="Claude",
        )

        await session._emit_container_restarted_if_resumed()

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["message_data"] is None

    @pytest.mark.anyio
    async def test_fork_and_mismatch_both_present_in_same_payload(self, tmp_workspace):
        """A forked session under a changed runtime carries both keys in one event."""

        session = _make_session(tmp_workspace)
        session._expected_runtime_name = "Claude"
        self._wire(
            session,
            historical=[_make_event(type="user", subtype="message", content="seeded")],
            parent_session_id="parent-abc",
            runtime="LangGraph",
        )

        await session._emit_container_restarted_if_resumed()

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["message_data"] == {
            "fork_parent_session_id": "parent-abc",
            "runtime_mismatch": {"persisted": "LangGraph", "expected": "Claude"},
        }


# --- Constructor kwarg discipline ---


class TestConstructorRejectsUnknownKwargs:
    """Dropping the **kwargs catch-all makes a misnamed callback / unknown kwarg fail loud."""

    def test_misnamed_callback_kwarg_raises_type_error(self, tmp_workspace):
        with pytest.raises(TypeError):
            SessionService(workspace=tmp_workspace, on_session_start=lambda _s: None)  # ty: ignore[unknown-argument]

    def test_unknown_kwarg_raises_type_error(self, tmp_workspace):
        with pytest.raises(TypeError):
            SessionService(workspace=tmp_workspace, port=8080)  # ty: ignore[unknown-argument]


# --- send: inline replies ---


class TestSendInlineReplies:
    """Test the inline-replies branch of SessionService.send."""

    @staticmethod
    def _mock_session(tmp_workspace) -> SessionService:
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._sdk_client = MagicMock()
        session._sdk_client.query = AsyncMock()

        # None avoids a bare MagicMock reading as a finished reader and reconnecting mid-test (checked every call).
        session._sdk_client.stream_health = MagicMock(return_value=None)

        return session

    @pytest.mark.anyio
    async def test_injects_pairs_suppresses_echo_and_queries_serialized_block(self, tmp_workspace):
        session = self._mock_session(tmp_workspace)
        replies = [{"quote": "ctx", "from": "assistant", "response": "how big?"}]

        await session.send("main message", inline_replies=replies)

        inject_kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert inject_kwargs["content"] == "main message"
        assert inject_kwargs["inline_replies"] == replies
        assert inject_kwargs["is_human"] is True
        session._event_pipeline.suppress_user_echo.assert_called_once_with(inject_kwargs["turn_id"])  # ty: ignore[unresolved-attribute]
        query = session._sdk_client.query.call_args  # ty: ignore[unresolved-attribute]
        assert query.kwargs == {"message_uuid": inject_kwargs["turn_id"]}

        blocks = session._sdk_client.query.call_args.args[0]  # ty: ignore[unresolved-attribute]
        text = blocks[0]["text"]
        assert text.startswith("main message\n\n<inline-replies>")
        assert "<response>how big?</response>" in text

    @pytest.mark.anyio
    async def test_empty_batch_no_ops(self, tmp_workspace):
        session = self._mock_session(tmp_workspace)

        await session.send("", inline_replies=[{"quote": "q", "from": "user", "response": "   "}])

        session._event_pipeline.inject_event.assert_not_awaited()  # ty: ignore[unresolved-attribute]
        session._sdk_client.query.assert_not_awaited()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_blank_reply_dropped_but_prompt_still_sends(self, tmp_workspace):
        session = self._mock_session(tmp_workspace)

        await session.send(
            "hello",
            inline_replies=[
                {"quote": "q1", "from": "user", "response": ""},
                {"quote": "q2", "from": "assistant", "response": "keep me"},
            ],
        )

        inject_kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert len(inject_kwargs["inline_replies"]) == 1
        assert inject_kwargs["inline_replies"][0]["response"] == "keep me"
        assert "keep me" in session._sdk_client.query.call_args.args[0][0]["text"]  # ty: ignore[unresolved-attribute]


# --- send: note ---


class TestSendNote:
    """Test the note branch of SessionService.send - a message typed alongside an AskUserQuestion/ExitPlanMode answer."""

    @staticmethod
    def _mock_session(tmp_workspace) -> SessionService:
        return TestSendInlineReplies._mock_session(tmp_workspace)

    @pytest.mark.anyio
    async def test_note_rides_as_sibling_field_and_appends_to_model_text(self, tmp_workspace):
        session = self._mock_session(tmp_workspace)

        await session.send("<answer>React</answer>", note="please also add TypeScript")

        inject_kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert inject_kwargs["content"] == "<answer>React</answer>"
        assert inject_kwargs["note"] == "please also add TypeScript"

        text = session._sdk_client.query.call_args.args[0][0]["text"]  # ty: ignore[unresolved-attribute]
        assert text == "<answer>React</answer>\n\nplease also add TypeScript"

    @pytest.mark.anyio
    async def test_whitespace_only_note_treated_as_absent(self, tmp_workspace):
        session = self._mock_session(tmp_workspace)

        await session.send("hello", note="   ")

        # Stripped to empty, so it skips the note/inline-replies branch, falling through to the plain-prompt path.
        session._event_pipeline.inject_event.assert_not_awaited()  # ty: ignore[unresolved-attribute]
        session._sdk_client.query.assert_awaited_once_with("hello")  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_note_without_prompt_still_sends(self, tmp_workspace):
        session = self._mock_session(tmp_workspace)

        await session.send("", note="add typescript")

        inject_kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert inject_kwargs["content"] == ""
        assert inject_kwargs["note"] == "add typescript"
        assert session._sdk_client.query.call_args.args[0][0]["text"] == "add typescript"  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_note_precedes_inline_replies_in_model_text(self, tmp_workspace):
        session = self._mock_session(tmp_workspace)
        replies = [{"quote": "ctx", "from": "assistant", "response": "how big?"}]

        await session.send("main message", inline_replies=replies, note="a note")

        text = session._sdk_client.query.call_args.args[0][0]["text"]  # ty: ignore[unresolved-attribute]
        assert text.startswith("main message\n\na note\n\n<inline-replies>")


# --- stall watchdog ---


class TestTurnSilenceSeconds:
    """Silence only counts against the runtime while a turn is unanswered."""

    def test_no_turn_in_flight_reports_nothing(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock(last_message_at=None)

        assert session._turn_silence_seconds() is None

    def test_measures_from_dispatch_when_runtime_never_spoke(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock(last_message_at=None)
        session._turn_dispatched_at = time.monotonic() - 30

        assert session._turn_silence_seconds() == pytest.approx(30, abs=1)

    def test_stream_activity_resets_the_clock(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._turn_dispatched_at = time.monotonic() - 300
        session._event_pipeline = MagicMock(last_message_at=time.monotonic() - 2)

        assert session._turn_silence_seconds() == pytest.approx(2, abs=1)


class TestStallWatchdog:
    """Report a runtime that stops feeding events while a turn is still owed an answer."""

    @staticmethod
    def _stalled_session(tmp_workspace, *, last_message_at: float | None = None) -> SessionService:
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock(last_message_at=last_message_at)
        session._turn_dispatched_at = time.monotonic() - SESSION_STALL_TIMEOUT.total_seconds() - 1
        session._logger = MagicMock()
        session.restart = AsyncMock()

        return session

    @pytest.mark.anyio
    async def test_reports_a_silent_turn(self, tmp_workspace):
        session = self._stalled_session(tmp_workspace)

        await self._run_briefly(session)

        session._logger.error.assert_called_once()  # ty: ignore[unresolved-attribute]
        assert session._stall_reported is True

    @pytest.mark.anyio
    async def test_never_restarts_the_session(self, tmp_workspace):
        """Diagnosis only - a long uninterrupted think is silent on the wire too."""

        session = self._stalled_session(tmp_workspace)

        await self._run_briefly(session)

        session.restart.assert_not_awaited()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_reports_once_per_turn(self, tmp_workspace):
        """The watchdog samples continuously; the fault is one event, not one per sample."""

        session = self._stalled_session(tmp_workspace)

        await self._run_briefly(session)
        await self._run_briefly(session)

        session._logger.error.assert_called_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_arming_a_new_turn_re_reports(self, tmp_workspace):
        session = self._stalled_session(tmp_workspace)

        await self._run_briefly(session)

        session._arm_stall_watchdog()
        session._turn_dispatched_at = time.monotonic() - SESSION_STALL_TIMEOUT.total_seconds() - 1

        await self._run_briefly(session)

        assert session._logger.error.call_count == 2  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_idle_session_is_left_alone(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock(last_message_at=None)
        session._logger = MagicMock()

        await self._run_briefly(session)

        session._logger.error.assert_not_called()

    @pytest.mark.anyio
    async def test_recent_stream_activity_is_left_alone(self, tmp_workspace):
        session = self._stalled_session(tmp_workspace, last_message_at=time.monotonic())

        await self._run_briefly(session)

        session._logger.error.assert_not_called()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_running_tool_is_left_alone(self, tmp_workspace):
        """A tool that runs longer than the timeout emits nothing - that is work, not a stall."""

        session = self._stalled_session(tmp_workspace)
        session._tools_outstanding = 1

        await self._run_briefly(session)

        session._logger.error.assert_not_called()  # ty: ignore[unresolved-attribute]

    @staticmethod
    async def _run_briefly(session: SessionService) -> None:
        """Let the watchdog sample a few times, then cancel it."""

        with patch(_CHECK_INTERVAL, timedelta(seconds=0.01)):
            task = asyncio.create_task(session._watch_for_stalls())
            await asyncio.sleep(0.05)
            task.cancel()

            with pytest.raises(asyncio.CancelledError):
                await task


# --- _ensure_stream_healthy ---


class TestEnsureStreamHealthy:
    """Send-path guard reading the runtime's own reader state."""

    @staticmethod
    def _session_with_health(tmp_workspace, health) -> SessionService:
        session = _make_session(tmp_workspace)
        session._sdk_client = MagicMock()
        session._sdk_client.stream_health = MagicMock(return_value=health)
        session.restart = AsyncMock()

        return session

    @pytest.mark.anyio
    async def test_reconnects_a_finished_reader(self, tmp_workspace):
        session = self._session_with_health(
            tmp_workspace,
            StreamHealth(reader_finished=True, buffer_full=False, buffered=7, consumers_waiting=1),
        )
        session._projection = MagicMock(session_id="sess-1")

        await session._ensure_stream_healthy()

        session.restart.assert_awaited_once_with("sess-1")  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_stream_restart_before_init_keeps_the_session_id(self, tmp_workspace):
        """A session the agent never announced has no transcript to resume; it starts again fresh."""

        session = self._session_with_health(
            tmp_workspace,
            StreamHealth(reader_finished=True, buffer_full=False, buffered=0, consumers_waiting=0),
        )
        session._session_id = "start-id"
        session.stop = AsyncMock()
        session.start = AsyncMock()

        await session._ensure_stream_healthy()

        session.restart.assert_not_awaited()  # ty: ignore[unresolved-attribute]
        session.start.assert_awaited_once_with(session_id="start-id")

    @pytest.mark.anyio
    async def test_unavailable_probe_yields_no_verdict(self, tmp_workspace):
        session = self._session_with_health(tmp_workspace, None)

        await session._ensure_stream_healthy()

        session.restart.assert_not_awaited()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_full_buffer_is_reported_not_reconnected(self, tmp_workspace):
        session = self._session_with_health(
            tmp_workspace,
            StreamHealth(
                reader_finished=False,
                buffer_full=True,
                buffered=100,
                consumers_waiting=0,
            ),
        )

        await session._ensure_stream_healthy()

        session.restart.assert_not_awaited()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_no_runtime_is_a_no_op(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session.restart = AsyncMock()

        await session._ensure_stream_healthy()

        session.restart.assert_not_awaited()


class TestSiblingTurnEnds:
    """A spawned session reports each turn end, in order; a session nobody spawned reports none."""

    @staticmethod
    def _session(tmp_workspace, *, spawned: bool):
        reported: list = []

        async def report(session_id, turn):
            reported.append((session_id, turn))

        session = SessionService(workspace=tmp_workspace, report_turn_end=report)
        session._broadcaster = MagicMock(broadcast=AsyncMock(), close=AsyncMock())
        session._projection = MagicMock(flush=AsyncMock())
        session._projection.value.spawned_from_session_id = "parent-1" if spawned else None
        session._projection.update.return_value = False
        session._sdk_client = MagicMock()
        session._turn_end_task = asyncio.create_task(session._send_turn_ends("sib-1"))

        return session, reported

    @staticmethod
    async def _feed(session, *events):
        for event in events:
            await session._handle_event(event)

    @pytest.mark.anyio
    async def test_each_result_reports_that_turns_whole_text(self, tmp_workspace):
        session, reported = self._session(tmp_workspace, spawned=True)

        await self._feed(
            session,
            _make_event(type="user", subtype="message", is_human=True, content="go"),
            _make_event(type="assistant", subtype="text", content="one"),
            _make_event(type="result", subtype="success", turn_id="T1"),
            _make_event(type="assistant", subtype="text", content="two"),
            _make_event(type="result", subtype="success", turn_id="T1"),
        )
        await _until(lambda: len(reported) == 2)

        assert [(sid, turn.outcome, turn.text) for sid, turn in reported] == [
            ("sib-1", "ended", "one"),
            ("sib-1", "ended", "two"),
        ]
        await session._dispose("_turn_end_task", "cancel")

    @pytest.mark.anyio
    async def test_a_session_nobody_spawned_reports_nothing(self, tmp_workspace):
        session, reported = self._session(tmp_workspace, spawned=False)

        await self._feed(
            session,
            _make_event(type="assistant", subtype="text", content="one"),
            _make_event(type="result", subtype="success"),
        )
        await asyncio.sleep(0.05)

        assert reported == []
        await session._dispose("_turn_end_task", "cancel")

    @pytest.mark.anyio
    async def test_a_lost_stream_reports_the_open_turn_as_failed(self, tmp_workspace):
        session, reported = self._session(tmp_workspace, spawned=True)
        await self._feed(session, _make_event(type="assistant", subtype="text", content="half"))

        session._on_stream_lost()
        await _until(lambda: len(reported) == 1)

        assert (reported[0][1].outcome, reported[0][1].text) == ("failed", "half")
        await session._dispose("_turn_end_task", "cancel")

    @pytest.mark.anyio
    async def test_stopping_reports_the_open_turn_as_interrupted_before_it_ends(
        self,
        tmp_workspace,
    ):
        session, reported = self._session(tmp_workspace, spawned=True)
        await self._feed(session, _make_event(type="assistant", subtype="text", content="half"))

        await session.stop()

        assert [(turn.outcome, turn.text) for _, turn in reported] == [("interrupted", "half")]
        assert session._turn_end_task is None

    @pytest.mark.anyio
    async def test_a_report_still_queued_past_the_drain_is_logged(self, tmp_workspace, monkeypatch):
        monkeypatch.setattr(
            "claudebox.agent_session.orchestration.session.SIBLING_TURN_END_DRAIN_SECONDS",
            0.05,
        )

        async def never(_session_id, _turn):
            await asyncio.sleep(3600)

        session, _ = self._session(tmp_workspace, spawned=True)
        session._report_turn_end = never
        await self._feed(session, _make_event(type="assistant", subtype="text", content="x"))

        with patch.object(session._logger, "error") as error:
            await session.stop()

        logged = [call.args[0] for call in error.call_args_list]
        assert "Sibling turn ends not reported before the session stopped" in logged


class TestSiblingMessages:
    """A spawned session's turn end reaches the runtime once, after any running turn; held ones go first."""

    @staticmethod
    def _session(tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        session = SessionService(workspace=tmp_workspace)
        session._session_id = "parent-1"
        session._sdk_client = MagicMock(
            query=AsyncMock(),
            stream_health=MagicMock(return_value=None),
        )
        session._event_pipeline = MagicMock(is_alive=True, set_prompt=MagicMock())

        return session

    @staticmethod
    def _message(delivery_id: str, text: str = "Done."):
        from claudebox.agent_session.orchestration.sibling_turns import SiblingMessage

        return SiblingMessage("sib-1", "lint-fix", "ended", delivery_id, text)

    @pytest.mark.anyio
    async def test_it_is_queried_after_the_turn_under_its_delivery_id(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch)

        await session.deliver_sibling_message(self._message("d1"))
        await session.deliver_sibling_message(self._message("d1"))

        session._sdk_client.query.assert_awaited_once()
        call = session._sdk_client.query.await_args
        assert call.args[0].startswith('<sibling-message session="sib-1" name="lint-fix"')
        assert call.kwargs == {"message_uuid": "d1", "after_turn": True}
        session._event_pipeline.set_prompt.assert_not_called()

    @pytest.mark.anyio
    async def test_held_ones_go_ahead_of_the_next_message_in_order(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        from claudebox.core.io import append_json

        session = self._session(tmp_workspace, monkeypatch)
        held = Workspace(start_dir=tmp_workspace).ensure_session("parent-1").path
        pending = held / "sibling-messages.pending.jsonl"

        for delivery_id in ("d1", "d2"):
            append_json(pending, self._message(delivery_id, f"text {delivery_id}").__dict__)

        await session.send("my own words")

        calls = session._sdk_client.query.await_args_list
        assert [
            c.args[0].splitlines()[1] if c.args[0].startswith("<") else c.args[0] for c in calls
        ] == [
            "text d1",
            "text d2",
            "my own words",
        ]
        assert [c.kwargs.get("after_turn", False) for c in calls] == [False, False, False]
        assert not pending.exists()

    @pytest.mark.anyio
    async def test_held_ones_a_failed_delivery_left_go_again_ahead_of_newer_ones(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        from claudebox.core.io import append_json

        session = self._session(tmp_workspace, monkeypatch)
        pending = (
            Workspace(start_dir=tmp_workspace).ensure_session("parent-1").path
            / "sibling-messages.pending.jsonl"
        )
        append_json(pending, self._message("d1", "text d1").__dict__)
        session._sdk_client.query = AsyncMock(side_effect=[OSError("gone"), None, None, None])

        with pytest.raises(OSError):
            await session.send("first try")

        append_json(pending, self._message("d2", "text d2").__dict__)
        await session.send("second try")

        sent = [c.args[0] for c in session._sdk_client.query.await_args_list[1:]]
        assert [s.splitlines()[1] if s.startswith("<") else s for s in sent] == [
            "text d1",
            "text d2",
            "second try",
        ]
        assert not pending.exists()
        assert not pending.with_name("sibling-messages.pending.jsonl.taking").exists()

    @pytest.mark.anyio
    async def test_held_ones_wait_out_a_send_that_carries_nothing(self, tmp_workspace, monkeypatch):
        from claudebox.core.io import append_json

        session = self._session(tmp_workspace, monkeypatch)
        pending = (
            Workspace(start_dir=tmp_workspace).ensure_session("parent-1").path
            / "sibling-messages.pending.jsonl"
        )
        append_json(pending, self._message("d1").__dict__)

        await session.send("", inline_replies=[{"quote": "q", "response": "  "}])

        session._sdk_client.query.assert_not_awaited()
        assert pending.exists()

    @pytest.mark.anyio
    async def test_held_notes_ride_the_next_message_and_only_that_one(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        from claudebox.core.io import append_json

        session = self._session(tmp_workspace, monkeypatch)
        held = Workspace(start_dir=tmp_workspace).ensure_session("parent-1").path

        for text in ("Port 3000 moved.", "Port 4000 moved."):
            append_json(held / "notes.pending.jsonl", {"text": text})

        await session.send("hello")
        await session.send("again")

        sent = [c.args[0] for c in session._sdk_client.query.await_args_list]
        assert sent == [
            "hello\n\n<system-reminder>\nPort 3000 moved.\nPort 4000 moved.\n</system-reminder>",
            "again",
        ]
        assert not (held / "notes.pending.jsonl").exists()

    @pytest.mark.anyio
    async def test_a_runtime_that_never_connected_refuses_it(self, tmp_workspace, monkeypatch):
        from claudebox.agent_session.orchestration.errors import SessionNotReady

        session = self._session(tmp_workspace, monkeypatch)
        session._runtime_connect_failed = True

        with pytest.raises(SessionNotReady):
            await session.deliver_sibling_message(self._message("d1"))


class TestSiblingBrief:
    """A spawned session is told who started it on its first turn and after each compaction."""

    @staticmethod
    def _session(tmp_workspace, monkeypatch, record: dict | None, *, resumed: bool = False):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        workspace = Workspace(start_dir=tmp_workspace)
        write_json(
            workspace.ensure_session("parent-1").path / "session.json",
            {"session_id": "parent-1", "fork_point_cost_usd": 0.0, "name": "planner"},
        )

        if record is not None:
            write_json(workspace.ensure_session("sib-1").path / "session.json", record)

        session = SessionService(workspace=tmp_workspace)
        session._session_id = "sib-1"
        session._brief_first_message = not resumed
        session._sdk_client = MagicMock(
            query=AsyncMock(),
            stream_health=MagicMock(return_value=None),
        )
        session._event_pipeline = MagicMock(
            is_alive=True,
            get_historical_events=MagicMock(return_value=[]),
        )

        return session

    @staticmethod
    def _sent(session) -> list[str]:
        return [call.args[0] for call in session._sdk_client.query.await_args_list]

    @pytest.mark.anyio
    async def test_a_spawned_sessions_first_message_carries_the_brief_once(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch, {"spawned_from_session_id": "parent-1"})

        await session.send("lint src/")
        await session.send("and tests/")

        first, second = self._sent(session)
        assert first.startswith('lint src/\n\n<system-reminder>\n<sibling-brief session="parent-1"')
        assert "Session planner (parent-1) started this session" in first
        assert "end your turn with the question in plain text" in first
        assert second == "and tests/"
        session._event_pipeline.set_prompt.assert_any_call("lint src/")

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("record", "resumed"),
        [({"spawned_from_session_id": "parent-1"}, True), ({}, False), (None, False)],
    )
    async def test_no_brief_for_a_resumed_or_unspawned_session(
        self,
        tmp_workspace,
        monkeypatch,
        record,
        resumed,
    ):
        session = self._session(tmp_workspace, monkeypatch, record, resumed=resumed)

        await session.send("hello")

        assert self._sent(session) == ["hello"]

    @pytest.mark.anyio
    async def test_the_brief_is_resent_after_compaction_with_the_session_prompt(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(tmp_workspace, monkeypatch, {"spawned_from_session_id": "parent-1"})
        session._projection = MagicMock()
        session._projection.value.session_prompt = "Cite file:line."
        session._projection.update.return_value = False
        session._broadcaster = MagicMock(broadcast=AsyncMock())
        session._event_pipeline.inject_event = AsyncMock()

        await session._on_compact_start(CompactStartPayload(trigger="manual"))
        await session._handle_event(_make_event(type="system", subtype="compact_boundary"))

        (reminder,) = self._sent(session)
        assert reminder.startswith("<system-reminder>\nCite file:line.\n\n<sibling-brief")

    @pytest.mark.anyio
    async def test_a_fork_of_a_spawned_session_is_told_once_the_brief_no_longer_applies(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        session = self._session(
            tmp_workspace,
            monkeypatch,
            {"parent_session_id": "sib-0"},
            resumed=True,
        )
        session._event_pipeline.get_historical_events.return_value = [
            _make_event(
                type="user",
                subtype="message",
                is_human=True,
                content="go\n<sibling-brief x>",
            ),
        ]

        await session.send("now for the user")
        await session.send("again")

        first, second = self._sent(session)
        assert "<sibling-brief-ended>" in first
        assert second == "again"
