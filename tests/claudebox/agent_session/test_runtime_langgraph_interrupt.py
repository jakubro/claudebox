"""runtime_langgraph interrupt / resume routing tests.

AskUserQuestion HITL: an `interrupt()` call pauses the graph; the runtime detects it via
`aget_state` after astream_events ends, sets `_awaiting_resume`, and routes the next message
as `Command(resume=...)`, not a fresh HumanMessage.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.events import ResultPayload
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


def _config(tmp_path: Path) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model="ollama:llama3.2:3b",
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-i",
        resume_session_id=None,
        session_dir=tmp_path,
    )


def _scripted_astream(events: list[dict]):
    """Return an async-iterable factory yielding `events` for astream_events."""

    async def _gen(_graph_input, config=None, version=None):
        for ev in events:
            yield ev

    return _gen


def _snapshot(*, has_interrupts: bool) -> MagicMock:
    """Build a StateSnapshot stub; when `has_interrupts`, the first task's `interrupts` tuple is non-empty."""

    interrupt_marker = MagicMock()
    interrupt_marker.value = {"questions": [{"question": "ok?"}]}
    task = MagicMock()
    task.interrupts = (interrupt_marker,) if has_interrupts else ()
    snapshot = MagicMock()
    snapshot.tasks = (task,)

    return snapshot


def _stub_graph(
    *,
    has_interrupts: bool,
    astream_events_factory=None,
    aget_state_side_effect: Exception | None = None,
) -> Any:
    """Construct a graph stub with astream_events + aget_state, typed `Any` so test-side mutation
    doesn't trip ty's narrow-on-attr check on the runtime's `_graph` slot."""

    graph: Any = MagicMock()
    graph.astream_events = astream_events_factory or _scripted_astream([])

    if aget_state_side_effect is not None:
        graph.aget_state = AsyncMock(side_effect=aget_state_side_effect)
    else:
        graph.aget_state = AsyncMock(return_value=_snapshot(has_interrupts=has_interrupts))

    return graph


def _runtime_with_stub_graph(tmp_path: Path, *, has_interrupts: bool) -> LangGraphRuntime:
    runtime = LangGraphRuntime(_config(tmp_path))
    runtime._graph = _stub_graph(has_interrupts=has_interrupts)

    return runtime


class TestPendingInterruptProbe:
    @pytest.mark.anyio
    async def test_returns_true_when_state_has_interrupt(self, tmp_path):
        runtime = _runtime_with_stub_graph(tmp_path, has_interrupts=True)

        assert await runtime._has_pending_interrupt({"configurable": {}}) is True

    @pytest.mark.anyio
    async def test_returns_false_when_state_has_no_interrupts(self, tmp_path):
        runtime = _runtime_with_stub_graph(tmp_path, has_interrupts=False)

        assert await runtime._has_pending_interrupt({"configurable": {}}) is False

    @pytest.mark.anyio
    async def test_returns_false_on_probe_exception(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph(
            has_interrupts=False,
            aget_state_side_effect=RuntimeError("boom"),
        )

        assert await runtime._has_pending_interrupt({"configurable": {}}) is False


class TestDriveTurnSetsAwaitingResume:
    @pytest.mark.anyio
    async def test_sets_flag_when_interrupt_pending(self, tmp_path):
        runtime = _runtime_with_stub_graph(tmp_path, has_interrupts=True)

        async for _ in runtime._drive_turn("hi"):
            pass

        assert runtime._awaiting_resume is True

    @pytest.mark.anyio
    async def test_clears_flag_when_no_interrupt(self, tmp_path):
        runtime = _runtime_with_stub_graph(tmp_path, has_interrupts=False)
        runtime._awaiting_resume = True  # seed as if a prior turn was waiting

        async for _ in runtime._drive_turn("hi"):
            pass

        assert runtime._awaiting_resume is False


class TestDriveTurnRoutesResume:
    @pytest.mark.anyio
    async def test_routes_via_command_when_awaiting_resume(self, tmp_path):
        captured: dict[str, Any] = {}

        async def _capture(graph_input, config=None, version=None):
            captured["graph_input"] = graph_input
            captured["config"] = config
            captured["version"] = version

            if False:  # pragma: no cover - empty async generator
                yield None

        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph(has_interrupts=False, astream_events_factory=_capture)
        runtime._awaiting_resume = True

        async for _ in runtime._drive_turn(
            "<response:AskUserQuestion>A</response:AskUserQuestion>",
        ):
            pass

        from langgraph.types import Command

        assert isinstance(captured["graph_input"], Command)
        assert captured["graph_input"].resume == (
            "<response:AskUserQuestion>A</response:AskUserQuestion>"
        )
        # Flag cleared at the start of the resume turn.
        assert runtime._awaiting_resume is False

    @pytest.mark.anyio
    async def test_routes_as_human_message_when_not_awaiting(self, tmp_path):
        captured: dict[str, Any] = {}

        async def _capture(graph_input, config=None, version=None):
            captured["graph_input"] = graph_input

            if False:  # pragma: no cover - empty async generator
                yield None

        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph(has_interrupts=False, astream_events_factory=_capture)
        runtime._awaiting_resume = False

        async for _ in runtime._drive_turn("hello"):
            pass

        graph_input: Any = captured["graph_input"]
        assert isinstance(graph_input, dict)
        assert "messages" in graph_input
        from langchain_core.messages import HumanMessage

        first_message = graph_input["messages"][0]
        assert isinstance(first_message, HumanMessage)
        assert first_message.content == "hello"


class TestInterruptDropsQueuedMiddlewareEvents:
    """An interrupted turn drops its queued events: compaction queues a boundary for the turn
    loop to yield, but if an interrupt lands first the session emits its own boundary and
    replaying the queued one next turn would describe a conversation it never belonged to."""

    @pytest.mark.anyio
    async def test_queued_events_do_not_survive_the_interrupt(self, tmp_path):
        started = asyncio.Event()

        async def _parked(_graph_input, config=None, version=None):
            started.set()
            await asyncio.Event().wait()

            if False:  # pragma: no cover - keeps this an async generator
                yield None

        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph(has_interrupts=False, astream_events_factory=_parked)

        await runtime._compaction_finished(
            pre_tokens=900,
            post_tokens=200,
            summary="summarised",
            kept=[],
        )

        kinds = []
        turn = runtime._drive_turn("hello")
        kinds.append((await anext(turn)).kind)
        reading = asyncio.ensure_future(anext(turn))
        await started.wait()
        await runtime.interrupt()
        closing = await reading
        kinds.append(closing.kind)

        assert kinds == ["user_message", "result"]
        assert isinstance(closing.payload, ResultPayload)
        assert closing.payload.subtype == "error_during_execution"
        assert runtime._take_pending_events() == []


def _ai(text: str):
    from langchain_core.messages import AIMessage

    return AIMessage(
        content=text,
        usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
    )


def _answer(text: str) -> dict:
    return {"event": "on_chat_model_end", "data": {"output": _ai(text)}}


class _Graph:
    """astream_events stand-in: each call replays the next script, parking forever at "PARK"."""

    def __init__(self, *scripts: list):
        self._scripts = list(scripts)
        self.calls = 0
        self.cancelled = False
        self.parked = asyncio.Event()

    async def astream_events(self, _graph_input, config=None, version=None):
        script = self._scripts[self.calls]
        self.calls += 1

        for step in script:
            if step == "PARK":
                self.parked.set()

                try:
                    await asyncio.Event().wait()
                except asyncio.CancelledError:
                    self.cancelled = True

                    raise
            elif isinstance(step, Exception):
                raise step
            else:
                yield step


def _runtime(tmp_path: Path, graph: _Graph, *, has_interrupts: bool = False) -> LangGraphRuntime:
    runtime = LangGraphRuntime(_config(tmp_path))
    stub = _stub_graph(has_interrupts=has_interrupts)
    stub.astream_events = graph.astream_events
    runtime._graph = stub
    runtime.ready.set()

    return runtime


async def _collect(runtime: LangGraphRuntime, into: list) -> None:
    async for event in runtime.receive_events():
        into.append(event)


async def _until(predicate, timeout: float = 5.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


class TestStopEndsTheTurnNotTheReader:
    """Stop ends the running turn with one result; the task reading the stream keeps running."""

    @pytest.mark.anyio
    async def test_the_reader_survives_and_a_waiting_follow_up_starts(self, tmp_path):
        graph = _Graph([_answer("partial"), "PARK"], [_answer("b")])
        runtime = _runtime(tmp_path, graph)
        events: list = []
        await runtime.query("A")
        await runtime.query("B")
        reader = asyncio.create_task(_collect(runtime, events))

        await asyncio.wait_for(graph.parked.wait(), 5)
        await runtime.interrupt()
        await _until(lambda: len(events) >= 6)

        assert not reader.done()
        assert [e.kind for e in events[:6]] == [
            "system_init",
            "user_message",
            "assistant_message",
            "result",
            "user_message",
            "assistant_message",
        ]
        reader.cancel()

    @pytest.mark.anyio
    async def test_a_stop_before_the_graph_task_runs_leaves_the_question_pending(self, tmp_path):
        graph = _Graph([_answer("never")])
        runtime = _runtime(tmp_path, graph, has_interrupts=True)
        runtime._awaiting_resume = True
        pressed = asyncio.Event()

        async def _stop_request() -> None:
            await pressed.wait()
            await runtime.interrupt()

        await runtime.query("<response:AskUserQuestion>A</response:AskUserQuestion>")
        stream = runtime.receive_events()
        [await anext(stream) for _ in range(2)]
        stopper = asyncio.create_task(_stop_request())
        await asyncio.sleep(0)
        pressed.set()
        closing = await asyncio.wait_for(anext(stream), 5)
        await stopper

        assert closing.kind == "result"
        assert isinstance(closing.payload, ResultPayload)
        assert closing.payload.subtype == "error_during_execution"
        assert graph.calls == 0
        assert runtime._awaiting_resume is True
        assert runtime._turn_active is False

    @pytest.mark.anyio
    async def test_a_stop_while_the_reader_is_busy_still_closes_with_one_result(self, tmp_path):
        graph = _Graph([_answer("partial"), _answer("never")])
        runtime = _runtime(tmp_path, graph)
        await runtime.query("A")
        stream = runtime.receive_events()

        kinds = [(await anext(stream)).kind for _ in range(3)]
        await runtime.interrupt()
        closing = await anext(stream)

        assert kinds == ["system_init", "user_message", "assistant_message"]
        assert closing.kind == "result"
        assert isinstance(closing.payload, ResultPayload)
        assert closing.payload.subtype == "error_during_execution"
        assert closing.payload.is_error is True
        assert closing.payload.result is None

    @pytest.mark.anyio
    async def test_a_stop_before_the_graph_starts_keeps_the_message_and_never_runs_it(
        self,
        tmp_path,
    ):
        graph = _Graph([_answer("never")])
        runtime = _runtime(tmp_path, graph)
        release = asyncio.Event()
        probing = asyncio.Event()

        async def _parked_probe(_config):
            probing.set()
            await release.wait()

        runtime._checkpointer = MagicMock()
        runtime._checkpointer.aget_tuple = _parked_probe
        events: list = []
        await runtime.query("A")
        reader = asyncio.create_task(_collect(runtime, events))

        await asyncio.wait_for(probing.wait(), 5)
        await runtime.interrupt()
        release.set()
        await _until(lambda: len(events) >= 3)

        assert [e.kind for e in events] == ["system_init", "user_message", "result"]
        assert events[2].payload.subtype == "error_during_execution"
        assert events[2].payload.result is None
        assert graph.calls == 0
        assert not reader.done()
        reader.cancel()

    @pytest.mark.anyio
    async def test_cancelling_the_reader_cancels_the_graph_with_no_result(self, tmp_path):
        graph = _Graph(["PARK"])
        runtime = _runtime(tmp_path, graph)
        events: list = []
        await runtime.query("A")
        reader = asyncio.create_task(_collect(runtime, events))

        await asyncio.wait_for(graph.parked.wait(), 5)
        reader.cancel()

        with pytest.raises(asyncio.CancelledError):
            await reader

        assert graph.cancelled
        assert [e.kind for e in events] == ["system_init", "user_message"]
        assert runtime._graph_task is None

    @pytest.mark.anyio
    async def test_a_stopped_answer_leaves_the_question_pending(self, tmp_path):
        graph = _Graph(["PARK"])
        runtime = _runtime(tmp_path, graph, has_interrupts=True)
        runtime._awaiting_resume = True
        events: list = []
        await runtime.query("<response:AskUserQuestion>A</response:AskUserQuestion>")
        reader = asyncio.create_task(_collect(runtime, events))

        await asyncio.wait_for(graph.parked.wait(), 5)
        await runtime.interrupt()
        await _until(lambda: len(events) >= 3)

        assert events[2].kind == "result"
        assert runtime._awaiting_resume is True
        reader.cancel()

    @pytest.mark.anyio
    async def test_a_stop_with_nothing_running_does_not_touch_the_next_turn(self, tmp_path):
        graph = _Graph([_answer("fine")])
        runtime = _runtime(tmp_path, graph)
        await runtime.interrupt()
        events: list = []
        await runtime.query("A")
        reader = asyncio.create_task(_collect(runtime, events))

        await _until(lambda: len(events) >= 4)

        assert events[3].kind == "result"
        assert events[3].payload.result == "fine"
        reader.cancel()

    @pytest.mark.anyio
    async def test_a_graph_failure_still_reaches_the_reader_with_no_result(self, tmp_path):
        graph = _Graph([RuntimeError("model down")])
        runtime = _runtime(tmp_path, graph)
        events: list = []
        await runtime.query("A")

        with pytest.raises(RuntimeError, match="model down"):
            await _collect(runtime, events)

        assert [e.kind for e in events] == ["system_init", "user_message"]
