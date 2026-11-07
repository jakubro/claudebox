"""Tests for claudebox.agent_session.runtime_claude - ClaudeRuntime composition adapter."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.config import ClaudeAgentSessionConfig, RuntimeCapabilities
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.orchestration.errors import ChangeRefused, SessionNotReady
from claudebox.agent_session.runtime_claude import (
    ClaudeRuntime,
    SdkAssistantMessage,
    SdkResultMessage,
    SdkTextBlock,
)
from claudebox.core.io import write_json


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


def _connected(runtime: ClaudeRuntime) -> ClaudeRuntime:
    """Mark the runtime connected with nothing left queued, so calls go straight to the agent."""

    runtime.ready.set()
    runtime._drained.set()

    return runtime


class TestInit:
    """ClaudeRuntime initialization state."""

    def test_ready_event_starts_unset(self):
        """Ready event is not set on fresh runtime."""

        runtime = _make_runtime()
        assert not runtime.ready.is_set()

    def test_queue_starts_empty(self):
        """Nothing is queued on a fresh runtime."""

        runtime = _make_runtime()
        assert len(runtime._queue) == 0

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


class TestQuery:
    """Query dispatching and buffering."""

    @pytest.mark.anyio
    async def test_buffers_string_when_not_ready(self):
        """String queries are buffered when runtime is not ready."""

        runtime = _make_runtime()
        await runtime.query("hello")
        assert list(runtime._queue) == [("hello", None, False)]

    @pytest.mark.anyio
    async def test_buffers_content_blocks_when_not_ready(self):
        """Structured content block queries are buffered when runtime is not ready."""

        runtime = _make_runtime()
        blocks = [{"type": "text", "text": "hi"}]
        await runtime.query(blocks)
        assert list(runtime._queue) == [(blocks, None, False)]

    @pytest.mark.anyio
    async def test_buffer_preserves_order(self):
        """Multiple buffered queries maintain FIFO order."""

        runtime = _make_runtime()
        await runtime.query("first")
        await runtime.query("second")
        await runtime.query("third")
        assert list(runtime._queue) == [
            ("first", None, False),
            ("second", None, False),
            ("third", None, False),
        ]

    @pytest.mark.anyio
    async def test_an_after_turn_query_is_buffered_with_its_flag(self):
        runtime = _make_runtime()
        await runtime.query("<sibling-message>", message_uuid="D1", after_turn=True)
        assert list(runtime._queue) == [("<sibling-message>", "D1", True)]

    @pytest.mark.anyio
    async def test_an_after_turn_message_is_marked_later_for_the_cli(self):
        """A message at the CLI's `later` priority is never folded into a running turn."""

        runtime = _make_runtime()
        _connected(runtime)
        sent: list[dict] = []

        async def capture(stream):
            sent.extend([message async for message in stream])

        runtime._sdk.query = AsyncMock(side_effect=capture)

        await runtime.query("from a sibling", message_uuid="D1", after_turn=True)
        await runtime.query("from the user", message_uuid="U1")

        assert [(m["uuid"], m.get("priority")) for m in sent] == [("D1", "later"), ("U1", None)]

    @pytest.mark.anyio
    async def test_a_message_uuid_rides_on_the_transport_message(self):
        """The CLI keeps the uuid it is given, so the echo and the transcript line carry it."""

        runtime = _make_runtime()
        _connected(runtime)
        sent: list[dict] = []

        async def capture(stream):
            sent.extend([m async for m in stream])

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock, side_effect=capture):
            await runtime.query([{"type": "text", "text": "hi"}], message_uuid="U1")
            await runtime.query("plain text", message_uuid="U2")

        assert [(m["uuid"], m["message"]["content"]) for m in sent] == [
            ("U1", [{"type": "text", "text": "hi"}]),
            ("U2", "plain text"),
        ]

    @pytest.mark.anyio
    async def test_content_blocks_without_a_uuid_carry_none(self):
        runtime = _make_runtime()
        _connected(runtime)
        sent: list[dict] = []

        async def capture(stream):
            sent.extend([m async for m in stream])

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock, side_effect=capture):
            await runtime.query([{"type": "text", "text": "hi"}])

        assert "uuid" not in sent[0]

    @pytest.mark.anyio
    async def test_a_query_buffered_before_connect_is_flushed_with_its_uuid(self):
        runtime = _make_runtime()
        await runtime.query([{"type": "text", "text": "early"}], message_uuid="U1")
        sent: list[dict] = []

        async def capture(stream):
            sent.extend([m async for m in stream])

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock, side_effect=capture):
            runtime.ready.set()
            await runtime._flush_on_ready()

        assert sent[0]["uuid"] == "U1"

    @pytest.mark.anyio
    async def test_string_query_delegates_to_sdk_when_ready(self):
        """String query forwards to self._sdk.query when ready."""

        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock) as mock_query:
            await runtime.query("hello")
            mock_query.assert_awaited_once_with("hello")

    @pytest.mark.anyio
    async def test_content_blocks_query_delegates_to_sdk_when_ready(self):
        """Content block query wraps in stream and forwards when ready."""

        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock) as mock_query:
            blocks = [{"type": "text", "text": "hi"}]
            await runtime.query(blocks)
            mock_query.assert_awaited_once()

            # Argument should be an async iterator, not the raw list.
            arg = mock_query.call_args[0][0]
            assert arg is not blocks

    @pytest.mark.anyio
    async def test_refuses_when_connect_failed(self):
        """A query into a runtime that failed to connect is refused, not buffered."""

        runtime = _make_runtime()
        runtime.connect_error = "agent process would not start"

        with pytest.raises(RuntimeError, match="agent process would not start"):
            await runtime.query("hello")

        assert len(runtime._queue) == 0

    @pytest.mark.anyio
    async def test_refuses_even_if_ready_is_also_set(self):
        """connect_error takes priority over ready - both are set together on a failed connect."""

        runtime = _make_runtime()
        runtime.ready.set()
        runtime.connect_error = "agent process would not start"

        with pytest.raises(RuntimeError, match="agent process would not start"):
            await runtime.query("hello")


class TestInterrupt:
    """Interrupt behavior - clears buffer pre-ready, forwards post-ready."""

    @pytest.mark.anyio
    async def test_clears_buffer_when_not_ready(self):
        """Interrupt clears buffered queries when not connected."""

        runtime = _make_runtime()
        await runtime.query("a")
        await runtime.query("b")
        assert len(runtime._queue) == 2

        await runtime.interrupt()
        assert len(runtime._queue) == 0

    @pytest.mark.anyio
    async def test_delegates_when_ready(self):
        """Interrupt forwards to self._sdk.interrupt when ready."""

        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "interrupt", new_callable=AsyncMock) as mock_interrupt:
            await runtime.interrupt()
            mock_interrupt.assert_awaited_once()


class TestSetModel:
    """set_model queueing and dispatching."""

    @pytest.mark.anyio
    async def test_queued_when_not_ready(self):
        """set_model is queued as pending call when not connected."""

        runtime = _make_runtime()
        await runtime.set_model("claude-3-opus", wait=False)

        with patch.object(runtime._sdk, "set_model", new_callable=AsyncMock) as sdk_call:
            assert len(runtime._queue) == 1
            sdk_call.assert_not_awaited()
            runtime.ready.set()
            await runtime._flush_on_ready()

        sdk_call.assert_awaited_once_with("claude-3-opus")

    @pytest.mark.anyio
    async def test_delegates_when_ready(self):
        """set_model forwards to self._sdk.set_model when ready."""

        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "set_model", new_callable=AsyncMock) as mock_set_model:
            await runtime.set_model("claude-3-opus")
            mock_set_model.assert_awaited_once_with("claude-3-opus")


class TestSetPermissionMode:
    """set_permission_mode queueing and dispatching."""

    @pytest.mark.anyio
    async def test_queued_when_not_ready(self):
        """set_permission_mode is queued as pending call when not connected."""

        runtime = _make_runtime()
        await runtime.set_permission_mode("auto", wait=False)

        with patch.object(runtime._sdk, "set_permission_mode", new_callable=AsyncMock) as sdk_call:
            assert len(runtime._queue) == 1
            sdk_call.assert_not_awaited()
            runtime.ready.set()
            await runtime._flush_on_ready()

        sdk_call.assert_awaited_once_with("auto")

    @pytest.mark.anyio
    async def test_delegates_when_ready(self):
        """set_permission_mode forwards to self._sdk.set_permission_mode when ready."""

        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(
            runtime._sdk,
            "set_permission_mode",
            new_callable=AsyncMock,
        ) as mock_set_perm:
            await runtime.set_permission_mode("auto")
            mock_set_perm.assert_awaited_once_with("auto")


def _with_control(runtime: ClaudeRuntime, **mock_kwargs) -> AsyncMock:
    """Give the runtime's SDK a control channel; returns the request mock."""

    request = AsyncMock(return_value={}, **mock_kwargs)
    runtime._sdk._query = MagicMock(_send_control_request=request)

    return request


class TestSetEffortLevel:
    """set_effort_level queueing and the agent's own apply_flag_settings request."""

    @pytest.mark.anyio
    async def test_queued_when_not_ready(self):
        """set_effort_level is queued as pending call when not connected."""

        runtime = _make_runtime()
        await runtime.set_effort_level("high", wait=False)
        request = _with_control(runtime)

        assert len(runtime._queue) == 1
        request.assert_not_awaited()
        runtime.ready.set()
        await runtime._flush_on_ready()

        request.assert_awaited_once()

    @pytest.mark.anyio
    async def test_sends_apply_flag_settings_when_ready(self):
        runtime = _make_runtime()
        _connected(runtime)
        request = _with_control(runtime)

        await runtime.set_effort_level("high")

        request.assert_awaited_once_with(
            {"subtype": "apply_flag_settings", "settings": {"effortLevel": "high"}},
        )

    @pytest.mark.anyio
    async def test_writes_no_settings_file(self, tmp_path):
        runtime = _make_runtime(session_dir=tmp_path)
        _connected(runtime)
        _with_control(runtime)

        await runtime.set_effort_level("low")

        settings = tmp_path / "claude.json"
        assert not settings.exists() or "effortLevel" not in json.loads(
            settings.read_text() or "{}",
        )

    @pytest.mark.anyio
    async def test_member_level_reaches_only_its_own_agent(self, tmp_path):
        primary = _make_runtime(session_dir=tmp_path / "primary", is_primary=True)
        member = _make_runtime(session_dir=tmp_path / "member", is_primary=False)
        _connected(primary)
        _connected(member)
        primary_request, member_request = _with_control(primary), _with_control(member)

        await member.set_effort_level("low")

        member_request.assert_awaited_once()
        primary_request.assert_not_awaited()

    @pytest.mark.anyio
    async def test_timeout_is_refused_and_leaves_the_level_unchanged(self):
        changed = AsyncMock()
        runtime = _make_runtime(hooks=HookCallbacks(on_effort_level_changed=changed))
        _connected(runtime)
        _with_control(runtime, side_effect=TimeoutError)

        with pytest.raises(ChangeRefused) as refused:
            await runtime.set_effort_level("low")

        assert refused.value.context == {
            "setting": "effort_level",
            "value": "low",
            "reason": "timed out",
        }

        changed.assert_not_awaited()
        assert runtime._last_known_effort_level == "xhigh"

    def test_agent_starts_at_the_default_level(self):
        assert ClaudeRuntime._build_sdk_options(_make_config()).effort == "xhigh"

    def test_agent_starts_at_the_recorded_level(self):
        assert ClaudeRuntime._build_sdk_options(_make_config(effort_level="low")).effort == "low"

    @pytest.mark.anyio
    async def test_a_new_sessions_first_differing_level_is_reported(self):
        """The first set on a new session is a change from the default the session started at."""

        changed = AsyncMock()
        runtime = _make_runtime(hooks=HookCallbacks(on_effort_level_changed=changed))
        _connected(runtime)
        _with_control(runtime)

        await runtime.set_effort_level("max")

        changed.assert_awaited_once_with("max")

    @pytest.mark.anyio
    async def test_a_resumed_sessions_first_set_adopts_silently(self):
        """A resume replays its recorded level; that is not a change."""

        changed = AsyncMock()
        runtime = _make_runtime(
            resume_session_id="sess-1",
            hooks=HookCallbacks(on_effort_level_changed=changed),
        )
        _connected(runtime)
        _with_control(runtime)

        await runtime.set_effort_level("max")

        changed.assert_not_awaited()


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
        _connected(runtime)

        with patch.object(runtime._sdk, "get_context_usage", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {}
            result = await runtime.get_context_usage()

        assert result is None

    @pytest.mark.anyio
    async def test_returns_none_when_keys_missing(self):
        """SDK returns partial dict -> None (treat as no data; no fabricated 0s)."""

        runtime = _make_runtime()
        _connected(runtime)

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
        _connected(runtime)

        with patch.object(runtime._sdk, "get_context_usage", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"totalTokens": 12345, "maxTokens": 200000}
            result = await runtime.get_context_usage()

        assert isinstance(result, ContextUsage)
        assert result.used_tokens == 12345
        assert result.max_tokens == 200000


class TestMcpServerHiding:
    """The sibling-session server never reaches MCP status reporting or its guarded routes."""

    @pytest.mark.anyio
    async def test_get_mcp_status_returns_empty_shape_when_not_ready(self):
        runtime = _make_runtime()

        assert await runtime.get_mcp_status() == {"mcpServers": []}

    @pytest.mark.anyio
    async def test_get_mcp_status_filters_sibling_server(self):
        from claudebox.agent_session._sibling_sessions import CLAUDEBOX_MCP_SERVER_NAME

        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "get_mcp_status", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {
                "mcpServers": [
                    {"name": "jina", "status": "connected"},
                    {"name": CLAUDEBOX_MCP_SERVER_NAME, "status": "connected"},
                ],
            }
            result = await runtime.get_mcp_status()

        assert result["mcpServers"] == [{"name": "jina", "status": "connected"}]

    @pytest.mark.anyio
    async def test_get_mcp_status_preserves_other_top_level_keys(self):
        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "get_mcp_status", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"mcpServers": [], "other": "value"}
            result = await runtime.get_mcp_status()

        assert result["other"] == "value"

    @pytest.mark.anyio
    async def test_reconnect_mcp_server_protects_sibling_name(self):
        from claudebox.agent_session._sibling_sessions import CLAUDEBOX_MCP_SERVER_NAME
        from claudebox.agent_session.orchestration.errors import McpServerProtected

        runtime = _make_runtime()

        with pytest.raises(McpServerProtected):
            await runtime.reconnect_mcp_server(CLAUDEBOX_MCP_SERVER_NAME)

        assert list(runtime._queue) == []  # refused outright, never queued for later

    @pytest.mark.anyio
    async def test_reconnect_mcp_server_forwards_other_names_when_ready(self):
        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(
            runtime._sdk,
            "reconnect_mcp_server",
            new_callable=AsyncMock,
        ) as mock_reconnect:
            await runtime.reconnect_mcp_server("jina")

        mock_reconnect.assert_awaited_once_with("jina")

    @pytest.mark.anyio
    async def test_reconnect_mcp_server_queues_other_names_when_not_ready(self):
        runtime = _make_runtime()

        await runtime.reconnect_mcp_server("jina", wait=False)

        assert len(runtime._queue) == 1

    @pytest.mark.anyio
    async def test_toggle_mcp_server_protects_sibling_name(self):
        from claudebox.agent_session._sibling_sessions import CLAUDEBOX_MCP_SERVER_NAME
        from claudebox.agent_session.orchestration.errors import McpServerProtected

        runtime = _make_runtime()
        _connected(runtime)

        with pytest.raises(McpServerProtected):
            await runtime.toggle_mcp_server(CLAUDEBOX_MCP_SERVER_NAME, False)

    @pytest.mark.anyio
    async def test_toggle_mcp_server_forwards_other_names_when_ready(self):
        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "toggle_mcp_server", new_callable=AsyncMock) as mock_toggle:
            await runtime.toggle_mcp_server("jina", False)

        mock_toggle.assert_awaited_once_with("jina", False)


class TestMcpServerBuilding:
    """_build_mcp_servers/_sibling_sdk_tools - the in-process SDK MCP server construction."""

    def test_build_mcp_servers_keys_on_sibling_server_name(self):
        from claudebox.agent_session._sibling_sessions import CLAUDEBOX_MCP_SERVER_NAME

        runtime = _make_runtime()

        servers = runtime._build_mcp_servers()

        assert set(servers) == {CLAUDEBOX_MCP_SERVER_NAME}
        assert servers[CLAUDEBOX_MCP_SERVER_NAME]["type"] == "sdk"
        assert servers[CLAUDEBOX_MCP_SERVER_NAME]["name"] == CLAUDEBOX_MCP_SERVER_NAME

    def test_sibling_sdk_tools_returns_the_five_session_tools(self):
        runtime = _make_runtime()

        names = {t.name for t in runtime._sibling_sdk_tools()}

        assert names == {
            "session_spawn",
            "session_ask",
            "session_read",
            "session_stop",
            "session_list",
        }

    def test_each_tool_carries_the_shared_description(self):
        from claudebox.agent_session import _sibling_sessions as texts

        tools = {t.name: t for t in _make_runtime()._sibling_sdk_tools()}

        assert {name: tool.description for name, tool in tools.items()} == {
            "session_spawn": texts.SESSION_SPAWN_DESCRIPTION,
            "session_ask": texts.SESSION_ASK_DESCRIPTION,
            "session_read": texts.SESSION_READ_DESCRIPTION,
            "session_stop": texts.SESSION_STOP_DESCRIPTION,
            "session_list": texts.SESSION_LIST_DESCRIPTION,
        }

    def test_only_read_and_list_are_marked_read_only(self):
        tools = {t.name: t for t in _make_runtime()._sibling_sdk_tools()}

        read_only = {
            name
            for name, tool in tools.items()
            if tool.annotations is not None and tool.annotations.readOnlyHint
        }

        assert read_only == {"session_read", "session_list"}

    @pytest.mark.parametrize(
        ("tool", "required"),
        [
            ("session_spawn", ["prompt"]),
            ("session_ask", ["session_id", "message"]),
            ("session_read", ["session_id"]),
            ("session_stop", ["session_id"]),
            ("session_list", []),
        ],
    )
    def test_only_the_arguments_a_call_needs_are_required(self, tool, required):
        tools = {t.name: t for t in _make_runtime()._sibling_sdk_tools()}

        assert tools[tool].input_schema.get("required", []) == required

    @pytest.mark.parametrize(
        ("args", "error"),
        [
            ({"session_id": "s"}, None),
            ({"session_id": "s", "limit": 5}, None),
            ({"session_id": "s", "limit": 0}, "0 is less than the minimum of 1"),
        ],
    )
    def test_read_schema_checks_limit_as_the_sdk_runs_it(self, args, error):
        import jsonschema

        tools = {t.name: t for t in _make_runtime()._sibling_sdk_tools()}
        schema = tools["session_read"].input_schema

        if error is None:
            jsonschema.validate(args, schema)
        else:
            with pytest.raises(jsonschema.ValidationError, match=error):
                jsonschema.validate(args, schema)

    def test_every_text_fits_the_cli_description_limit(self):
        from claudebox.agent_session import _sibling_sessions as texts

        tools = _make_runtime()._sibling_sdk_tools()

        assert all(len(t.description) < 4096 for t in tools)
        assert len(texts.CLAUDEBOX_MCP_INSTRUCTIONS) < 4096

    @pytest.mark.anyio
    async def test_session_spawn_tool_forwards_prompt_and_settings(self):
        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}

        with patch.object(
            runtime._sibling_sessions,
            "spawn",
            new_callable=AsyncMock,
        ) as mock_spawn:
            mock_spawn.return_value = {"session_id": "s1", "container_id": "c1"}
            result = await tools["session_spawn"].handler(
                {"prompt": "do the thing", "name": "lint-fix", "model": "haiku", "effort": "low"},
            )

        mock_spawn.assert_awaited_once_with(
            "do the thing",
            name="lint-fix",
            model="haiku",
            effort="low",
        )
        assert json.loads(result["content"][0]["text"]) == {
            "session_id": "s1",
            "container_id": "c1",
        }
        assert "is_error" not in result

    @pytest.mark.anyio
    async def test_session_spawn_tool_leaves_unset_settings_none(self):
        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}

        with patch.object(
            runtime._sibling_sessions,
            "spawn",
            new_callable=AsyncMock,
        ) as mock_spawn:
            mock_spawn.return_value = {}
            await tools["session_spawn"].handler({"prompt": "x"})

        mock_spawn.assert_awaited_once_with("x", name=None, model=None, effort=None)

    @pytest.mark.anyio
    async def test_a_lost_prompt_is_a_result_not_an_error(self):
        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}
        lost = {"session_id": "s1", "container_id": "c1", "prompt_delivered": False, "note": "n"}

        with patch.object(runtime._sibling_sessions, "spawn", new_callable=AsyncMock) as mock_spawn:
            mock_spawn.return_value = lost
            result = await tools["session_spawn"].handler({"prompt": "x"})

        assert json.loads(result["content"][0]["text"]) == lost
        assert "is_error" not in result

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("tool", "method", "args", "expected_args"),
        [
            ("session_stop", "stop", {"session_id": "s1"}, ("s1",)),
            ("session_list", "list_siblings", {}, ()),
        ],
    )
    async def test_stop_and_list_delegate_and_report_errors(
        self,
        tool,
        method,
        args,
        expected_args,
    ):
        from claudebox.agent_session._sibling_sessions import SiblingSessionError

        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}

        with patch.object(runtime._sibling_sessions, method, new_callable=AsyncMock) as mock:
            mock.return_value = {"ok": 1}
            result = await tools[tool].handler(args)
            mock.side_effect = SiblingSessionError(f"{tool}: refused (x)")
            failed = await tools[tool].handler(args)

        mock.assert_awaited_with(*expected_args)
        assert json.loads(result["content"][0]["text"]) == {"ok": 1}
        assert failed["is_error"] is True
        assert failed["content"][0]["text"] == f"{tool}: refused (x)"

    @pytest.mark.anyio
    async def test_port_open_asks_and_tells_the_agent_to_end_its_turn(self, tmp_path):
        runtime = _make_runtime(session_dir=tmp_path)
        tools = {t.name: t for t in runtime._port_sdk_tools()}

        result = await tools["port_open"].handler({"port": 8080})

        assert result["content"][0]["text"].startswith("Asked the user to open port 8080")
        assert "is_error" not in result

    @pytest.mark.anyio
    async def test_port_open_in_a_spawned_session_says_where_to_ask(self, tmp_path):
        write_json(tmp_path / "session.json", {"spawned_from_session_id": "parent-1"})
        runtime = _make_runtime(session_dir=tmp_path)
        tools = {t.name: t for t in runtime._port_sdk_tools()}

        result = await tools["port_open"].handler({"port": 8080})

        assert result["content"][0]["text"].startswith(
            "Not asked: a session another session started",
        )

    @pytest.mark.parametrize(
        ("args", "error"),
        [({"port": 0}, "minimum"), ({"port": 70000}, "maximum")],
    )
    def test_the_port_schema_bounds_the_port(self, args, error):
        import jsonschema

        tools = {t.name: t for t in _make_runtime()._port_sdk_tools()}

        with pytest.raises(jsonschema.ValidationError, match=error):
            jsonschema.validate(args, tools["port_open"].input_schema)

    @pytest.mark.anyio
    async def test_port_close_reports_a_refusal_as_an_error(self):
        from claudebox.agent_session._sibling_sessions import SiblingSessionError

        tools = {t.name: t for t in _make_runtime()._port_sdk_tools()}

        with patch(
            "claudebox.agent_session.runtime_claude.close_port",
            new=AsyncMock(side_effect=SiblingSessionError("port_close: port 8080 is not open")),
        ):
            result = await tools["port_close"].handler({"port": 8080})

        assert result == {
            "content": [{"type": "text", "text": "port_close: port 8080 is not open"}],
            "is_error": True,
        }

    def test_server_carries_its_instructions_into_initialize(self):
        from claudebox.agent_session._sibling_sessions import (
            CLAUDEBOX_MCP_INSTRUCTIONS,
            CLAUDEBOX_MCP_SERVER_NAME,
        )

        servers = _make_runtime()._build_mcp_servers()
        instance = servers[CLAUDEBOX_MCP_SERVER_NAME]["instance"]

        assert instance.create_initialization_options().instructions == CLAUDEBOX_MCP_INSTRUCTIONS

    @pytest.mark.anyio
    async def test_session_spawn_tool_reports_sibling_error_without_raising(self):
        from claudebox.agent_session._sibling_sessions import SiblingSessionError

        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}

        with patch.object(
            runtime._sibling_sessions,
            "spawn",
            new_callable=AsyncMock,
        ) as mock_spawn:
            mock_spawn.side_effect = SiblingSessionError("depth cap reached")
            result = await tools["session_spawn"].handler({"prompt": "x"})

        assert result["is_error"] is True
        assert "depth cap reached" in result["content"][0]["text"]

    @pytest.mark.anyio
    async def test_session_ask_tool_delegates_to_client(self):
        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}

        with patch.object(runtime._sibling_sessions, "ask", new_callable=AsyncMock) as mock_ask:
            mock_ask.return_value = {"session_id": "s1", "delivered": True}
            result = await tools["session_ask"].handler({"session_id": "s1", "message": "hi"})

        mock_ask.assert_awaited_once_with("s1", "hi")
        assert json.loads(result["content"][0]["text"]) == {"session_id": "s1", "delivered": True}

    @pytest.mark.anyio
    async def test_session_read_tool_defaults_limit_to_fifty(self):
        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}

        with patch.object(runtime._sibling_sessions, "read", new_callable=AsyncMock) as mock_read:
            mock_read.return_value = []
            await tools["session_read"].handler({"session_id": "s1"})

        mock_read.assert_awaited_once_with("s1", 50)

    @pytest.mark.anyio
    async def test_session_read_tool_forwards_explicit_limit(self):
        runtime = _make_runtime()
        tools = {t.name: t for t in runtime._sibling_sdk_tools()}

        with patch.object(runtime._sibling_sessions, "read", new_callable=AsyncMock) as mock_read:
            mock_read.return_value = []
            await tools["session_read"].handler({"session_id": "s1", "limit": 5})

        mock_read.assert_awaited_once_with("s1", 5)

    def test_server_carries_needs_user_beside_the_sibling_tools(self):
        runtime = _make_runtime()

        with patch("claudebox.agent_session.runtime_claude.create_sdk_mcp_server") as create:
            runtime._build_mcp_servers()

        tools = {t.name: t for t in create.call_args.kwargs["tools"]}

        assert set(tools) == {
            "session_spawn",
            "session_ask",
            "session_read",
            "session_stop",
            "session_list",
            "needs_user",
            "port_open",
            "port_close",
        }
        schema = tools["needs_user"].input_schema
        assert set(schema["properties"]) == {"reason", "replies"}
        assert schema["required"] == ["reason"]

    def test_needs_user_read_list_and_ports_are_allowed_without_a_permission_prompt(self):
        options = ClaudeRuntime._build_sdk_options(_make_config(permission_mode="default"))

        assert options.allowed_tools == [
            "mcp__claudebox__needs_user",
            "mcp__claudebox__session_read",
            "mcp__claudebox__session_list",
            "mcp__claudebox__port_open",
            "mcp__claudebox__port_close",
        ]

    @pytest.mark.anyio
    async def test_needs_user_tool_acknowledges(self, tmp_path):
        runtime = _make_runtime(session_dir=tmp_path)

        result = await runtime._needs_user_sdk_tool().handler({"reason": "Decide: retry state"})

        assert "has been told" in result["content"][0]["text"]
        assert "is_error" not in result

    @pytest.mark.anyio
    async def test_needs_user_tool_says_which_replies_were_dropped(self, tmp_path):
        runtime = _make_runtime(session_dir=tmp_path)
        replies = ["A", "B", "C", "D", "E", "F", "G"]

        result = await runtime._needs_user_sdk_tool().handler(
            {"reason": "Pick", "replies": replies},
        )

        text = result["content"][0]["text"]
        assert "has been told" in text
        assert "2 more were dropped" in text

    @pytest.mark.anyio
    async def test_needs_user_tool_mentions_no_drop_within_the_limit(self, tmp_path):
        runtime = _make_runtime(session_dir=tmp_path)

        result = await runtime._needs_user_sdk_tool().handler({"reason": "Pick", "replies": ["A"]})

        assert "dropped" not in result["content"][0]["text"]

    @pytest.mark.anyio
    async def test_needs_user_tool_tells_a_spawned_session_it_was_ignored(self, tmp_path):
        write_json(tmp_path / "session.json", {"spawned_from_session_id": "parent-1"})
        runtime = _make_runtime(session_dir=tmp_path)

        result = await runtime._needs_user_sdk_tool().handler({"reason": "Decide: retry state"})

        assert result["content"][0]["text"].startswith("Ignored")


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

    @pytest.mark.anyio
    async def test_records_connect_error_and_still_sets_ready_on_failure(self):
        """A raised connect still sets ready, so parked waiters wake and check connect_error."""

        runtime = _make_runtime()

        with (
            patch.object(
                runtime._sdk,
                "connect",
                new_callable=AsyncMock,
                side_effect=RuntimeError("agent process would not start"),
            ),
            patch.object(ClaudeRuntime, "_isolate_settings_file"),
            pytest.raises(RuntimeError, match="agent process would not start"),
        ):
            await runtime.connect()

        assert runtime.ready.is_set()
        assert runtime.connect_error == "agent process would not start"


class TestDisconnect:
    """Disconnect cleanup - clears state, cancels flush task."""

    @pytest.mark.anyio
    async def test_clears_ready_event(self):
        """disconnect clears the ready event."""

        runtime = _make_runtime()
        _connected(runtime)

        with patch.object(runtime._sdk, "disconnect", new_callable=AsyncMock):
            await runtime.disconnect()

        assert not runtime.ready.is_set()

    @pytest.mark.anyio
    async def test_clears_buffer(self):
        """disconnect empties the message buffer."""

        runtime = _make_runtime()
        await runtime.query("leftover")

        with patch.object(runtime._sdk, "disconnect", new_callable=AsyncMock):
            await runtime.disconnect()

        assert len(runtime._queue) == 0

    @pytest.mark.anyio
    async def test_clears_pending_calls(self):
        """disconnect empties pending calls."""

        runtime = _make_runtime()
        await runtime.set_model("m", wait=False)

        with patch.object(runtime._sdk, "disconnect", new_callable=AsyncMock):
            await runtime.disconnect()

        assert len(runtime._queue) == 0

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
        await runtime.query("msg")
        await runtime.set_model("m", wait=False)
        assert len(runtime._queue) == 2

        with (
            patch.object(
                runtime._sdk,
                "disconnect",
                new_callable=AsyncMock,
                side_effect=RuntimeError("disconnect failed"),
            ),
            pytest.raises(RuntimeError, match="disconnect failed"),
        ):
            await runtime.disconnect()

        assert not runtime.ready.is_set()
        assert len(runtime._queue) == 0


class TestFlushOnReady:
    """Buffered message + pending call flushing after ready."""

    @pytest.mark.anyio
    async def test_flushes_in_the_order_queued(self):
        """A change queued before a prompt is applied before it."""

        runtime = _make_runtime()
        await runtime.set_model("claude-3", wait=False)
        await runtime.query("hello")

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

        for prompt in ("first", "second", "third"):
            await runtime.query(prompt)

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
        await runtime.query("msg")

        with patch.object(runtime._sdk, "query", new_callable=AsyncMock):
            runtime.ready.set()
            await runtime._flush_on_ready()

        assert len(runtime._queue) == 0

    @pytest.mark.anyio
    async def test_multiple_pending_calls_replayed(self):
        """Multiple pending calls are replayed in order."""

        runtime = _make_runtime()
        await runtime.set_model("m1", wait=False)
        await runtime.set_permission_mode("auto", wait=False)

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

    @pytest.mark.anyio
    async def test_clears_without_flushing_when_connect_failed(self):
        """A failed connect drops whatever was buffered before the failure was known, rather
        than sending it into a client that never connected."""

        runtime = _make_runtime()
        await runtime.query("hello")
        await runtime.set_model("m1", wait=False)
        runtime.connect_error = "agent process would not start"

        with (
            patch.object(runtime._sdk, "query", new_callable=AsyncMock) as mock_query,
            patch.object(runtime._sdk, "set_model", new_callable=AsyncMock) as mock_set_model,
        ):
            runtime.ready.set()
            await runtime._flush_on_ready()

        mock_query.assert_not_awaited()
        mock_set_model.assert_not_awaited()
        assert len(runtime._queue) == 0


class TestQueuedChanges:
    """A change made before the agent connects answers with its outcome and never stalls the queue."""

    @staticmethod
    def _refusing(runtime: ClaudeRuntime, method: str, text: str) -> AsyncMock:
        mock = AsyncMock(side_effect=Exception(text))
        setattr(runtime._sdk, method, mock)

        return mock

    @staticmethod
    async def _drain(runtime: ClaudeRuntime) -> None:
        runtime.ready.set()
        await runtime._flush_on_ready()

    @pytest.mark.anyio
    async def test_a_refused_change_does_not_strand_queued_prompts(self):
        runtime = _make_runtime()
        self._refusing(runtime, "set_permission_mode", "not launched with skip-permissions")
        runtime._sdk.query = AsyncMock()

        change = asyncio.create_task(runtime.set_permission_mode("bypassPermissions"))
        await asyncio.sleep(0)
        await runtime.query("alpha")
        await self._drain(runtime)

        with pytest.raises(ChangeRefused) as refused:
            await change

        assert refused.value.context["reason"] == "not launched with skip-permissions"
        runtime._sdk.query.assert_awaited_once_with("alpha")
        assert list(runtime._queue) == []

    @pytest.mark.anyio
    async def test_a_refused_change_does_not_skip_later_changes(self):
        runtime = _make_runtime()
        self._refusing(runtime, "set_model", "unknown model")
        request = _with_control(runtime)

        await runtime.set_model("claude-nonexistent-9", wait=False)
        await runtime.set_effort_level("low", wait=False)
        await self._drain(runtime)

        request.assert_awaited_once_with(
            {"subtype": "apply_flag_settings", "settings": {"effortLevel": "low"}},
        )

    @pytest.mark.anyio
    async def test_a_failed_prompt_does_not_strand_the_next(self):
        runtime = _make_runtime()
        sent: list[str] = []

        async def send(prompt):
            if prompt == "first":
                raise RuntimeError("transport closed")

            sent.append(prompt)

        runtime._sdk.query = AsyncMock(side_effect=send)
        await runtime.query("first")
        await runtime.query("second")
        await self._drain(runtime)

        assert sent == ["second"]
        assert runtime._drained.is_set()

    @pytest.mark.anyio
    async def test_calls_during_the_drain_wait_behind_it(self):
        runtime = _make_runtime()
        release = asyncio.Event()
        sent: list[str] = []

        async def slow_model(_model):
            await release.wait()

        runtime._sdk.set_model = AsyncMock(side_effect=slow_model)
        runtime._sdk.query = AsyncMock(side_effect=sent.append)
        await runtime.set_model("m1", wait=False)
        await runtime.query("first")
        runtime.ready.set()
        drain = asyncio.create_task(runtime._flush_on_ready())
        await asyncio.sleep(0)

        await runtime.query("second")
        release.set()
        await drain

        assert sent == ["first", "second"]

    @pytest.mark.anyio
    async def test_a_pick_during_the_drain_waits_behind_an_older_prompt(self):
        runtime = _make_runtime()
        release = asyncio.Event()
        order: list[str] = []

        async def slow_send(prompt):
            order.append(prompt)

            if prompt == "first":
                await release.wait()

        async def set_mode(mode):
            order.append(mode)

        runtime._sdk.query = AsyncMock(side_effect=slow_send)
        runtime._sdk.set_permission_mode = AsyncMock(side_effect=set_mode)
        await runtime.query("first")
        await runtime.query("second")
        runtime.ready.set()
        drain = asyncio.create_task(runtime._flush_on_ready())
        await asyncio.sleep(0)

        await runtime.set_permission_mode("plan", wait=False)
        release.set()
        await drain

        assert order == ["first", "second", "plan"]

    @pytest.mark.anyio
    async def test_picks_during_the_drain_keep_their_order(self):
        runtime = _make_runtime()
        release = asyncio.Event()
        applied: list[str] = []

        async def set_mode(mode):
            await release.wait()
            applied.append(mode)

        runtime._sdk.set_permission_mode = AsyncMock(side_effect=set_mode)
        await runtime.set_permission_mode("plan", wait=False)
        runtime.ready.set()
        drain = asyncio.create_task(runtime._flush_on_ready())
        await asyncio.sleep(0)

        await runtime.set_permission_mode("default", wait=False)
        release.set()
        await drain

        assert applied == ["plan", "default"]

    @pytest.mark.anyio
    async def test_queued_change_answers_with_its_outcome(self):
        runtime = _make_runtime()
        runtime._sdk.set_permission_mode = AsyncMock()

        change = asyncio.create_task(runtime.set_permission_mode("plan"))
        await asyncio.sleep(0.01)

        assert not change.done()
        await self._drain(runtime)
        await change
        runtime._sdk.set_permission_mode.assert_awaited_once_with("plan")

    @pytest.mark.anyio
    async def test_queued_change_times_out_and_is_withdrawn(self):
        runtime = _make_runtime()
        runtime._sdk.set_model = AsyncMock()

        with (
            patch(
                "claudebox.agent_session.runtime_claude.QUEUED_CHANGE_TIMEOUT",
                timedelta(seconds=0.05),
            ),
            pytest.raises(ChangeRefused) as refused,
        ):
            await runtime.set_model("m1")

        assert refused.value.context["reason"] == "timed out"
        await self._drain(runtime)
        runtime._sdk.set_model.assert_not_awaited()

    @pytest.mark.anyio
    async def test_wait_false_returns_at_once_and_logs_a_refusal(self):
        runtime = _make_runtime()
        runtime._logger = MagicMock()
        self._refusing(runtime, "set_model", "unknown model")

        await runtime.set_model("claude-nonexistent-9", wait=False)
        await self._drain(runtime)

        runtime._logger.error.assert_called_once_with(
            "Queued change refused",
            setting="model",
            value="claude-nonexistent-9",
            reason="unknown model",
        )

    @pytest.mark.anyio
    async def test_connected_refusal_raises_change_refused(self):
        changed = AsyncMock()
        runtime = _connected(_make_runtime(hooks=HookCallbacks(on_permission_mode_changed=changed)))
        self._refusing(runtime, "set_permission_mode", "not launched with skip-permissions")

        with pytest.raises(ChangeRefused) as refused:
            await runtime.set_permission_mode("bypassPermissions")

        assert refused.value.status_code == 409
        assert refused.value.context["setting"] == "permission_mode"
        changed.assert_not_awaited()

    @pytest.mark.anyio
    async def test_connected_timeout_raises_change_refused(self):
        runtime = _connected(_make_runtime())
        runtime._sdk.set_model = AsyncMock(side_effect=TimeoutError)

        with pytest.raises(ChangeRefused) as refused:
            await runtime.set_model("m1")

        assert refused.value.context["reason"] == "timed out"

    @pytest.mark.anyio
    async def test_connect_error_fails_queued_changes(self):
        runtime = _make_runtime()
        runtime._sdk.set_model = AsyncMock()

        change = asyncio.create_task(runtime.set_model("m1"))
        await asyncio.sleep(0)
        runtime.connect_error = "agent process would not start"
        await self._drain(runtime)

        with pytest.raises(SessionNotReady):
            await change

        runtime._sdk.set_model.assert_not_awaited()

    @pytest.mark.anyio
    async def test_disconnect_resets_drained(self):
        runtime = _connected(_make_runtime())
        runtime._sdk.disconnect = AsyncMock()
        runtime._sdk.query = AsyncMock()

        await runtime.disconnect()
        await runtime.query("after")

        runtime._sdk.query.assert_not_awaited()
        assert list(runtime._queue) == [("after", None, False)]


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
    def _runtime_for_session_dir(session_dir, **config_overrides) -> ClaudeRuntime:
        """Build ClaudeRuntime with session_dir set; SDK construction mocked."""

        session_dir.mkdir(parents=True, exist_ok=True)

        return _make_runtime(session_dir=session_dir, **config_overrides)

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

        # Re-seeds settings.json (mimics a parallel container start) before session B isolates.
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

    def test_member_isolate_never_reclaims_the_shared_symlink(self, tmp_workspace):
        """A member starting after the primary does not steal the shared settings.json symlink."""

        _, settings_path = self._settings_paths(tmp_workspace)
        settings_path.write_text('{"effort": "high"}')

        primary = self._runtime_for_session_dir(tmp_workspace / "sessions" / "primary")
        primary._isolate_settings_file()
        primary_target = settings_path.resolve()

        member = self._runtime_for_session_dir(
            tmp_workspace / "sessions" / "member",
            is_primary=False,
        )
        member._isolate_settings_file()

        assert settings_path.resolve() == primary_target


class TestGenerateTitle:
    """A title comes from a separate one-shot query on the CLI's small model."""

    @staticmethod
    def _reply(*texts):
        captured = {}

        async def fake_query(*, prompt, options):
            captured.update(prompt=prompt, options=options)
            yield SdkAssistantMessage(
                content=[SdkTextBlock(text=t) for t in texts],
                model="claude-haiku-4-5-20251001",
            )
            yield SdkResultMessage(
                subtype="success",
                duration_ms=1,
                duration_api_ms=1,
                is_error=False,
                num_turns=1,
                session_id="side",
            )

        return fake_query, captured

    @pytest.mark.anyio
    async def test_returns_the_cleaned_reply(self):
        runtime = _make_runtime()
        fake_query, _ = self._reply('"Fixing the CSV', ' parser."')

        with patch("claudebox.agent_session.runtime_claude.sdk_query", fake_query):
            title = await runtime.generate_title(["fix my parser", "still failing", "thanks"])

        assert title == "Fixing the CSV parser"

    @pytest.mark.anyio
    async def test_runs_toolless_settingless_and_unsaved_on_the_small_model(self):
        runtime = _make_runtime(cwd="/work/repo")
        fake_query, captured = self._reply("A title")

        with patch("claudebox.agent_session.runtime_claude.sdk_query", fake_query):
            await runtime.generate_title(["one", "two", "three"])

        options = captured["options"]
        assert options.model == "haiku"
        assert options.tools == []
        assert options.setting_sources == []
        assert options.max_turns == 1
        assert options.cwd == "/work/repo"
        assert options.extra_args == {"no-session-persistence": None}
        assert "<message>\ntwo\n</message>" in captured["prompt"]

    @pytest.mark.anyio
    async def test_query_failure_propagates(self):
        """The caller decides what a failure means; the runtime does not swallow it."""

        runtime = _make_runtime()

        async def failing_query(*, prompt, options):
            raise RuntimeError("cli exited")
            yield

        with (
            patch("claudebox.agent_session.runtime_claude.sdk_query", failing_query),
            pytest.raises(RuntimeError, match="cli exited"),
        ):
            await runtime.generate_title(["one", "two", "three"])


class TestStreamHealth:
    """Reader-state probe over the SDK's private query internals."""

    @staticmethod
    def _runtime_with_query(query) -> ClaudeRuntime:
        runtime = _make_runtime()
        runtime._sdk = MagicMock()
        runtime._sdk._query = query

        return runtime

    @staticmethod
    def _statistics(buffer_used: int = 3) -> MagicMock:
        """Build the SDK's message-stream statistics shape, 100 being the stream's bound."""

        return MagicMock(
            current_buffer_used=buffer_used,
            max_buffer_size=100,
            tasks_waiting_receive=1,
        )

    def test_reports_reader_and_buffer_state(self):
        """A live reader on a draining stream reports healthy."""

        query = MagicMock()
        query._read_task.done.return_value = False
        query._message_receive.statistics.return_value = self._statistics()

        health = self._runtime_with_query(query).stream_health()

        assert health is not None
        assert health.reader_finished is False
        assert health.buffer_full is False
        assert health.buffered == 3
        assert health.consumers_waiting == 1

    def test_reports_a_finished_reader_on_a_full_buffer(self):
        """A finished reader and a saturated stream both surface."""

        query = MagicMock()
        query._read_task.done.return_value = True
        query._message_receive.statistics.return_value = self._statistics(buffer_used=100)

        health = self._runtime_with_query(query).stream_health()

        assert health is not None
        assert health.reader_finished is True
        assert health.buffer_full is True

    def test_no_query_yields_no_health(self):
        """A runtime that never connected has nothing to report."""

        assert self._runtime_with_query(None).stream_health() is None

    def test_moved_internals_warn_once(self):
        """A probe that stops resolving warns the first time, then stays quiet."""

        runtime = self._runtime_with_query(object())
        logger = MagicMock()
        runtime._logger = logger

        with patch(
            "claudebox.agent_session.runtime_claude._WARNED_STREAM_HEALTH_UNAVAILABLE",
            False,
        ):
            assert runtime.stream_health() is None
            assert runtime.stream_health() is None

        logger.warning.assert_called_once()
