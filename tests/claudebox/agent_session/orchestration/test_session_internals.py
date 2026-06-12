"""Tests for claudebox.agent_session.orchestration.session - dispose, projection resolution, state tracking."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.hooks import CompactStartPayload
from claudebox.agent_session.orchestration.models import SessionSummary
from claudebox.agent_session.orchestration.session import SessionService
from ._helpers import make_published_event as _make_event


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

        mock_pipeline.stop.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
        session._event_pipeline = None  # ty: ignore[invalid-assignment]  # Test verifies None-handling for component attrs that are non-Optional in the type but Optional at runtime.

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
                session_id="xyz-789", workspace=session._workspace
            )

    def test_no_active_projection_returns_none(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._projection = None  # ty: ignore[invalid-assignment]  # Test verifies None-handling for component attrs that are non-Optional in the type but Optional at runtime.

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
        session._event_pipeline.inject_event.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert call_kwargs["subtype"] == "compact_start"

    @pytest.mark.anyio
    async def test_trigger_flows_into_pipeline_event(self, tmp_workspace):
        """Translated trigger from runtime adapter reaches the pipeline event's message_data."""

        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._projection = None  # ty: ignore[invalid-assignment]  # Test verifies None-handling for component attrs that are non-Optional in the type but Optional at runtime.

        await session._on_compact_start(CompactStartPayload(trigger="context_limit"))

        assert session._pending_compact_trigger == "context_limit"
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert call_kwargs["message_data"]["compact_metadata"]["trigger"] == "context_limit"

    @pytest.mark.anyio
    async def test_manual_trigger_preserved(self, tmp_workspace):

        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._projection = None  # ty: ignore[invalid-assignment]  # Test verifies None-handling for component attrs that are non-Optional in the type but Optional at runtime.

        await session._on_compact_start(CompactStartPayload(trigger="manual"))

        assert session._pending_compact_trigger == "manual"
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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

        session._event_pipeline.inject_event.assert_not_awaited()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    @pytest.mark.anyio
    async def test_noop_when_pipeline_missing(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = None  # ty: ignore[invalid-assignment]  # Test verifies None-handling for component attrs that are non-Optional in the type but Optional at runtime.
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

        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert call_kwargs["event_type"] == "system"
        assert call_kwargs["subtype"] == "compact_boundary"
        assert call_kwargs["message_data"] == {
            "compact_metadata": {"trigger": "context_limit", "status": "interrupted"},
        }
        # Both pending state slots are cleared after emission
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

        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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

        # Exactly one event injected - interrupt_sent
        session._event_pipeline.inject_event.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert call_kwargs["subtype"] == "interrupt_sent"
        session._sdk_client.interrupt.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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

        # Two injections: interrupt_sent then compact_boundary (fallback)
        assert session._event_pipeline.inject_event.await_count == 2
        subtypes = [
            c.kwargs["subtype"]
            for c in session._event_pipeline.inject_event.await_args_list  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        ]
        assert subtypes == ["interrupt_sent", "compact_boundary"]
        boundary_kwargs = session._event_pipeline.inject_event.await_args_list[
            1
        ].kwargs  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert boundary_kwargs["message_data"]["compact_metadata"]["status"] == "interrupted"
        assert boundary_kwargs["message_data"]["compact_metadata"]["trigger"] == "manual"
        session._sdk_client.interrupt.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    @pytest.mark.anyio
    async def test_no_projection_sets_none(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()
        session._projection = None  # ty: ignore[invalid-assignment]  # Test verifies None-handling for component attrs that are non-Optional in the type but Optional at runtime.

        await session._on_compact_start(CompactStartPayload(trigger="manual"))

        assert session._pending_session_prompt is None

    @pytest.mark.anyio
    async def test_no_session_prompt_sets_none(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        mock_proj = MagicMock()
        mock_proj.value = SessionSummary(
            session_id="s1", fork_point_cost_usd=0.0, session_prompt=None
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
            event
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        session._projection.update.assert_called_once_with(
            event
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        session._projection.schedule_save.assert_called_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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

        session._sdk_client.query.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        query_arg = session._sdk_client.query.call_args.args[
            0
        ]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert "Stay focused on the task" in query_arg
        assert session._pending_session_prompt is None

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

        session._sdk_client.query.assert_not_awaited()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.


# --- _on_permission_mode_changed (hook) ---


class TestOnStateChangedCallbacks:
    """SessionService-side _on_*_changed callbacks emit pipeline events unconditionally.

    Delta detection lives in the runtime - session.py fires only when the
    runtime has confirmed an actual change. These tests cover the
    pipeline-emission shape: previous_* field captured from session's local
    cache, current value passed through.
    """

    @pytest.mark.anyio
    async def test_on_model_changed_emits_with_previous(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._last_known_model = "claude-sonnet-4-6"
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        await session._on_model_changed("claude-opus-4-7")

        assert session._last_known_model == "claude-opus-4-7"
        session._event_pipeline.inject_event.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert call_kwargs["subtype"] == "model_changed"
        assert call_kwargs["model"] == "claude-opus-4-7"
        assert call_kwargs["previous_model"] == "claude-sonnet-4-6"

    @pytest.mark.anyio
    async def test_on_permission_mode_changed_emits_with_previous(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        session._last_known_permission_mode = "default"
        session._event_pipeline = MagicMock()
        session._event_pipeline.inject_event = AsyncMock()

        await session._on_permission_mode_changed("plan")

        assert session._last_known_permission_mode == "plan"
        session._event_pipeline.inject_event.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
        session._event_pipeline.inject_event.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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

        await session._on_model_changed("claude-opus-4-7")

        assert session._last_known_model == "claude-opus-4-7"
        session._event_pipeline.inject_event.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        call_kwargs = (
            session._event_pipeline.inject_event.call_args.kwargs
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
            _make_event(model="claude-sonnet-4-6", cost_usd=0.01),
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

        assert (
            mock_projection.update.call_count == 3
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        mock_projection.save.assert_called_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        # get_historical_events is called twice: once by the replay block, once by container-restart emit.
        assert (
            mock_pipeline.get_historical_events.call_count == 2
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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

        mock_projection.update.assert_not_called()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        mock_pipeline.inject_event.assert_not_awaited()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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

        mock_projection.update.assert_not_called()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        mock_projection.save.assert_called_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.


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

        session._event_pipeline.inject_event.assert_not_awaited()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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

        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert kwargs["message_data"] == {"fork_parent_session_id": "parent-abc"}


# --- Constructor kwarg discipline ---


class TestConstructorRejectsUnknownKwargs:
    """Dropping the **kwargs catch-all makes a misnamed callback / unknown kwarg fail loud."""

    def test_misnamed_callback_kwarg_raises_type_error(self, tmp_workspace):
        with pytest.raises(TypeError):
            SessionService(workspace=tmp_workspace, on_session_start=lambda _s: None)  # ty: ignore[unknown-argument]  # intentional misuse - asserts the runtime TypeError.

    def test_unknown_kwarg_raises_type_error(self, tmp_workspace):
        with pytest.raises(TypeError):
            SessionService(workspace=tmp_workspace, port=8080)  # ty: ignore[unknown-argument]  # intentional misuse - asserts the runtime TypeError.
