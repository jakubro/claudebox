"""Tests for claudebox.agent_session.runtime_claude - ClaudeRuntime composition adapter."""

import asyncio
import json
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.config import ClaudeAgentSessionConfig, RuntimeCapabilities
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_claude import ClaudeRuntime


# Helpers
# --------------------------------------------------------------------------------------------------


def _make_config(**overrides) -> ClaudeAgentSessionConfig:
    """Build a minimal ClaudeAgentSessionConfig for tests; overrides spread on top."""

    defaults: dict = {
        "runtime": "claude",
        "model": None,
        "permission_mode": None,
        "effort_level": None,
        "cwd": "/tmp",
        "env": {},
        "session_id": None,
        "resume_session_id": None,
        "session_dir": Path("/tmp"),
        "hooks": HookCallbacks(),
    }
    defaults.update(overrides)

    return ClaudeAgentSessionConfig(**defaults)


def _make_runtime(**config_overrides) -> ClaudeRuntime:
    """Build a ClaudeRuntime with mocked SDK to avoid real connection."""

    config = _make_config(**config_overrides)

    with patch(
        "claudebox.agent_session.runtime_claude.BaseClaudeSDKClient",
        autospec=True,
    ):
        return ClaudeRuntime(config)


# __init__
# --------------------------------------------------------------------------------------------------


class TestInit:
    """ClaudeRuntime initialization state."""

    def test_ready_event_starts_unset(self):
        """Ready event is not set on fresh runtime."""

        runtime = _make_runtime()
        assert not runtime.ready.is_set()

    def test_buffer_starts_empty(self):
        """Message buffer is empty on fresh runtime."""

        runtime = _make_runtime()
        assert len(runtime._buffer) == 0

    def test_pending_calls_starts_empty(self):
        """Pending calls deque is empty on fresh runtime."""

        runtime = _make_runtime()
        assert len(runtime._pending_calls) == 0

    def test_stderr_callback_wired_into_sdk_options(self):
        """Options.stderr is wired to the runtime's _stderr method before SDK construction."""

        captured: dict = {}

        def _capture(options):
            captured["stderr"] = options.stderr

            return MagicMock()

        with patch(
            "claudebox.agent_session.runtime_claude.BaseClaudeSDKClient",
            side_effect=_capture,
        ):
            runtime = ClaudeRuntime(_make_config())

        assert captured["stderr"].__func__ is ClaudeRuntime._stderr
        assert captured["stderr"].__self__ is runtime


# Composition smoke
# --------------------------------------------------------------------------------------------------


class TestComposition:
    """ClaudeRuntime wraps BaseClaudeSDKClient via composition - never subclasses."""

    def test_holds_sdk_via_composition(self):
        """_sdk attribute exists and is the SDK client instance, not self."""

        runtime = _make_runtime()
        assert hasattr(runtime, "_sdk")
        assert runtime._sdk is not runtime

    def test_is_not_a_subclass_of_sdk(self):
        """Composition over inheritance - runtime is not a BaseClaudeSDKClient."""

        from claude_agent_sdk import ClaudeSDKClient as BaseClaudeSDKClient

        assert not isinstance(_make_runtime(), BaseClaudeSDKClient)
        assert not issubclass(ClaudeRuntime, BaseClaudeSDKClient)


# Capabilities + identity
# --------------------------------------------------------------------------------------------------


class TestCapabilitiesAndIdentity:
    """ClaudeRuntime exposes the 16-flag capability matrix and runtime_name."""

    def test_runtime_name(self):
        """runtime_name is 'Claude'."""

        assert ClaudeRuntime.runtime_name == "Claude"
        assert _make_runtime().runtime_name == "Claude"

    def test_capabilities_returns_all_true(self):
        """Every capability flag is True under ClaudeRuntime."""

        caps = _make_runtime().capabilities
        assert isinstance(caps, RuntimeCapabilities)

        for field_name in RuntimeCapabilities.__dataclass_fields__:
            assert getattr(caps, field_name) is True, f"{field_name} should be True"


# query (buffering vs direct send)
# --------------------------------------------------------------------------------------------------


class TestQuery:
    """Query dispatching and buffering."""

    @pytest.mark.anyio
    async def test_buffers_string_when_not_ready(self):
        """String queries are buffered when runtime is not ready."""

        runtime = _make_runtime()
        await runtime.query("hello")
        assert list(runtime._buffer) == ["hello"]

    @pytest.mark.anyio
    async def test_buffers_content_blocks_when_not_ready(self):
        """Structured content block queries are buffered when runtime is not ready."""

        runtime = _make_runtime()
        blocks = [{"type": "text", "text": "hi"}]
        await runtime.query(blocks)
        assert list(runtime._buffer) == [blocks]

    @pytest.mark.anyio
    async def test_buffer_preserves_order(self):
        """Multiple buffered queries maintain FIFO order."""

        runtime = _make_runtime()
        await runtime.query("first")
        await runtime.query("second")
        await runtime.query("third")
        assert list(runtime._buffer) == ["first", "second", "third"]

    @pytest.mark.anyio
    async def test_string_query_delegates_to_sdk_when_ready(self):
        """String query forwards to self._sdk.query when ready."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock) as mock_query:
            await runtime.query("hello")
            mock_query.assert_awaited_once_with("hello")

    @pytest.mark.anyio
    async def test_content_blocks_query_delegates_to_sdk_when_ready(self):
        """Content block query wraps in stream and forwards when ready."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock) as mock_query:
            blocks = [{"type": "text", "text": "hi"}]
            await runtime.query(blocks)
            mock_query.assert_awaited_once()

            # Argument should be an async iterator, not the raw list.
            arg = mock_query.call_args[0][0]
            assert arg is not blocks


# interrupt
# --------------------------------------------------------------------------------------------------


class TestInterrupt:
    """Interrupt behavior - clears buffer pre-ready, forwards post-ready."""

    @pytest.mark.anyio
    async def test_clears_buffer_when_not_ready(self):
        """Interrupt clears buffered queries when not connected."""

        runtime = _make_runtime()
        await runtime.query("a")
        await runtime.query("b")
        assert len(runtime._buffer) == 2

        await runtime.interrupt()
        assert len(runtime._buffer) == 0

    @pytest.mark.anyio
    async def test_delegates_when_ready(self):
        """Interrupt forwards to self._sdk.interrupt when ready."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "interrupt", new_callable=AsyncMock) as mock_interrupt:
            await runtime.interrupt()
            mock_interrupt.assert_awaited_once()


# set_model
# --------------------------------------------------------------------------------------------------


class TestSetModel:
    """set_model queueing and dispatching."""

    @pytest.mark.anyio
    async def test_queued_when_not_ready(self):
        """set_model is queued as pending call when not connected."""

        runtime = _make_runtime()
        await runtime.set_model("claude-3-opus")
        assert len(runtime._pending_calls) == 1
        method, args, _ = runtime._pending_calls[0]
        assert method == "set_model"
        assert args == ("claude-3-opus",)

    @pytest.mark.anyio
    async def test_delegates_when_ready(self):
        """set_model forwards to self._sdk.set_model when ready."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "set_model", new_callable=AsyncMock) as mock_set_model:
            await runtime.set_model("claude-3-opus")
            mock_set_model.assert_awaited_once_with("claude-3-opus")


# set_permission_mode
# --------------------------------------------------------------------------------------------------


class TestSetPermissionMode:
    """set_permission_mode queueing and dispatching."""

    @pytest.mark.anyio
    async def test_queued_when_not_ready(self):
        """set_permission_mode is queued as pending call when not connected."""

        runtime = _make_runtime()
        await runtime.set_permission_mode("auto")
        assert len(runtime._pending_calls) == 1
        method, args, _ = runtime._pending_calls[0]
        assert method == "set_permission_mode"
        assert args == ("auto",)

    @pytest.mark.anyio
    async def test_delegates_when_ready(self):
        """set_permission_mode forwards to self._sdk.set_permission_mode when ready."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(
            runtime._sdk,
            "set_permission_mode",
            new_callable=AsyncMock,
        ) as mock_set_perm:
            await runtime.set_permission_mode("auto")
            mock_set_perm.assert_awaited_once_with("auto")


# set_effort_level
# --------------------------------------------------------------------------------------------------


class TestSetEffortLevel:
    """set_effort_level queueing and side-channel write."""

    @pytest.mark.anyio
    async def test_queued_when_not_ready(self):
        """set_effort_level is queued as pending call when not connected."""

        runtime = _make_runtime()
        await runtime.set_effort_level("high")
        assert len(runtime._pending_calls) == 1
        method, args, _ = runtime._pending_calls[0]
        assert method == "set_effort_level"
        assert args == ("high",)

    @pytest.mark.anyio
    async def test_writes_settings_json_when_ready(self):
        """set_effort_level writes effortLevel to settings.json when ready."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(ClaudeRuntime, "_write_effort_to_settings") as mock_write:
            await runtime.set_effort_level("high")
            mock_write.assert_called_once_with("high")


# connect / disconnect
# --------------------------------------------------------------------------------------------------


class TestGetContextUsage:
    """get_context_usage maps SDK dict shape to typed ContextUsage."""

    @pytest.mark.anyio
    async def test_returns_none_when_not_ready(self):
        """get_context_usage returns None before connect."""

        runtime = _make_runtime()
        result = await runtime.get_context_usage()
        assert result is None

    @pytest.mark.anyio
    async def test_returns_none_on_empty_sdk_response(self):
        """SDK returns {} -> get_context_usage returns None (no data signal)."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "get_context_usage", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {}
            result = await runtime.get_context_usage()

        assert result is None

    @pytest.mark.anyio
    async def test_returns_none_when_keys_missing(self):
        """SDK returns partial dict -> None (treat as no data; no fabricated 0s)."""

        from claudebox.agent_session.catalogs import ContextUsage

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "get_context_usage", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"totalTokens": 100}  # maxTokens missing
            result = await runtime.get_context_usage()

        assert result is None

        with patch.object(runtime._sdk, "get_context_usage", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"maxTokens": 200}  # totalTokens missing
            result = await runtime.get_context_usage()

        assert result is None

    @pytest.mark.anyio
    async def test_maps_sdk_dict_to_context_usage(self):
        """SDK {totalTokens, maxTokens} -> ContextUsage(used_tokens, max_tokens)."""

        from claudebox.agent_session.catalogs import ContextUsage

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "get_context_usage", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"totalTokens": 12345, "maxTokens": 200000}
            result = await runtime.get_context_usage()

        assert isinstance(result, ContextUsage)
        assert result.used_tokens == 12345
        assert result.max_tokens == 200000


class TestConnect:
    """Connection lifecycle - ready event + flush task."""

    @pytest.mark.anyio
    async def test_sets_ready_event(self):
        """connect sets the ready event after self._sdk.connect returns."""

        runtime = _make_runtime()

        with (
            patch.object(runtime._sdk, "connect", new_callable=AsyncMock),
            patch.object(ClaudeRuntime, "_isolate_settings_file"),
        ):
            await runtime.connect()

        assert runtime.ready.is_set()

    @pytest.mark.anyio
    async def test_creates_flush_task(self):
        """connect creates a flush task."""

        runtime = _make_runtime()

        with (
            patch.object(runtime._sdk, "connect", new_callable=AsyncMock),
            patch.object(ClaudeRuntime, "_isolate_settings_file"),
        ):
            await runtime.connect()

        assert runtime._flush_task is not None

    @pytest.mark.anyio
    async def test_isolates_settings_file_before_sdk_connect(self):
        """connect runs _isolate_settings_file before self._sdk.connect."""

        runtime = _make_runtime()

        order: list[str] = []

        with (
            patch.object(
                runtime._sdk,
                "connect",
                new_callable=AsyncMock,
                side_effect=lambda: order.append("sdk_connect"),
            ),
            patch.object(
                ClaudeRuntime,
                "_isolate_settings_file",
                side_effect=lambda *args, **kw: order.append("isolate"),
            ),
        ):
            await runtime.connect()

        assert order == ["isolate", "sdk_connect"]


class TestDisconnect:
    """Disconnect cleanup - clears state, cancels flush task."""

    @pytest.mark.anyio
    async def test_clears_ready_event(self):
        """disconnect clears the ready event."""

        runtime = _make_runtime()
        runtime.ready.set()

        with patch.object(runtime._sdk, "disconnect", new_callable=AsyncMock):
            await runtime.disconnect()

        assert not runtime.ready.is_set()

    @pytest.mark.anyio
    async def test_clears_buffer(self):
        """disconnect empties the message buffer."""

        runtime = _make_runtime()
        runtime._buffer.append("leftover")

        with patch.object(runtime._sdk, "disconnect", new_callable=AsyncMock):
            await runtime.disconnect()

        assert len(runtime._buffer) == 0

    @pytest.mark.anyio
    async def test_clears_pending_calls(self):
        """disconnect empties pending calls."""

        runtime = _make_runtime()
        runtime._pending_calls.append(("set_model", ("m",), {}))

        with patch.object(runtime._sdk, "disconnect", new_callable=AsyncMock):
            await runtime.disconnect()

        assert len(runtime._pending_calls) == 0

    @pytest.mark.anyio
    async def test_cancels_flush_task(self):
        """disconnect cancels any running flush task."""

        runtime = _make_runtime()
        runtime._flush_task = asyncio.create_task(asyncio.sleep(999))

        with patch.object(runtime._sdk, "disconnect", new_callable=AsyncMock):
            await runtime.disconnect()

        assert runtime._flush_task is None

    @pytest.mark.anyio
    async def test_cleanup_runs_even_if_sdk_raises(self):
        """Buffer and ready state are cleaned up even if self._sdk.disconnect raises."""

        runtime = _make_runtime()
        runtime.ready.set()
        runtime._buffer.append("msg")
        runtime._pending_calls.append(("set_model", ("m",), {}))

        with patch.object(
            runtime._sdk,
            "disconnect",
            new_callable=AsyncMock,
            side_effect=RuntimeError("disconnect failed"),
        ):
            with pytest.raises(RuntimeError, match="disconnect failed"):
                await runtime.disconnect()

        assert not runtime.ready.is_set()
        assert len(runtime._buffer) == 0
        assert len(runtime._pending_calls) == 0


# _flush_on_ready
# --------------------------------------------------------------------------------------------------


class TestFlushOnReady:
    """Buffered message + pending call flushing after ready."""

    @pytest.mark.anyio
    async def test_flushes_pending_calls_before_queries(self):
        """Pending SDK calls (e.g. set_model) are replayed before buffered queries."""

        runtime = _make_runtime()
        runtime._pending_calls.append(("set_model", ("claude-3",), {}))
        runtime._buffer.append("hello")

        call_order: list[tuple[str, str]] = []

        async def track_set_model(model):
            call_order.append(("set_model", model))

        async def track_query(prompt):
            call_order.append(("query", prompt))

        with (
            patch.object(
                runtime._sdk,
                "set_model",
                new_callable=AsyncMock,
                side_effect=track_set_model,
            ),
            patch.object(
                runtime._sdk,
                "query",
                new_callable=AsyncMock,
                side_effect=track_query,
            ),
        ):
            runtime.ready.set()
            await runtime._flush_on_ready()

        assert call_order == [("set_model", "claude-3"), ("query", "hello")]

    @pytest.mark.anyio
    async def test_flushes_queries_in_order(self):
        """Buffered queries are flushed in FIFO order."""

        runtime = _make_runtime()
        runtime._buffer.extend(["first", "second", "third"])

        flushed: list[str] = []

        async def track_query(prompt):
            flushed.append(prompt)

        with patch.object(
            runtime._sdk,
            "query",
            new_callable=AsyncMock,
            side_effect=track_query,
        ):
            runtime.ready.set()
            await runtime._flush_on_ready()

        assert flushed == ["first", "second", "third"]

    @pytest.mark.anyio
    async def test_empties_buffer_after_flush(self):
        """Buffer is empty after flush completes."""

        runtime = _make_runtime()
        runtime._buffer.append("msg")

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock):
            runtime.ready.set()
            await runtime._flush_on_ready()

        assert len(runtime._buffer) == 0
        assert len(runtime._pending_calls) == 0

    @pytest.mark.anyio
    async def test_multiple_pending_calls_replayed(self):
        """Multiple pending calls are replayed in order."""

        runtime = _make_runtime()
        runtime._pending_calls.append(("set_model", ("m1",), {}))
        runtime._pending_calls.append(("set_permission_mode", ("auto",), {}))

        call_order: list[tuple[str, str]] = []

        async def track_set_model(model):
            call_order.append(("set_model", model))

        async def track_set_perm(mode):
            call_order.append(("set_permission_mode", mode))

        with (
            patch.object(
                runtime._sdk,
                "set_model",
                new_callable=AsyncMock,
                side_effect=track_set_model,
            ),
            patch.object(
                runtime._sdk,
                "set_permission_mode",
                new_callable=AsyncMock,
                side_effect=track_set_perm,
            ),
        ):
            runtime.ready.set()
            await runtime._flush_on_ready()

        assert call_order == [("set_model", "m1"), ("set_permission_mode", "auto")]


# _stderr log routing
# --------------------------------------------------------------------------------------------------


class TestStderr:
    """SDK stderr log line parsing."""

    def test_parses_info_level(self):
        """Standard info-level log line is routed at INFO level."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("2024-01-01T00:00:00Z [info] some message")
        logger.log.assert_called_once()
        assert logger.log.call_args[0][0] == logging.INFO

    def test_parses_warn_level(self):
        """Warning-level log line is routed at WARNING level."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("2024-01-01T00:00:00Z [warning] be careful")
        logger.log.assert_called_once()
        assert logger.log.call_args[0][0] == logging.WARNING

    def test_parses_error_level(self):
        """Error-level log line is routed at ERROR level."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("2024-01-01T00:00:00Z [error] something broke")
        logger.log.assert_called_once()
        assert logger.log.call_args[0][0] == logging.ERROR

    def test_parses_debug_level(self):
        """Debug-level log line is routed at DEBUG level."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("2024-01-01T00:00:00Z [debug] detail")
        logger.log.assert_called_once()
        assert logger.log.call_args[0][0] == logging.DEBUG

    def test_unknown_level_defaults_to_info(self):
        """Unknown log level falls back to INFO."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("2024-01-01T00:00:00Z [custom] something")
        logger.log.assert_called_once()
        assert logger.log.call_args[0][0] == logging.INFO

    def test_unparseable_line_logged_as_info(self):
        """Lines without expected structure are logged at INFO via logger.info."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("no-spaces-here")
        logger.info.assert_called_once()

    def test_message_with_spaces_preserved(self):
        """Multi-word message after level is preserved intact."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("2024-01-01T00:00:00Z [info] multi word message here")
        logger.log.assert_called_once()
        assert logger.log.call_args[0][0] == logging.INFO

    def test_parsed_line_tagged_with_agent_source_and_stderr_stream(self):
        """Parsed SDK log lines carry source='agent' / stream='stderr' kvs for downstream multiplex."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("2024-01-01T00:00:00Z [warning] careful")
        kwargs = logger.log.call_args.kwargs
        assert kwargs.get("source") == "agent"
        assert kwargs.get("stream") == "stderr"

    def test_unparseable_line_tagged_with_agent_source_and_stderr_stream(self):
        """Unparseable lines also carry source/stream kvs (via logger.info)."""

        runtime = _make_runtime()
        logger = MagicMock()
        runtime._logger = logger

        runtime._stderr("no-spaces-here")
        kwargs = logger.info.call_args.kwargs
        assert kwargs.get("source") == "agent"
        assert kwargs.get("stream") == "stderr"


# _content_blocks_stream
# --------------------------------------------------------------------------------------------------


class TestContentBlocksStream:
    """Content block stream wrapping for the SDK's async-iterable path."""

    @pytest.mark.anyio
    async def test_yields_transport_message(self):
        """Stream yields a single transport message wrapping the content blocks."""

        blocks = [{"type": "text", "text": "hello"}]
        messages = []

        async for msg in ClaudeRuntime._content_blocks_stream(blocks):
            messages.append(msg)

        assert len(messages) == 1
        assert messages[0] == {
            "type": "user",
            "message": {"role": "user", "content": blocks},
            "parent_tool_use_id": None,
        }

    @pytest.mark.anyio
    async def test_preserves_content_blocks(self):
        """Content blocks in the yielded message are the exact input list."""

        blocks = [{"type": "image", "url": "http://x"}, {"type": "text", "text": "y"}]

        async for msg in ClaudeRuntime._content_blocks_stream(blocks):
            assert msg["message"]["content"] is blocks


# _write_effort_to_settings
# --------------------------------------------------------------------------------------------------


class TestWriteEffortToSettings:
    """settings.json effort level writing."""

    def test_creates_file_when_missing(self, tmp_path):
        """Creates settings.json with effortLevel when file doesn't exist."""

        settings_path = tmp_path / ".claude" / "settings.json"

        with patch(
            "claudebox.agent_session.runtime_claude.claude_settings_file",
            lambda: settings_path,
        ):
            ClaudeRuntime._write_effort_to_settings("high")

        result = json.loads(settings_path.read_text())
        assert result["effortLevel"] == "high"

    def test_preserves_existing_keys(self, tmp_path):
        """Merges effortLevel without overwriting other settings."""

        settings_path = tmp_path / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True)
        settings_path.write_text(json.dumps({"theme": "dark", "effortLevel": "low"}))

        with patch(
            "claudebox.agent_session.runtime_claude.claude_settings_file",
            lambda: settings_path,
        ):
            ClaudeRuntime._write_effort_to_settings("max")

        result = json.loads(settings_path.read_text())
        assert result["effortLevel"] == "max"
        assert result["theme"] == "dark"

    def test_handles_corrupt_json(self, tmp_path):
        """Overwrites corrupt settings.json with valid content."""

        settings_path = tmp_path / ".claude" / "settings.json"
        settings_path.parent.mkdir(parents=True)
        settings_path.write_text("{invalid json")

        with patch(
            "claudebox.agent_session.runtime_claude.claude_settings_file",
            lambda: settings_path,
        ):
            ClaudeRuntime._write_effort_to_settings("medium")

        result = json.loads(settings_path.read_text())
        assert result["effortLevel"] == "medium"


# _isolate_settings_file
# --------------------------------------------------------------------------------------------------


class TestIsolateSettingsFile:
    """Per-session settings.json isolation via symlink to {session_dir}/claude.json."""

    @staticmethod
    def _settings_paths(tmp_workspace):
        """Return (claude_dir, settings_path) for the fake home set up by the fixture."""

        home = Path.home()
        claude_dir = home / ".claude"
        claude_dir.mkdir(parents=True, exist_ok=True)

        return claude_dir, claude_dir / "settings.json"

    @staticmethod
    def _runtime_for_session_dir(session_dir) -> ClaudeRuntime:
        """Build ClaudeRuntime with session_dir set; SDK construction mocked."""

        session_dir.mkdir(parents=True, exist_ok=True)

        return _make_runtime(session_dir=session_dir)

    def test_first_start_seeds_from_profile_settings(self, tmp_workspace):
        """settings.json present as regular file -> copied to claude.json + symlinked."""

        _, settings_path = self._settings_paths(tmp_workspace)
        settings_path.write_text('{"effort": "high"}')

        runtime = self._runtime_for_session_dir(tmp_workspace / "sessions" / "session-1")
        runtime._isolate_settings_file()

        assert settings_path.is_symlink()
        target = settings_path.resolve()
        assert target.read_text() == '{"effort": "high"}'
        assert target.name == "claude.json"

    def test_resume_preserves_existing_claude_json(self, tmp_workspace):
        """If {session_dir}/claude.json already exists, its content is NOT overwritten."""

        _, settings_path = self._settings_paths(tmp_workspace)
        settings_path.write_text('{"effort": "stale-from-profile"}')

        runtime = self._runtime_for_session_dir(tmp_workspace / "sessions" / "session-1")
        runtime._isolate_settings_file()

        # Simulate runtime change: SDK writes new content via the symlink.
        settings_path.write_text('{"effort": "max"}')

        # Container restart: container-start.sh overwrites settings.json with profile.
        if settings_path.is_symlink():
            settings_path.unlink()

        settings_path.write_text('{"effort": "stale-from-profile"}')

        # Second isolate (resume): runtime change must be preserved.
        runtime._isolate_settings_file()

        target = settings_path.resolve()
        assert target.read_text() == '{"effort": "max"}'

    def test_no_source_settings_creates_empty_claude_json(self, tmp_workspace):
        """No settings.json present -> empty claude.json + symlink (SDK uses defaults)."""

        _, settings_path = self._settings_paths(tmp_workspace)

        if settings_path.exists() or settings_path.is_symlink():
            settings_path.unlink()

        runtime = self._runtime_for_session_dir(tmp_workspace / "sessions" / "session-1")
        runtime._isolate_settings_file()

        assert settings_path.is_symlink()
        target = settings_path.resolve()
        assert target.exists()
        assert target.read_text() == ""

    def test_replaces_stale_symlink(self, tmp_workspace):
        """Stale symlink from a previous session is unlinked before re-binding."""

        _, settings_path = self._settings_paths(tmp_workspace)
        settings_path.write_text('{"effort": "first"}')

        runtime_a = self._runtime_for_session_dir(tmp_workspace / "sessions" / "session-1")
        runtime_a._isolate_settings_file()
        target_a = settings_path.resolve()

        # Second runtime in same container - stale symlink points at session-1's file.
        runtime_b = self._runtime_for_session_dir(tmp_workspace / "sessions" / "session-2")
        runtime_b._isolate_settings_file()
        target_b = settings_path.resolve()

        assert target_a != target_b

    def test_cross_session_isolation(self, tmp_workspace):
        """Two sessions in the same workspace get independent per-session files."""

        _, settings_path = self._settings_paths(tmp_workspace)
        settings_path.write_text('{"effort": "high"}')

        runtime_a = self._runtime_for_session_dir(tmp_workspace / "sessions" / "session-a")
        runtime_a._isolate_settings_file()
        target_a = settings_path.resolve()

        # Simulate session A writing a runtime change through the symlink.
        target_a.write_text('{"effort": "max"}')

        # Re-create the regular settings.json (mimics a parallel container's
        # container-start.sh seed) before session B's isolation runs.
        if settings_path.is_symlink():
            settings_path.unlink()

        settings_path.write_text('{"effort": "high"}')

        runtime_b = self._runtime_for_session_dir(tmp_workspace / "sessions" / "session-b")
        runtime_b._isolate_settings_file()
        target_b = settings_path.resolve()

        # Sessions A and B point at different per-session files.
        assert target_a != target_b

        # Session A's runtime state survives - config flips do not bleed.
        assert target_a.read_text() == '{"effort": "max"}'

    def test_fork_inherits_parent_runtime_config(self, tmp_workspace):
        """Fork in same container -> seeds from parent's symlinked target -> inherits parent runtime config."""

        _, settings_path = self._settings_paths(tmp_workspace)
        settings_path.write_text('{"effort": "high"}')

        # Parent session starts and flips its runtime config to "max".
        runtime_parent = self._runtime_for_session_dir(tmp_workspace / "sessions" / "parent")
        runtime_parent._isolate_settings_file()
        settings_path.write_text('{"effort": "max"}')

        # Fork: settings.json is still the parent's symlink at this point.
        runtime_fork = self._runtime_for_session_dir(tmp_workspace / "sessions" / "fork")
        runtime_fork._isolate_settings_file()

        target = settings_path.resolve()
        assert target.read_text() == '{"effort": "max"}'
