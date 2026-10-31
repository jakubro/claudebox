"""Stop under the LangGraph runtime, through the real session, event pipeline and runtime."""

from __future__ import annotations

import asyncio

import pytest
from langchain_core.messages import AIMessage

from claudebox.agent_session.orchestration.persistence import EventLog
from claudebox.agent_session.orchestration.session import SessionService
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime
from claudebox.config import Config


def _answer(text: str) -> dict:
    ai = AIMessage(
        content=text,
        usage_metadata={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
    )

    return {"event": "on_chat_model_end", "data": {"output": ai}}


class _Graph:
    """Graph stand-in: the first turn answers in part and waits; later turns answer at once."""

    def __init__(self):
        self.calls = 0
        self.parked = asyncio.Event()
        self.first_text: str | None = "partial"

    async def astream_events(self, _graph_input, config=None, version=None):
        self.calls += 1

        if self.calls == 1:
            if self.first_text is not None:
                yield _answer(self.first_text)

            self.parked.set()
            await asyncio.Event().wait()
        else:
            yield _answer("second")

    async def aget_state(self, _config):
        raise RuntimeError("no checkpoint in this test")


@pytest.fixture
def graph(tmp_workspace, monkeypatch):
    graph = _Graph()
    config = Config(
        work_dir=tmp_workspace,
        config_dir=tmp_workspace / ".claudebox",
        agent="langgraph",
        langgraph_model="ollama:llama3.2:3b",
    )
    monkeypatch.setattr(
        "claudebox.agent_session.orchestration.session.Config.load",
        lambda *_args, **_kwargs: config,
    )

    async def _connect(self):
        self._graph = graph
        self.ready.set()

    monkeypatch.setattr(LangGraphRuntime, "connect", _connect)

    return graph


async def _until(predicate, timeout: float = 5.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


def _persisted(session: SessionService, event_type: str) -> list:
    return [e for e in session._event_pipeline.get_events() if e.type == event_type]


async def _stop_mid_answer(session: SessionService, graph: _Graph) -> None:
    await session.start()
    await session.send("A")
    await asyncio.wait_for(graph.parked.wait(), 5)
    await session.send("B")
    await session.interrupt()
    await _until(lambda: len(_persisted(session, "result")) >= 2)


class TestStopUnderLangGraph:
    """A stopped LangGraph answer ends in one result and the session keeps answering."""

    @pytest.mark.anyio
    async def test_the_reader_lives_and_the_waiting_message_runs_without_another_send(
        self,
        tmp_workspace,
        graph,
    ):
        turn_complete = []

        async def _on_turn_complete(session_id):
            turn_complete.append(session_id)

        session = SessionService(
            tmp_workspace,
            remaps_tmp=False,
            on_turn_complete=_on_turn_complete,
        )

        await _stop_mid_answer(session, graph)

        results = [(e.subtype, e.content) for e in _persisted(session, "result")]
        humans = [e.content for e in session._event_pipeline.get_events() if e.is_human]
        assert results == [("error_during_execution", ""), ("success", "second")]
        assert humans == ["A", "B"]
        assert session._event_pipeline.is_alive
        await _until(lambda: turn_complete != [])
        assert len(turn_complete) == 1
        await session.stop()

    @pytest.mark.anyio
    async def test_a_stop_landing_while_an_event_is_persisted(
        self,
        tmp_workspace,
        graph,
        monkeypatch,
    ):
        append = EventLog.append

        async def _slow_append(self, event):
            if event.type == "assistant":
                await asyncio.sleep(0.2)

            await append(self, event)

        monkeypatch.setattr(EventLog, "append", _slow_append)
        session = SessionService(tmp_workspace, remaps_tmp=False)

        await _stop_mid_answer(session, graph)

        assert [e.content for e in _persisted(session, "result")] == ["", "second"]
        assert session._event_pipeline.is_alive
        await session.stop()

    @pytest.mark.anyio
    async def test_a_stop_before_any_text_leaves_no_bubble(self, tmp_workspace, graph):
        graph.first_text = None
        session = SessionService(tmp_workspace, remaps_tmp=False)
        await session.start()
        await session.send("A")
        await asyncio.wait_for(graph.parked.wait(), 5)

        await session.interrupt()
        await _until(lambda: len(_persisted(session, "result")) >= 1)

        persisted = [(e.type, e.subtype) for e in session._event_pipeline.get_events()]
        assert persisted == [
            ("system", "init"),
            ("user", "message"),
            ("system", "interrupt_sent"),
            ("result", "error_during_execution"),
        ]
        assert _persisted(session, "result")[0].content == ""
        await session.stop()
