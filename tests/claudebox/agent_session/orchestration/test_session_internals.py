"""Tests for claudebox.agent_session.orchestration.session - dispose, projection resolution, state tracking."""

import asyncio
import time
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.catalogs import StreamHealth
from claudebox.agent_session.hooks import CompactStartPayload
from claudebox.agent_session.orchestration.models import SessionSummary
from claudebox.agent_session.orchestration.session import SessionService
from claudebox.constants import SESSION_STALL_TIMEOUT
from ._helpers import make_published_event as _make_event


_CHECK_INTERVAL = "claudebox.agent_session.orchestration.session.SESSION_STALL_CHECK_INTERVAL"


# --- Helpers ---


def _make_session(tmp_workspace) -> SessionService:
    """Create a SessionService with minimal workspace, suitable for testing internal methods."""

    session = SessionService(workspace=tmp_workspace)

    return session


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

        assert session._pending_session_prompt == "Remember: you are a helpful assistant"
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
        session._pending_session_prompt = "carry-over"

        await session._emit_compact_boundary_fallback(status="interrupted")

        call_kwargs = session._event_pipeline.inject_event.call_args.kwargs
        assert call_kwargs["event_type"] == "system"
        assert call_kwargs["subtype"] == "compact_boundary"
        assert call_kwargs["message_data"] == {
            "compact_metadata": {"trigger": "context_limit", "status": "interrupted"},
        }
        assert session._pending_compact_trigger is None
        assert session._pending_session_prompt is None

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
        subtypes = [
            c.kwargs["subtype"] for c in session._event_pipeline.inject_event.await_args_list
        ]
        assert subtypes == ["interrupt_sent", "compact_boundary"]
        boundary_kwargs = session._event_pipeline.inject_event.await_args_list[1].kwargs
        assert boundary_kwargs["message_data"]["compact_metadata"]["status"] == "interrupted"
        assert boundary_kwargs["message_data"]["compact_metadata"]["trigger"] == "manual"
        session._sdk_client.interrupt.assert_awaited_once()

    @pytest.mark.anyio
    async def test_no_projection_sets_none(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._projection = None  # ty: ignore[invalid-assignment]

        await session._on_compact_start(CompactStartPayload(trigger="manual"))

        assert session._pending_session_prompt is None

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

        assert session._pending_session_prompt is None


# --- _handle_event ---


class TestHandleEvent:
    """Test event handler - broadcast + projection update + compact boundary prompt."""

    @pytest.mark.anyio
    async def test_broadcasts_and_updates_projection(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
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
    async def test_compact_boundary_sends_pending_prompt(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._broadcaster = MagicMock()
        session._broadcaster.broadcast = AsyncMock()
        session._projection = MagicMock()
        session._sdk_client = MagicMock()
        session._sdk_client.query = AsyncMock()
        session._pending_session_prompt = "Stay focused on the task"

        event = _make_event(subtype="compact_boundary")
        await session._handle_event(event)

        session._sdk_client.query.assert_awaited_once()
        query_arg = session._sdk_client.query.call_args.args[0]
        assert "Stay focused on the task" in query_arg
        assert session._pending_session_prompt is None

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
        session._pending_session_prompt = None

        event = _make_event(subtype="compact_boundary")
        await session._handle_event(event)

        session._sdk_client.query.assert_not_awaited()


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
        # get_historical_events is called twice: once by the replay block, once by container-restart emit.
        assert mock_pipeline.get_historical_events.call_count == 2

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
    async def test_applies_setters_the_runtime_supports(self, tmp_workspace):
        session, projection = self._session_with(tmp_workspace, supported=True)

        with (
            patch("claudebox.agent_session.orchestration.session.BaseSession"),
            patch(
                "claudebox.agent_session.orchestration.session.Projection",
                return_value=projection,
            ),
        ):
            await session._handle_init("resumed")

        session._sdk_client.set_model.assert_awaited_once_with("provider:some-model")  # ty: ignore[unresolved-attribute]
        session._sdk_client.set_permission_mode.assert_awaited_once_with("default")  # ty: ignore[unresolved-attribute]
        session._sdk_client.set_effort_level.assert_awaited_once_with("high")  # ty: ignore[unresolved-attribute]
        assert session._last_known_model == "provider:some-model"


# --- _emit_container_restarted_if_resumed ---


class TestContainerRestartedEmit:
    """_emit_container_restarted_if_resumed fires per the divider behavior matrix."""

    @staticmethod
    def _wire(session, *, historical: list, parent_session_id: str | None):
        """Attach the mocks _emit_container_restarted_if_resumed depends on."""

        session._event_pipeline = MagicMock()
        session._event_pipeline.get_historical_events = MagicMock(return_value=historical)
        session._event_pipeline.inject_event = AsyncMock()

        session._projection = MagicMock()
        session._projection.value = MagicMock(parent_session_id=parent_session_id)

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
        session._event_pipeline.suppress_next_user_echo.assert_called_once()  # ty: ignore[unresolved-attribute]

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
        session.restart = AsyncMock()  # ty: ignore[invalid-assignment]

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
        session.restart = AsyncMock()  # ty: ignore[invalid-assignment]

        return session

    @pytest.mark.anyio
    async def test_reconnects_a_finished_reader(self, tmp_workspace):
        session = self._session_with_health(
            tmp_workspace,
            StreamHealth(reader_finished=True, buffer_full=False, buffered=7, consumers_waiting=1),
        )

        await session._ensure_stream_healthy()

        session.restart.assert_awaited_once()  # ty: ignore[unresolved-attribute]

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
        session.restart = AsyncMock()  # ty: ignore[invalid-assignment]

        await session._ensure_stream_healthy()

        session.restart.assert_not_awaited()  # ty: ignore[unresolved-attribute]
