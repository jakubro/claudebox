"""runtime_langgraph interrupt / resume routing tests.

AskUserQuestion HITL: an `interrupt()` call pauses the graph; the runtime detects it via
`aget_state` after astream_events ends, sets `_awaiting_resume`, and routes the next message
as `Command(resume=...)`, not a fresh HumanMessage.
"""

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
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
        async def _cancel(_graph_input, config=None, version=None):
            raise asyncio.CancelledError

            if False:  # pragma: no cover - keeps this an async generator
                yield None

        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph(has_interrupts=False, astream_events_factory=_cancel)

        await runtime._compaction_finished(
            pre_tokens=900,
            post_tokens=200,
            summary="summarised",
            kept=[],
        )

        kinds = []

        with pytest.raises(asyncio.CancelledError):
            async for event in runtime._drive_turn("hello"):
                kinds.append(event.kind)

        assert kinds[-1] == "result"
        assert runtime._take_pending_events() == []
