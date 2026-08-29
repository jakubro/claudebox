"""Tests for claudebox.agent_session.orchestration.session - send and stop lifecycle."""

import asyncio
import base64
from unittest.mock import AsyncMock, MagicMock

import pytest

from claudebox.agent_session.orchestration.errors import SessionNotReady
from claudebox.agent_session.orchestration.session import SessionService


# --- Helpers ---


def _make_session(tmp_workspace) -> SessionService:
    """Create a SessionService with minimal workspace, suitable for testing internal methods."""

    session = SessionService(workspace=tmp_workspace)

    return session


def _wire_send_dependencies(session, tmp_workspace, *, with_base_session=True):
    """Attach mocked SDK client and pipeline so send() can execute."""

    session._sdk_client = MagicMock()
    session._sdk_client.query = AsyncMock()

    # No verdict from the health probe - a bare MagicMock reads as finished and reconnects mid-test.
    session._sdk_client.stream_health = MagicMock(return_value=None)

    session._event_pipeline = MagicMock()
    session._event_pipeline.inject_event = AsyncMock()
    session._event_pipeline.suppress_next_user_echo = MagicMock()
    session._event_pipeline.set_prompt = MagicMock()

    if with_base_session:
        # Provide a base session with a real path for attachment writes
        mock_base_session = MagicMock()
        mock_base_session.path = tmp_workspace / "session-dir"
        mock_base_session.path.mkdir(parents=True, exist_ok=True)
        session._base_session = mock_base_session


def _wire_broadcast_surface(session, *, subscriber=None):
    """Attach the components stop() disposes, so subscribe() and stop() both run against a started shape."""

    session._broadcaster = MagicMock(close=AsyncMock())
    session._broadcaster.subscribe.return_value = subscriber or ("sub-0", asyncio.Queue())
    session._broadcaster.replay_to = AsyncMock()

    session._event_pipeline = MagicMock()
    session._event_pipeline.stop = AsyncMock()
    session._event_pipeline.get_events.return_value = []

    session._sdk_client = MagicMock()
    session._sdk_client.disconnect = AsyncMock()
    session._projection = MagicMock(flush=AsyncMock())
    session._tool_output = MagicMock()
    session._attachment_service = MagicMock()
    session._summary_cache = MagicMock()


# --- send ---


class TestSendWithAttachments:
    """send() with attachments triggers suppress_next_user_echo on pipeline."""

    @pytest.mark.anyio
    async def test_attachments_suppress_next_user_echo(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        attachments = [
            {
                "name": "photo.png",
                "type": "image/png",
                "data": base64.b64encode(b"fake-png-data").decode(),
            },
        ]

        await session.send("Describe this image", attachments=attachments)

        session._event_pipeline.suppress_next_user_echo.assert_called_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_attachments_inject_synthetic_user_event(self, tmp_workspace):
        """With attachments, a synthetic user event is injected before querying SDK."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        attachments = [
            {
                "name": "doc.pdf",
                "type": "application/pdf",
                "data": base64.b64encode(b"fake-pdf").decode(),
            },
        ]

        await session.send("Summarize this", attachments=attachments)

        session._event_pipeline.inject_event.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        kwargs = session._event_pipeline.inject_event.call_args.kwargs  # ty: ignore[unresolved-attribute]
        assert kwargs["event_type"] == "user"
        assert kwargs["is_human"] is True
        assert kwargs["content"] == "Summarize this"
        assert len(kwargs["attachments"]) == 1
        assert kwargs["attachments"][0]["name"] == "doc.pdf"

    @pytest.mark.anyio
    async def test_attachments_query_sdk_with_content_blocks(self, tmp_workspace):
        """With attachments, SDK is queried with structured content blocks (not plain text)."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        attachments = [
            {
                "name": "img.jpg",
                "type": "image/jpeg",
                "data": base64.b64encode(b"jpeg-bytes").decode(),
            },
        ]

        await session.send("What is this?", attachments=attachments)

        session._sdk_client.query.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        blocks = session._sdk_client.query.call_args.args[0]  # ty: ignore[unresolved-attribute]
        assert isinstance(blocks, list)

    @pytest.mark.anyio
    async def test_attachments_do_not_call_set_prompt(self, tmp_workspace):
        """Attachment path returns early - set_prompt must not be called."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        attachments = [
            {
                "name": "f.txt",
                "type": "text/plain",
                "data": base64.b64encode(b"hello").decode(),
            },
        ]

        await session.send("Read this", attachments=attachments)

        session._event_pipeline.set_prompt.assert_not_called()  # ty: ignore[unresolved-attribute]


class TestSendWithoutAttachments:
    """send() without attachments does NOT trigger suppress_next_user_echo."""

    @pytest.mark.anyio
    async def test_no_attachments_no_suppress(self, tmp_workspace):
        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        await session.send("Hello, Claude")

        session._event_pipeline.suppress_next_user_echo.assert_not_called()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_no_attachments_sets_prompt_and_queries(self, tmp_workspace):
        """Plain text path sets prompt on pipeline then queries SDK with the string."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        await session.send("What time is it?")

        session._event_pipeline.set_prompt.assert_called_once_with("What time is it?")  # ty: ignore[unresolved-attribute]
        session._sdk_client.query.assert_awaited_once_with("What time is it?")  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_empty_attachments_treated_as_no_attachments(self, tmp_workspace):
        """An empty list is falsy - should follow the plain text path."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        await session.send("Hi", attachments=[])

        session._event_pipeline.suppress_next_user_echo.assert_not_called()  # ty: ignore[unresolved-attribute]
        session._event_pipeline.set_prompt.assert_called_once_with("Hi")  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_none_attachments_treated_as_no_attachments(self, tmp_workspace):
        """Explicit None is the default - should follow the plain text path."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace)

        await session.send("Hey", attachments=None)

        session._event_pipeline.suppress_next_user_echo.assert_not_called()  # ty: ignore[unresolved-attribute]
        session._event_pipeline.set_prompt.assert_called_once_with("Hey")  # ty: ignore[unresolved-attribute]


# --- send before init ---


class TestSendBeforeInit:
    """send() before _handle_init has fired (race with SDK boot)."""

    @pytest.mark.anyio
    async def test_plain_prompt_works_before_init(self, tmp_workspace):
        """Plain prompt sends successfully when _base_session is still None."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace, with_base_session=False)

        assert session._base_session is None

        await session.send("hello")

        session._event_pipeline.set_prompt.assert_called_once_with("hello")  # ty: ignore[unresolved-attribute]
        session._sdk_client.query.assert_awaited_once_with("hello")  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_internal_command_works_before_init(self, tmp_workspace):
        """Internal command (/compact) sends successfully when _base_session is still None."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace, with_base_session=False)

        assert session._base_session is None

        await session.send("/compact")

        session._event_pipeline.inject_event.assert_awaited_once()  # ty: ignore[unresolved-attribute]
        session._event_pipeline.set_prompt.assert_called_once_with("/compact")  # ty: ignore[unresolved-attribute]
        session._sdk_client.query.assert_awaited_once_with("/compact")  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_attachment_send_still_asserts_before_init(self, tmp_workspace):
        """Attachment path retains its _base_session guard - the only branch that needs it."""

        session = _make_session(tmp_workspace)
        _wire_send_dependencies(session, tmp_workspace, with_base_session=False)

        assert session._base_session is None

        attachments = [
            {
                "name": "f.txt",
                "type": "text/plain",
                "data": base64.b64encode(b"data").decode(),
            },
        ]

        with pytest.raises(AssertionError, match="no active session"):
            await session.send("hi", attachments=attachments)


# --- stop ---


class TestStopDisposalOrdering:
    """stop() disposes pipeline before client, ensuring clean shutdown ordering."""

    @pytest.mark.anyio
    async def test_pipeline_stopped_before_client_disconnected(self, tmp_workspace):
        session = _make_session(tmp_workspace)

        call_order = []

        mock_pipeline_task = MagicMock()
        mock_pipeline_task.cancel = MagicMock(
            side_effect=lambda: call_order.append("pipeline_task.cancel"),
        )

        async def pipeline_task_await():
            call_order.append("pipeline_task.await")

            raise StopIteration  # will be caught as generic Exception

        mock_pipeline_task.__class__ = type("FakeTask", (), {})
        # Make it look like an asyncio.Task
        import asyncio

        real_task = asyncio.ensure_future(asyncio.sleep(0))
        real_task.cancel()

        try:
            await real_task
        except asyncio.CancelledError:
            pass

        # Use real _dispose logic by wiring mock objects
        mock_pipeline = MagicMock()
        mock_pipeline.stop = AsyncMock(side_effect=lambda: call_order.append("pipeline.stop"))

        mock_client = MagicMock()
        mock_client.disconnect = AsyncMock(
            side_effect=lambda: call_order.append("client.disconnect"),
        )

        original_dispose = session._dispose
        dispose_calls = []

        async def tracking_dispose(member, method):
            dispose_calls.append((member, method))
            await original_dispose(member, method)

        session._dispose = tracking_dispose  # ty: ignore[invalid-assignment]
        session._event_pipeline = mock_pipeline
        session._sdk_client = mock_client
        session._broadcaster = MagicMock(close=AsyncMock())
        session._projection = MagicMock(flush=AsyncMock())
        session._tool_output = MagicMock()
        session._attachment_service = MagicMock()
        session._summary_cache = MagicMock()

        await session.stop()

        assert call_order.index("pipeline.stop") < call_order.index("client.disconnect")

    @pytest.mark.anyio
    async def test_dispose_sequence_matches_expected_order(self, tmp_workspace):
        """stop() calls _dispose in order: tasks first, then components."""

        session = _make_session(tmp_workspace)

        dispose_calls = []

        async def tracking_dispose(member, method):
            dispose_calls.append((member, method))
            # Skip actual disposal to avoid needing real objects
            setattr(session, member, None)

        session._dispose = tracking_dispose  # ty: ignore[invalid-assignment]

        await session.stop()

        assert dispose_calls == [
            ("_stall_watchdog_task", "cancel"),
            ("_pipeline_task", "cancel"),
            ("_client_task", "cancel"),
            ("_event_pipeline", "stop"),
            ("_sdk_client", "disconnect"),
        ]


class TestStopIdempotent:
    """Calling stop() twice must not crash."""

    @pytest.mark.anyio
    async def test_stop_twice_does_not_raise(self, tmp_workspace):
        """Second stop() is a no-op - all members already None after first stop."""

        session = _make_session(tmp_workspace)

        session._event_pipeline = MagicMock()
        session._event_pipeline.stop = AsyncMock()
        session._sdk_client = MagicMock()
        session._sdk_client.disconnect = AsyncMock()
        session._broadcaster = MagicMock(close=AsyncMock())
        session._projection = MagicMock(flush=AsyncMock())
        session._tool_output = MagicMock()
        session._attachment_service = MagicMock()
        session._summary_cache = MagicMock()

        await session.stop()
        # Second call - everything is already None
        await session.stop()

    @pytest.mark.anyio
    async def test_stop_on_fresh_session_does_not_raise(self, tmp_workspace):
        session = _make_session(tmp_workspace)

        await session.stop()


# --- unsubscribe after stop ---


class TestUnsubscribeAfterStop:
    """unsubscribe() must tolerate a None broadcaster without raising."""

    @pytest.mark.anyio
    async def test_unsubscribe_after_stop_is_noop(self, tmp_workspace):
        """After stop() clears _broadcaster, unsubscribe(id) returns silently - no AttributeError."""

        session = _make_session(tmp_workspace)

        session._broadcaster = MagicMock(close=AsyncMock())
        session._event_pipeline = MagicMock()
        session._event_pipeline.stop = AsyncMock()
        session._sdk_client = MagicMock()
        session._sdk_client.disconnect = AsyncMock()
        session._projection = MagicMock(flush=AsyncMock())
        session._tool_output = MagicMock()
        session._attachment_service = MagicMock()
        session._summary_cache = MagicMock()

        await session.stop()

        assert session._broadcaster is None
        result = await session.unsubscribe("any-subscriber-id")
        assert result is None

    @pytest.mark.anyio
    async def test_unsubscribe_on_fresh_session_is_noop(self, tmp_workspace):
        """unsubscribe() on a freshly constructed session is safe - _broadcaster is None from __init__."""

        session = _make_session(tmp_workspace)

        assert session._broadcaster is None
        result = await session.unsubscribe("never-existed")
        assert result is None


# --- subscribe before start / after stop ---


class TestSubscribeReadiness:
    """subscribe() reports a typed not-ready state instead of dereferencing an absent broadcaster."""

    @pytest.mark.anyio
    async def test_subscribe_on_fresh_session_raises_not_ready(self, tmp_workspace):
        """Every container passes through this window: advertised as running, session not yet started."""

        session = _make_session(tmp_workspace)

        assert session._broadcaster is None

        with pytest.raises(SessionNotReady):
            await session.subscribe()

    @pytest.mark.anyio
    async def test_subscribe_after_stop_raises_not_ready(self, tmp_workspace):
        """The post-stop window reports the same typed state as the pre-start one."""

        session = _make_session(tmp_workspace)
        _wire_broadcast_surface(session)

        await session.stop()

        with pytest.raises(SessionNotReady):
            await session.subscribe()

    @pytest.mark.anyio
    async def test_subscribe_while_started_replays_history(self, tmp_workspace):
        """The guard leaves the started path intact - subscriber and queue come back, history replays."""

        session = _make_session(tmp_workspace)
        queue = asyncio.Queue()
        _wire_broadcast_surface(session, subscriber=("sub-1", queue))

        subscriber_id, returned = await session.subscribe()

        assert subscriber_id == "sub-1"
        assert returned is queue
        session._broadcaster.replay_to.assert_awaited_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_subscribe_replay_false_skips_the_replay(self, tmp_workspace):
        """A caller that already read the persisted log wants only what arrives from here on -
        a replay would repeat events under ids the restart-reset counter has already used."""

        session = _make_session(tmp_workspace)
        queue = asyncio.Queue()
        _wire_broadcast_surface(session, subscriber=("sub-1", queue))

        subscriber_id, returned = await session.subscribe(replay=False)

        assert subscriber_id == "sub-1"
        assert returned is queue
        session._broadcaster.replay_to.assert_not_awaited()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_ensure_ready_tracks_the_session_lifecycle(self, tmp_workspace):
        """Not ready before start, ready while started, not ready again after stop."""

        session = _make_session(tmp_workspace)

        with pytest.raises(SessionNotReady):
            session.ensure_ready()

        _wire_broadcast_surface(session)
        session.ensure_ready()

        await session.stop()

        with pytest.raises(SessionNotReady):
            session.ensure_ready()
