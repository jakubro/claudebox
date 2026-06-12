"""LangGraphRuntime lifecycle + event assembly + usage telemetry - stub-model coverage."""

from collections.abc import AsyncIterator
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, ToolMessage

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.events import (
    AssistantMessagePayload,
    ResultPayload,
    ResultUsage,
    SystemInitData,
    SystemInitPayload,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessagePayload,
)
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


def _make_config(
    tmp_path: Path,
    *,
    model: str | None = "ollama:llama3.2:3b",
    hooks: HookCallbacks | None = None,
    max_tokens_override: int | None = None,
) -> LangGraphAgentSessionConfig:
    # Tests pass models in the explicit `provider:model_id` form. The
    # runtime parser rejects bare model ids (no colon) so workspace TOML
    # mistakes fail loudly at session start; Ollama model ids themselves
    # contain colons (`llama3.2:3b`) so the only valid form is the explicit
    # `ollama:llama3.2:3b`.
    provider_kwargs: dict = {}

    if model and model.startswith("ollama:"):
        provider_kwargs["base_url"] = "http://127.0.0.1:11434"

    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model=model,
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-1",
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=hooks or HookCallbacks(),
        max_tokens_override=max_tokens_override,
        provider_kwargs=provider_kwargs,
    )


def _scripted_astream_events(events: list[dict]):
    """Return an awaitable factory yielding `events` via an async iterator."""

    async def _astream_events(graph_input, config=None, version=None):
        for ev in events:
            yield ev

    return _astream_events


def _stub_graph_with_events(events: list[dict]) -> MagicMock:
    graph = MagicMock()
    graph.astream_events = _scripted_astream_events(events)

    return graph


def _ok_httpx_client_mock() -> MagicMock:
    """Happy-path httpx.Client mock - passes Ollama reachability + model-pulled probes."""

    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {}
    response.raise_for_status = MagicMock()
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)
    client.get.return_value = response
    client.post.return_value = response

    return client


def _async_sqlite_cm_mock() -> MagicMock:
    """AsyncSqliteSaver.from_conn_string mock - yields a stub saver."""

    async def _aenter(self):
        return MagicMock()

    async def _aexit(self, *args):
        return None

    cm = MagicMock()
    cm.__aenter__ = _aenter
    cm.__aexit__ = _aexit

    return cm


class TestConnect:
    @pytest.mark.anyio
    async def test_builds_graph_and_fires_on_session_start(self, tmp_path):
        on_start = AsyncMock()
        hooks = HookCallbacks(on_session_start=on_start)
        runtime = LangGraphRuntime(_make_config(tmp_path, hooks=hooks))

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.init_chat_model",
                return_value=MagicMock(),
            ) as mock_chat,
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                return_value=MagicMock(),
            ) as mock_agent,
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_mock(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=_async_sqlite_cm_mock(),
            ),
        ):
            await runtime.connect()

        mock_chat.assert_called_once()
        mock_agent.assert_called_once()
        assert runtime.ready.is_set()
        on_start.assert_awaited_once()

    @pytest.mark.anyio
    async def test_raises_when_model_missing(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path, model=None))

        with pytest.raises(RuntimeError, match="model"):
            await runtime.connect()


class TestDisconnect:
    @pytest.mark.anyio
    async def test_clears_ready(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.init_chat_model",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_mock(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=_async_sqlite_cm_mock(),
            ),
        ):
            await runtime.connect()
            assert runtime.ready.is_set()
            await runtime.disconnect()

        assert not runtime.ready.is_set()

    @pytest.mark.anyio
    async def test_closes_chat_model_http_client(self, tmp_path):
        """Disconnect calls close() on the chat model's internal _client (HTTP pool release)."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        client_close = MagicMock()
        chat_model = MagicMock()
        chat_model._client = MagicMock(close=client_close)

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.init_chat_model", return_value=chat_model
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_mock(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=_async_sqlite_cm_mock(),
            ),
        ):
            await runtime.connect()
            await runtime.disconnect()

        client_close.assert_called_once()
        assert runtime._chat_model is None
        assert runtime._graph is None

    @pytest.mark.anyio
    async def test_chat_model_close_failure_does_not_propagate(self, tmp_path):
        """A close() failure logs a warning but disconnect still completes."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        chat_model = MagicMock()
        chat_model._client = MagicMock(close=MagicMock(side_effect=RuntimeError("boom")))

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.init_chat_model", return_value=chat_model
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_mock(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=_async_sqlite_cm_mock(),
            ),
        ):
            await runtime.connect()
            # Must not raise - close failures are absorbed.
            await runtime.disconnect()

        assert not runtime.ready.is_set()


class TestQuery:
    @pytest.mark.anyio
    async def test_stages_prompt_in_queue(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))

        await runtime.query("hello")

        # _prompt_queue is implementation detail but we want a behavioural check -
        # the only observable signal at this layer is the queue's qsize.
        assert runtime._prompt_queue.qsize() == 1


class TestEventAssembly:
    """Direct unit tests of the assembly helpers - independent of the graph driver."""

    def test_system_init_payload(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))

        evt = runtime._system_init_event()

        assert evt.kind == "system_init"
        assert isinstance(evt.payload, SystemInitPayload)
        assert evt.payload.subtype == "init"
        assert evt.payload.session_id == "sess-1"
        assert evt.payload.model == "ollama:llama3.2:3b"
        assert isinstance(evt.payload.data, SystemInitData)
        # LangGraph's init data is minimal - defaults across the board.
        assert evt.payload.data.slash_commands == []
        assert evt.payload.data.mcp_servers == []

    def test_system_init_uses_thread_id_when_session_id_missing(self, tmp_path):
        """When config.session_id is None, the payload falls back to the runtime's _thread_id (always set)."""

        config = LangGraphAgentSessionConfig(
            runtime="langgraph",
            model="ollama:llama3.2:3b",
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id=None,
            resume_session_id=None,
            session_dir=tmp_path,
            hooks=HookCallbacks(),
            provider_kwargs={"base_url": "http://127.0.0.1:11434"},
        )
        runtime = LangGraphRuntime(config)

        evt = runtime._system_init_event()

        assert isinstance(evt.payload, SystemInitPayload)
        # _thread_id is a generated uuid string - non-empty so the validator passes.
        assert evt.payload.session_id == runtime._thread_id
        assert evt.payload.session_id != ""

    def test_assistant_event_with_text_and_tool_use(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(
            content="checking the weather",
            tool_calls=[
                {"id": "tu-1", "name": "get_weather", "args": {"city": "Paris"}},
            ],
        )

        evt = runtime._assistant_event(ai)

        assert evt is not None
        assert evt.kind == "assistant_message"
        assert isinstance(evt.payload, AssistantMessagePayload)
        assert evt.payload.model == "ollama:llama3.2:3b"
        blocks = evt.payload.content
        assert isinstance(blocks[0], TextBlock)
        assert blocks[0].text == "checking the weather"
        assert isinstance(blocks[1], ToolUseBlock)
        assert blocks[1].id == "tu-1"
        assert blocks[1].name == "get_weather"
        assert blocks[1].input == {"city": "Paris"}

    def test_assistant_event_omits_empty_text_block(self, tmp_path):
        """The llama3.2:3b tool-calling pattern emits empty content alongside tool_calls."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(
            content="",
            tool_calls=[{"id": "tu-2", "name": "lookup", "args": {}}],
        )

        evt = runtime._assistant_event(ai)

        assert evt is not None
        assert isinstance(evt.payload, AssistantMessagePayload)
        blocks = evt.payload.content
        assert all(not isinstance(b, TextBlock) for b in blocks)
        assert isinstance(blocks[0], ToolUseBlock)

    def test_assistant_event_returns_none_when_empty(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(content="")

        assert runtime._assistant_event(ai) is None

    def test_tool_result_event_from_tool_message(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))
        tm = ToolMessage(content="sunny, 18°C", tool_call_id="tu-1", status="success")

        evt = runtime._tool_result_event(tm)

        assert evt is not None
        assert evt.kind == "user_message"
        assert isinstance(evt.payload, UserMessagePayload)
        assert isinstance(evt.payload.content, list)
        block = evt.payload.content[0]
        assert isinstance(block, ToolResultBlock)
        assert block.tool_use_id == "tu-1"
        assert block.content == "sunny, 18°C"
        assert block.is_error is False

    def test_tool_result_event_propagates_error_status(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))
        tm = ToolMessage(content="ConnectError", tool_call_id="tu-3", status="error")

        evt = runtime._tool_result_event(tm)

        assert evt is not None
        assert isinstance(evt.payload, UserMessagePayload)
        assert isinstance(evt.payload.content, list)
        block = evt.payload.content[0]
        assert isinstance(block, ToolResultBlock)
        assert block.is_error is True

    def test_result_event_carries_cost_duration_usage(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))

        evt = runtime._result_event(
            "final answer", cost_usd=0.00125, duration_ms=4500, used_tokens=320
        )

        assert evt.kind == "result"
        assert isinstance(evt.payload, ResultPayload)
        assert evt.payload.subtype == "success"
        assert evt.payload.result == "final answer"
        assert evt.payload.total_cost_usd == pytest.approx(0.00125)
        assert evt.payload.duration_ms == 4500
        assert evt.payload.session_id == "sess-1"
        assert isinstance(evt.payload.usage, ResultUsage)
        assert evt.payload.usage.used_tokens == 320
        assert evt.payload.usage.max_tokens > 0


class TestContextUsageMaxTokens:
    """`get_context_usage()` reports the per-model context window, not a global fallback."""

    @pytest.mark.anyio
    async def test_qwen_7b_uses_32k_window(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:qwen2.5:7b"))

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 32_768

    @pytest.mark.anyio
    async def test_max_tokens_override_wins(self, tmp_path):
        """Workspace `max_tokens_override` short-circuits the table lookup."""

        runtime = LangGraphRuntime(
            _make_config(tmp_path, model="ollama:llama3.2:3b", max_tokens_override=16384)
        )

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 16384

    @pytest.mark.anyio
    async def test_max_tokens_override_with_unknown_model_works(self, tmp_path):
        """Override works for models outside MODEL_CONTEXT_WINDOW too - the escape hatch."""

        runtime = LangGraphRuntime(
            _make_config(tmp_path, model="custom_org:model-42b", max_tokens_override=64000)
        )

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 64000

    @pytest.mark.anyio
    async def test_llama_3_2_3b_uses_128k_window(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:llama3.2:3b"))

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 128_000

    @pytest.mark.anyio
    async def test_unknown_model_falls_back_to_default(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:completely-new-42b"))

        usage = await runtime.get_context_usage()

        assert usage is not None
        # MODEL_CONTEXT_WINDOW["default"] in the source.
        assert usage.max_tokens == 128_000

    @pytest.mark.anyio
    async def test_result_event_max_tokens_matches_get_context_usage(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:qwen2.5:7b"))

        usage = await runtime.get_context_usage()
        evt = runtime._result_event("done", cost_usd=0.0, duration_ms=10, used_tokens=100)

        assert usage is not None
        assert isinstance(evt.payload, ResultPayload)
        assert isinstance(evt.payload.usage, ResultUsage)
        assert evt.payload.usage.max_tokens == usage.max_tokens


class TestUsageAndCost:
    def test_accumulates_across_calls(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))

        runtime._accumulate_usage(100, 200)
        runtime._accumulate_usage(50, 75)

        assert runtime._used_tokens == 425

    def test_cost_is_zero_for_ollama_models(self, tmp_path):
        """Ollama rows in PRICE_PER_MTOK are explicitly 0.0 - local compute carries no USD."""

        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:llama3.2:3b"))

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=1_000_000)

        assert cost == 0.0
        assert runtime._total_cost_usd == 0.0

    def test_unknown_model_returns_none(self, tmp_path):
        """Unknown model (no curated table entry, no override) -> None cost; tokens still count."""

        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:completely-new-model-42b"))

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=1_000_000)

        assert cost is None
        assert runtime._total_cost_usd == 0.0
        assert runtime._used_tokens == 2_000_000


class TestAstreamTaskRace:
    """`_astream_task` is set BEFORE astream iteration starts so early interrupt() works."""

    @pytest.mark.anyio
    async def test_astream_task_set_before_first_event(self, tmp_path):
        """A scripted astream that captures the task at the first yield sees a non-None pointer."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        captured: list = []

        async def _astream_events(graph_input, config=None, version=None):
            # Capture the task pointer at the very first yield - pre-fix it
            # would have been None because the assignment lived after iteration started.
            captured.append(runtime._astream_task)
            ai = AIMessage(
                content="hi",
                usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
            )
            yield {"event": "on_chat_model_end", "data": {"output": ai}}

        graph = MagicMock()
        graph.astream_events = _astream_events
        runtime._graph = graph
        runtime.ready.set()

        await runtime.query("hello")

        async for _ in _drain_n(runtime.receive_events(), 3):
            pass

        assert captured and captured[0] is not None


class TestDriveTurn:
    """End-to-end one-turn drive against a scripted graph."""

    @pytest.mark.anyio
    async def test_emits_system_init_assistant_and_result(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(
            content="2 + 2 is 4.",
            usage_metadata={"input_tokens": 10, "output_tokens": 8, "total_tokens": 18},
        )
        runtime._graph = _stub_graph_with_events(
            [
                {"event": "on_chat_model_end", "data": {"output": ai}},
            ]
        )
        runtime.ready.set()

        await runtime.query("what's 2+2?")

        kinds: list[str] = []

        async for evt in _drain_n(runtime.receive_events(), 3):
            kinds.append(evt.kind)

        assert kinds == ["system_init", "assistant_message", "result"]

    @pytest.mark.anyio
    async def test_emits_assistant_tool_use_then_tool_result(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai_call = AIMessage(
            content="",
            tool_calls=[{"id": "tu-a", "name": "get_weather", "args": {"city": "Paris"}}],
            usage_metadata={"input_tokens": 12, "output_tokens": 2, "total_tokens": 14},
        )
        tm = ToolMessage(content="sunny", tool_call_id="tu-a", status="success")
        ai_final = AIMessage(
            content="It's sunny in Paris.",
            usage_metadata={"input_tokens": 4, "output_tokens": 6, "total_tokens": 10},
        )
        runtime._graph = _stub_graph_with_events(
            [
                {"event": "on_chat_model_end", "data": {"output": ai_call}},
                {"event": "on_tool_end", "data": {"output": tm}},
                {"event": "on_chat_model_end", "data": {"output": ai_final}},
            ]
        )
        runtime.ready.set()

        await runtime.query("weather in Paris?")

        kinds: list[str] = []

        async for evt in _drain_n(runtime.receive_events(), 5):
            kinds.append(evt.kind)

        assert kinds == [
            "system_init",
            "assistant_message",
            "user_message",
            "assistant_message",
            "result",
        ]


async def _drain_n(generator: AsyncIterator, n: int):
    """Yield first n items from an async generator without exhausting it."""

    count = 0

    async for item in generator:
        yield item
        count += 1

        if count >= n:
            return
