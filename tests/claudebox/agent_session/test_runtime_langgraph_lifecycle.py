"""LangGraphRuntime lifecycle + event assembly + usage telemetry - stub-model coverage."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import ClassVar
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_ollama import ChatOllama

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.events import (
    AssistantMessagePayload,
    ResultPayload,
    ResultUsage,
    SystemInitData,
    SystemInitPayload,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessagePayload,
)
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.langgraph_tools import SUBAGENT_RUN_TAG
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


def _make_config(
    tmp_path: Path,
    *,
    model: str | None = "ollama:llama3.2:3b",
    hooks: HookCallbacks | None = None,
    max_tokens_override: int | None = None,
) -> LangGraphAgentSessionConfig:
    # Bare model ids are rejected (no colon); ollama ids contain colons themselves, hence `ollama:llama3.2:3b`.
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
                "claudebox.agent_session.runtime_langgraph.init_chat_model",
                return_value=chat_model,
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
                "claudebox.agent_session.runtime_langgraph.init_chat_model",
                return_value=chat_model,
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

        assert not runtime.ready.is_set()

    def test_ollama_chat_model_exposes_closeable_client(self):
        """Checks disconnect's `_client.close` assumption against the real package, not a mock."""

        chat_model = ChatOllama(model="llama3.2:3b")

        assert hasattr(chat_model, "_client")
        assert callable(getattr(chat_model._client, "close", None))


class TestQuery:
    @pytest.mark.anyio
    async def test_stages_prompt_in_queue(self, tmp_path):
        runtime = LangGraphRuntime(_make_config(tmp_path))

        await runtime.query("hello")

        # _prompt_queue is the only observable signal at this layer.
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

    def test_assistant_event_leads_with_reasoning(self, tmp_path):
        """Anthropic-shaped thinking arrives ahead of the answer it produced."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(
            content=[
                {"type": "thinking", "thinking": "17 + 25 carries a ten"},
                {"type": "text", "text": "42"},
            ],
            response_metadata={"model_provider": "anthropic"},
        )

        evt = runtime._assistant_event(ai)

        assert evt is not None
        assert isinstance(evt.payload, AssistantMessagePayload)
        blocks = evt.payload.content
        assert isinstance(blocks[0], ThinkingBlock)
        assert blocks[0].thinking == "17 + 25 carries a ten"
        assert isinstance(blocks[1], TextBlock)
        assert blocks[1].text == "42"

    def test_assistant_event_surfaces_reasoning_from_any_provider_shape(self, tmp_path):
        """A reasoning model on Ollama reports through additional_kwargs, not content."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(content="42", additional_kwargs={"reasoning_content": "carry the ten"})

        evt = runtime._assistant_event(ai)

        assert evt is not None
        assert isinstance(evt.payload, AssistantMessagePayload)
        blocks = evt.payload.content
        assert isinstance(blocks[0], ThinkingBlock)
        assert blocks[0].thinking == "carry the ten"

    def test_assistant_event_has_no_thinking_block_without_reasoning(self, tmp_path):
        """A model that reasons silently produces no empty thinking block."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(content="42")

        evt = runtime._assistant_event(ai)

        assert evt is not None
        assert isinstance(evt.payload, AssistantMessagePayload)
        assert all(not isinstance(block, ThinkingBlock) for block in evt.payload.content)

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
            "final answer",
            cost_usd=0.00125,
            duration_ms=4500,
            used_tokens=320,
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
            _make_config(tmp_path, model="ollama:llama3.2:3b", max_tokens_override=16384),
        )

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 16384

    @pytest.mark.anyio
    async def test_max_tokens_override_with_unknown_model_works(self, tmp_path):
        """Override works for models outside MODEL_CONTEXT_WINDOW too - the escape hatch."""

        runtime = LangGraphRuntime(
            _make_config(tmp_path, model="custom_org:model-42b", max_tokens_override=64000),
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
    def test_cost_accumulates_across_calls(self, tmp_path):
        """Each call is billed for the whole prompt it re-sent, so per-call costs sum."""

        runtime = LangGraphRuntime(_make_config(tmp_path, model="anthropic:claude-sonnet-5"))

        first = runtime._accumulate_usage(1_000_000, 0)
        second = runtime._accumulate_usage(500_000, 0)

        assert (first, second) == (3.0, 1.5)
        assert runtime._total_cost_usd == pytest.approx(4.5)

    def test_billing_leaves_context_occupancy_alone(self, tmp_path):
        """Occupancy is a level the turn loop sets, not a running total of billed tokens."""

        runtime = LangGraphRuntime(_make_config(tmp_path))

        runtime._accumulate_usage(100, 200)

        assert runtime._context_tokens == 0

    def test_cost_is_zero_for_ollama_models(self, tmp_path):
        """Ollama rows in PRICE_PER_MTOK are explicitly 0.0 - local compute carries no USD."""

        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:llama3.2:3b"))

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=1_000_000)

        assert cost == 0.0
        assert runtime._total_cost_usd == 0.0

    def test_unknown_model_returns_none(self, tmp_path):
        """Unknown model (no curated table entry, no override) -> None cost."""

        runtime = LangGraphRuntime(_make_config(tmp_path, model="ollama:completely-new-model-42b"))

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=1_000_000)

        assert cost is None
        assert runtime._total_cost_usd == 0.0


class TestAstreamTaskRace:
    """`_astream_task` is set BEFORE astream iteration starts so early interrupt() works."""

    @pytest.mark.anyio
    async def test_astream_task_set_before_first_event(self, tmp_path):
        """A scripted astream that captures the task at the first yield sees a non-None pointer."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        captured: list = []

        async def _astream_events(graph_input, config=None, version=None):
            # The task pointer must already be set at the first yield.
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
            ],
        )
        runtime.ready.set()

        await runtime.query("what's 2+2?")

        kinds: list[str] = []

        async for evt in _drain_n(runtime.receive_events(), 4):
            kinds.append(evt.kind)

        assert kinds == ["system_init", "user_message", "assistant_message", "result"]

    @pytest.mark.anyio
    async def test_human_message_uuid_matches_the_turn_boundary_journal_key(self, tmp_path):
        """One id both opens the turn (TurnTracker) and keys the journal fork truncation reads."""

        import json

        runtime = LangGraphRuntime(_make_config(tmp_path))
        runtime._checkpointer = MagicMock()
        runtime._checkpointer.aget_tuple = AsyncMock(return_value=None)
        ai = AIMessage(
            content="2 + 2 is 4.",
            usage_metadata={"input_tokens": 10, "output_tokens": 8, "total_tokens": 18},
        )
        runtime._graph = _stub_graph_with_events(
            [{"event": "on_chat_model_end", "data": {"output": ai}}],
        )
        runtime.ready.set()

        await runtime.query("what's 2+2?")

        events = [evt async for evt in _drain_n(runtime.receive_events(), 4)]
        human_event = next(e for e in events if e.kind == "user_message" and e.payload.uuid)

        journal = json.loads((tmp_path / "checkpoint_turns.json").read_text())

        assert list(journal.keys()) == [human_event.payload.uuid]

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
            ],
        )
        runtime.ready.set()

        await runtime.query("weather in Paris?")

        kinds: list[str] = []

        async for evt in _drain_n(runtime.receive_events(), 6):
            kinds.append(evt.kind)

        assert kinds == [
            "system_init",
            "user_message",
            "assistant_message",
            "user_message",
            "assistant_message",
            "result",
        ]

    @pytest.mark.anyio
    async def test_context_usage_reports_the_latest_call_not_the_running_sum(self, tmp_path):
        """A turn's calls each re-send the conversation, so occupancy is the last one's size."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai_call = AIMessage(
            content="",
            tool_calls=[{"id": "tu-a", "name": "get_weather", "args": {"city": "Paris"}}],
            usage_metadata={"input_tokens": 100, "output_tokens": 10, "total_tokens": 110},
        )
        tm = ToolMessage(content="sunny", tool_call_id="tu-a", status="success")
        ai_final = AIMessage(
            content="It's sunny in Paris.",
            usage_metadata={"input_tokens": 700, "output_tokens": 20, "total_tokens": 720},
        )
        runtime._graph = _stub_graph_with_events(
            [
                {"event": "on_chat_model_end", "data": {"output": ai_call}},
                {"event": "on_tool_end", "data": {"output": tm}},
                {"event": "on_chat_model_end", "data": {"output": ai_final}},
            ],
        )
        runtime.ready.set()

        await runtime.query("weather in Paris?")

        events = [evt async for evt in _drain_n(runtime.receive_events(), 6)]
        result = events[-1]
        usage = await runtime.get_context_usage()

        assert isinstance(result.payload, ResultPayload)
        assert isinstance(result.payload.usage, ResultUsage)
        assert result.payload.usage.used_tokens == 720
        assert usage is not None
        assert usage.used_tokens == 720

    @pytest.mark.anyio
    async def test_subagent_calls_stay_out_of_the_parent_turn(self, tmp_path):
        """A sub-agent's model call rides the same stream; it is neither shown nor counted."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        parent_call = AIMessage(
            content="",
            tool_calls=[{"id": "tu-a", "name": "task", "args": {"description": "dig"}}],
            usage_metadata={"input_tokens": 100, "output_tokens": 10, "total_tokens": 110},
        )
        subagent_reply = AIMessage(
            content="sub-agent internal reply",
            usage_metadata={"input_tokens": 5_000, "output_tokens": 400, "total_tokens": 5_400},
        )
        tm = ToolMessage(content="dug", tool_call_id="tu-a", status="success")
        parent_final = AIMessage(
            content="Done.",
            usage_metadata={"input_tokens": 300, "output_tokens": 20, "total_tokens": 320},
        )
        runtime._graph = _stub_graph_with_events(
            [
                {"event": "on_chat_model_end", "data": {"output": parent_call}},
                {
                    "event": "on_chat_model_end",
                    "data": {"output": subagent_reply},
                    "tags": [SUBAGENT_RUN_TAG],
                },
                {"event": "on_tool_end", "data": {"output": tm}},
                {"event": "on_chat_model_end", "data": {"output": parent_final}},
            ],
        )
        runtime.ready.set()

        await runtime.query("delegate this")

        events = [evt async for evt in _drain_n(runtime.receive_events(), 6)]
        texts = [
            block.text
            for evt in events
            if isinstance(evt.payload, AssistantMessagePayload)
            for block in evt.payload.content
            if isinstance(block, TextBlock)
        ]

        assert "sub-agent internal reply" not in texts
        assert runtime._context_tokens == 320


class TestHumanTurnAttribution:
    """Every human turn opens with a user_message carrying a uuid: without one, turn tracking never
    assigns a turn, so the closing result reads as no assistant reply, duplicating it as an error."""

    @staticmethod
    def _one_turn_runtime(tmp_path) -> LangGraphRuntime:
        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai = AIMessage(
            content="done",
            usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        )
        runtime._graph = _stub_graph_with_events(
            [{"event": "on_chat_model_end", "data": {"output": ai}}],
        )
        runtime.ready.set()

        return runtime

    @pytest.mark.anyio
    async def test_human_message_carries_a_uuid_and_the_prompt(self, tmp_path):
        runtime = self._one_turn_runtime(tmp_path)

        await runtime.query("what's 2+2?")

        events = [evt async for evt in _drain_n(runtime.receive_events(), 4)]
        human = next(evt for evt in events if evt.kind == "user_message")

        assert isinstance(human.payload, UserMessagePayload)
        assert human.payload.uuid
        assert human.payload.content == "what's 2+2?"

    @pytest.mark.anyio
    async def test_each_turn_gets_a_distinct_uuid(self, tmp_path):
        """A reused id would fold the second turn into the first."""

        runtime = self._one_turn_runtime(tmp_path)

        await runtime.query("first")
        await runtime.query("second")

        events = [evt async for evt in _drain_n(runtime.receive_events(), 7)]
        uuids = [
            evt.payload.uuid
            for evt in events
            if evt.kind == "user_message" and isinstance(evt.payload, UserMessagePayload)
        ]

        assert len(uuids) == 2
        assert uuids[0] != uuids[1]

    @pytest.mark.anyio
    async def test_tool_result_message_carries_no_uuid(self, tmp_path):
        """Tool results belong to the open turn - a uuid there would start a new one."""

        runtime = LangGraphRuntime(_make_config(tmp_path))
        ai_call = AIMessage(
            content="",
            tool_calls=[{"id": "tu-a", "name": "get_weather", "args": {"city": "Paris"}}],
            usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        )
        tm = ToolMessage(content="sunny", tool_call_id="tu-a", status="success")
        runtime._graph = _stub_graph_with_events(
            [
                {"event": "on_chat_model_end", "data": {"output": ai_call}},
                {"event": "on_tool_end", "data": {"output": tm}},
            ],
        )
        runtime.ready.set()

        await runtime.query("weather in Paris?")

        events = [evt async for evt in _drain_n(runtime.receive_events(), 5)]
        user_messages = [evt for evt in events if evt.kind == "user_message"]

        assert len(user_messages) == 2
        assert user_messages[0].payload.uuid
        assert user_messages[1].payload.uuid is None

    @pytest.mark.anyio
    async def test_resumed_turn_also_announces_the_human(self, tmp_path):
        """An ask_user_question answer is a human turn too, and needs its own turn id."""

        runtime = self._one_turn_runtime(tmp_path)
        runtime._awaiting_resume = True

        await runtime.query("<response:AskUserQuestion>option A</response:AskUserQuestion>")

        events = [evt async for evt in _drain_n(runtime.receive_events(), 4)]
        human = next(evt for evt in events if evt.kind == "user_message")

        assert isinstance(human.payload, UserMessagePayload)
        assert human.payload.uuid

    @pytest.mark.anyio
    async def test_structured_prompt_flattens_to_its_text(self, tmp_path):
        """Attachment sends stage content blocks; only the text is renderable as the prompt."""

        runtime = self._one_turn_runtime(tmp_path)

        await runtime.query(
            [
                {"type": "text", "text": "describe this"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png"}},
            ],
        )

        events = [evt async for evt in _drain_n(runtime.receive_events(), 4)]
        human = next(evt for evt in events if evt.kind == "user_message")

        assert isinstance(human.payload, UserMessagePayload)
        assert human.payload.content == "describe this"


class TestContextSeedFromCheckpoint:
    """Resume seeds occupancy from the checkpoint, and never from a compacted-away prompt."""

    # Absurd for a short thread: any seed near it came from the pre-compaction reply.
    STALE_USAGE: ClassVar[dict[str, int]] = {
        "input_tokens": 999_000,
        "output_tokens": 1_000,
        "total_tokens": 1_000_000,
    }
    COMPACTED_TOKENS = 4_321

    @staticmethod
    def _summary() -> HumanMessage:
        return HumanMessage(
            content="Here is a summary of the conversation to date:\n\nthey discussed things",
            additional_kwargs={"lc_source": "summarization"},
            id="m-summary",
        )

    @staticmethod
    def _seeded_runtime(tmp_path: Path, messages: list) -> LangGraphRuntime:
        runtime = LangGraphRuntime(_make_config(tmp_path))
        runtime._graph = MagicMock()
        runtime._graph.aget_state = AsyncMock(return_value=MagicMock(values={"messages": messages}))

        return runtime

    def _record(self, runtime: LangGraphRuntime, kept: list) -> None:
        """Record a compaction that left `kept` behind, as the middleware callback would."""

        runtime._record_compaction(self.COMPACTED_TOKENS, kept)

    @pytest.mark.anyio
    async def test_compaction_awaiting_its_reply_seeds_the_compacted_count(self, tmp_path):
        """A restart between a compaction and the next reply: no usage_metadata describes this."""

        kept = [
            self._summary(),
            AIMessage(content="reply from before", usage_metadata=self.STALE_USAGE, id="m-old"),
            HumanMessage(content="what next?", id="m-prompt"),
        ]
        runtime = self._seeded_runtime(tmp_path, kept)
        self._record(runtime, kept)

        await runtime._seed_context_from_checkpoint()
        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.used_tokens == self.COMPACTED_TOKENS

    @pytest.mark.anyio
    async def test_compaction_awaiting_a_reply_after_tool_results(self, tmp_path):
        """The shape the first fix missed: the tail is tool results, not a human prompt."""

        kept = [
            self._summary(),
            AIMessage(content="", usage_metadata=self.STALE_USAGE, id="m-old-tc"),
            ToolMessage(content="tool output", tool_call_id="tc-1", id="m-tool"),
        ]
        runtime = self._seeded_runtime(tmp_path, kept)
        self._record(runtime, kept)

        await runtime._seed_context_from_checkpoint()
        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.used_tokens == self.COMPACTED_TOKENS

    @pytest.mark.anyio
    async def test_reply_after_a_compaction_seeds_its_own_reported_usage(self, tmp_path):
        """Once a real reply lands, its own figure is exact and supersedes the record."""

        kept = [self._summary(), HumanMessage(content="what next?", id="m-prompt")]
        messages = [
            *kept,
            AIMessage(
                content="reply from after",
                usage_metadata={"input_tokens": 4_200, "output_tokens": 300, "total_tokens": 4_500},
                id="m-new",
            ),
        ]
        runtime = self._seeded_runtime(tmp_path, messages)
        self._record(runtime, kept)

        await runtime._seed_context_from_checkpoint()
        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.used_tokens == 4_500

    @pytest.mark.anyio
    async def test_resume_without_any_compaction_is_unaffected(self, tmp_path):
        messages = [
            HumanMessage(content="first", id="m-1"),
            AIMessage(content="answered", usage_metadata=self.STALE_USAGE, id="m-2"),
        ]
        runtime = self._seeded_runtime(tmp_path, messages)

        await runtime._seed_context_from_checkpoint()
        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.used_tokens == 1_000_000

    @pytest.mark.anyio
    async def test_a_record_describing_a_different_history_is_ignored(self, tmp_path):
        """A fork or rewind can leave a record for a history this thread no longer has."""

        runtime = self._seeded_runtime(
            tmp_path,
            [
                HumanMessage(content="first", id="m-1"),
                AIMessage(content="answered", usage_metadata=self.STALE_USAGE, id="m-2"),
            ],
        )
        self._record(runtime, [HumanMessage(content="elsewhere", id="m-somewhere-else")])

        await runtime._seed_context_from_checkpoint()
        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.used_tokens == 1_000_000


async def _drain_n(generator: AsyncIterator, n: int, timeout: float = 5.0):
    """Yield the first n items from an async generator without exhausting it; each fetch is
    bounded, so a runtime emitting fewer events than expected fails the assertion instead of hanging."""

    count = 0

    while count < n:
        try:
            item = await asyncio.wait_for(anext(generator), timeout)
        except TimeoutError:
            raise AssertionError(f"stream stalled after {count} events, expected {n}") from None

        yield item
        count += 1
