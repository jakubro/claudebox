"""LangGraphRuntime driven through a real compiled graph.

Other LangGraph tests stub `create_agent` or script `astream_events`, leaving the astream-v2 projection (graph
events -> AgentEvents) unverified. Here `create_agent`, the middleware stack, tool surface/execution, and the
checkpointer are all real, so assertions target the AgentEvent contract rather than a hand-written fixture; only
the provider round-trip is substituted, since pytest runs with sockets disabled.

Runtimes write to the real `checkpoints.sqlite` under session_dir, so a second runtime over the same directory
resumes through the file, just as it would across a container restart.
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from langchain_core.language_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.events import (
    AssistantMessagePayload,
    ResultPayload,
    ToolResultBlock,
    ToolUseBlock,
    UserMessagePayload,
)
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


# A provider with no connect-time probe, so building the graph needs no network.
MODEL_ID = "anthropic:claude-test-model"


class _ScriptedChatModel(FakeMessagesListChatModel):
    """A real BaseChatModel replaying scripted replies, with tool binding accepted.

    The base class refuses `bind_tools`, which would push the runtime down its chat-only degradation
    path; accepting the bind keeps the tool-calling loop intact while the script still picks the calls.
    """

    def bind_tools(self, tools: Any, **kwargs: Any) -> "_ScriptedChatModel":
        return self


def _make_config(
    tmp_path: Path,
    session_id: str,
    profile_hooks: dict[str, str] | None = None,
    system_prompt: str | None = None,
) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model=MODEL_ID,
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id=session_id,
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=HookCallbacks(),
        profile_hooks=profile_hooks or {},
        system_prompt=system_prompt,
    )


async def _connected_runtime(
    tmp_path: Path,
    replies: list[BaseMessage],
    *,
    session_id: str = "real-graph-session",
    profile_hooks: dict[str, str] | None = None,
    system_prompt: str | None = None,
) -> LangGraphRuntime:
    """Build and connect a runtime whose graph and checkpointer are real.

    Two runtimes given the same tmp_path share one `checkpoints.sqlite`.
    """

    runtime = LangGraphRuntime(_make_config(tmp_path, session_id, profile_hooks, system_prompt))

    with patch(
        "claudebox.agent_session.runtime_langgraph.init_chat_model",
        return_value=_ScriptedChatModel(responses=replies),
    ):
        await runtime.connect()

    return runtime


async def _drive(runtime: LangGraphRuntime, prompt: str, expected: int) -> list:
    """Send one prompt and collect the next `expected` events off the runtime stream."""

    await runtime.query(prompt)

    return [event async for event in _bounded(runtime.receive_events(), expected)]


async def _bounded(generator: AsyncIterator, n: int, timeout: float = 30.0):
    """Yield n items, failing rather than hanging when the stream produces fewer."""

    for count in range(n):
        try:
            yield await asyncio.wait_for(anext(generator), timeout)
        except TimeoutError:
            raise AssertionError(f"graph emitted {count} events, expected {n}") from None


class TestRealGraphPlainTurn:
    @pytest.mark.anyio
    async def test_emits_the_full_turn_contract(self, tmp_path):
        """system_init, the human turn, the reply, then the result - from a real graph."""

        runtime = await _connected_runtime(tmp_path, [AIMessage(content="4")])

        try:
            events = await _drive(runtime, "what is 2+2?", 4)
        finally:
            await runtime.disconnect()

        assert [e.kind for e in events] == [
            "system_init",
            "user_message",
            "assistant_message",
            "result",
        ]

        human = events[1]
        assert isinstance(human.payload, UserMessagePayload)
        assert human.payload.uuid, "the human turn must carry a turn id"
        assert human.payload.content == "what is 2+2?"

        reply = events[2]
        assert isinstance(reply.payload, AssistantMessagePayload)
        assert reply.payload.content[0].text == "4"

        result = events[3]
        assert isinstance(result.payload, ResultPayload)
        assert result.payload.subtype == "success"
        assert result.payload.result == "4"

    @pytest.mark.anyio
    async def test_second_turn_gets_its_own_turn_id(self, tmp_path):
        """A stale turn id silently swallows the next prompt, so distinctness is the contract."""

        runtime = await _connected_runtime(
            tmp_path,
            [AIMessage(content="first"), AIMessage(content="second")],
        )

        try:
            first = await _drive(runtime, "one", 4)
            second = await _drive(runtime, "two", 3)
        finally:
            await runtime.disconnect()

        first_id = first[1].payload.uuid
        second_id = next(e for e in second if e.kind == "user_message").payload.uuid

        assert first_id and second_id
        assert first_id != second_id


class TestRealGraphToolTurn:
    @pytest.mark.anyio
    async def test_tool_call_round_trip(self, tmp_path):
        """The graph really executes a bound tool and the result comes back as a user message."""

        (tmp_path / "findme.txt").write_text("x")

        runtime = await _connected_runtime(
            tmp_path,
            [
                AIMessage(
                    content="",
                    tool_calls=[{"id": "tc-1", "name": "glob", "args": {"pattern": "*.txt"}}],
                ),
                AIMessage(content="found it"),
            ],
        )

        try:
            events = await _drive(runtime, "find the text file", 6)
        finally:
            await runtime.disconnect()

        assert [e.kind for e in events] == [
            "system_init",
            "user_message",
            "assistant_message",
            "user_message",
            "assistant_message",
            "result",
        ]

        call = events[2].payload.content[0]
        assert isinstance(call, ToolUseBlock)
        assert call.name == "glob"

        tool_result = events[3]
        assert isinstance(tool_result.payload, UserMessagePayload)
        block = tool_result.payload.content[0]
        assert isinstance(block, ToolResultBlock)
        assert block.tool_use_id == "tc-1"
        # The tool result belongs to the turn already open - a uuid here would start a new one.
        assert tool_result.payload.uuid is None

    @pytest.mark.anyio
    async def test_a_tool_error_returns_as_a_failed_result_and_the_turn_continues(self, tmp_path):
        """A ToolException must not end the turn - the model reads the failure and replies."""

        runtime = await _connected_runtime(
            tmp_path,
            [
                AIMessage(
                    content="",
                    tool_calls=[{"id": "tc-1", "name": "skill", "args": {"name": "fruit"}}],
                ),
                AIMessage(content="that skill does not exist"),
            ],
        )

        try:
            events = await _drive(runtime, "run the fruit skill", 6)
        finally:
            await runtime.disconnect()

        # Same shape as a successful tool call - the turn completes, it does not end on the error.
        assert [e.kind for e in events] == [
            "system_init",
            "user_message",
            "assistant_message",
            "user_message",
            "assistant_message",
            "result",
        ]

        tool_result = events[3]
        block = tool_result.payload.content[0]
        assert isinstance(block, ToolResultBlock)
        assert block.tool_use_id == "tc-1"
        assert block.is_error is True
        assert "fruit" in block.content

        assert events[5].payload.subtype == "success"

    @pytest.mark.anyio
    async def test_a_nonzero_bash_exit_code_projects_as_a_failed_result(self, tmp_path):
        """`bash` fails via return shape, not raise; is_error reads exit_code, not ToolNode's status."""

        runtime = await _connected_runtime(
            tmp_path,
            [
                AIMessage(
                    content="",
                    tool_calls=[{"id": "tc-1", "name": "bash", "args": {"command": "exit 7"}}],
                ),
                AIMessage(content="that command failed"),
            ],
        )

        try:
            events = await _drive(runtime, "run exit 7", 6)
        finally:
            await runtime.disconnect()

        assert [e.kind for e in events] == [
            "system_init",
            "user_message",
            "assistant_message",
            "user_message",
            "assistant_message",
            "result",
        ]

        tool_result = events[3]
        block = tool_result.payload.content[0]
        assert isinstance(block, ToolResultBlock)
        assert block.tool_use_id == "tc-1"
        assert block.is_error is True
        assert "7" in block.content


class TestSessionStartContext:
    """The profile's session-start hook reaches the model, exactly once per thread."""

    BOOTSTRAP = "load the instruction hierarchy first"

    @staticmethod
    def _hook(tmp_path: Path, context: str) -> str:
        """Write an executable hook answering with the Claude Code response envelope."""

        hook = tmp_path / "session_start.sh"
        hook.write_text(
            "#!/bin/bash\n"
            "cat > /dev/null\n"
            f'printf \'{{"hookSpecificOutput":{{"additionalContext":"{context}"}}}}\'\n',
        )
        hook.chmod(0o755)

        return str(hook)

    @staticmethod
    def _messages(state) -> list[str]:
        return [str(getattr(message, "content", "")) for message in state.values["messages"]]

    @pytest.mark.anyio
    async def test_context_leads_the_first_turn(self, tmp_path):
        runtime = await _connected_runtime(
            tmp_path,
            [AIMessage(content="ok")],
            profile_hooks={"session_start": self._hook(tmp_path, self.BOOTSTRAP)},
        )

        try:
            await _drive(runtime, "hello", 4)

            assert runtime._graph is not None
            state = await runtime._graph.aget_state(
                {"configurable": {"thread_id": runtime._thread_id}},
            )
        finally:
            await runtime.disconnect()

        messages = self._messages(state)
        assert self.BOOTSTRAP in messages
        # It has to arrive before the request it is meant to shape.
        assert messages.index(self.BOOTSTRAP) < messages.index("hello")

    @pytest.mark.anyio
    async def test_no_hook_means_no_extra_message(self, tmp_path, monkeypatch):
        # Isolate HOME - the real installed profile's hook would otherwise answer, making this environmental.
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

        runtime = await _connected_runtime(tmp_path, [AIMessage(content="ok")])

        try:
            await _drive(runtime, "hello", 4)

            assert runtime._graph is not None
            state = await runtime._graph.aget_state(
                {"configurable": {"thread_id": runtime._thread_id}},
            )
        finally:
            await runtime.disconnect()

        assert self._messages(state) == ["hello", "ok"]

    @pytest.mark.anyio
    async def test_context_is_not_reinjected_on_resume(self, tmp_path):
        """The checkpointer persists what the graph is handed, so a second copy would stack up."""

        hooks = {"session_start": self._hook(tmp_path, self.BOOTSTRAP)}

        first = await _connected_runtime(
            tmp_path,
            [AIMessage(content="ok")],
            profile_hooks=hooks,
        )

        try:
            await _drive(first, "hello", 4)
        finally:
            await first.disconnect()

        second = await _connected_runtime(
            tmp_path,
            [AIMessage(content="again")],
            profile_hooks=hooks,
        )

        try:
            await _drive(second, "second turn", 4)

            assert second._graph is not None
            state = await second._graph.aget_state(
                {"configurable": {"thread_id": second._thread_id}},
            )
        finally:
            await second.disconnect()

        assert self._messages(state).count(self.BOOTSTRAP) == 1

    @pytest.mark.anyio
    async def test_context_is_delivered_when_the_thread_cannot_be_read(self, tmp_path):
        """An unreadable checkpointer must not silently turn the hook into a no-op.

        Treating a failed probe as a resume would drop the context for the session's whole life, so it is forced.
        """

        runtime = await _connected_runtime(
            tmp_path,
            [AIMessage(content="ok")],
            profile_hooks={"session_start": self._hook(tmp_path, self.BOOTSTRAP)},
        )

        assert runtime._graph is not None
        original = runtime._graph.aget_state

        async def _refuse(*_args, **_kwargs):
            raise RuntimeError("checkpointer refused the read")

        runtime._graph.aget_state = _refuse

        try:
            await _drive(runtime, "hello", 4)

            runtime._graph.aget_state = original
            state = await runtime._graph.aget_state(
                {"configurable": {"thread_id": runtime._thread_id}},
            )
        finally:
            await runtime.disconnect()

        assert self.BOOTSTRAP in self._messages(state)

    @pytest.mark.anyio
    async def test_a_failing_hook_does_not_stop_the_session(self, tmp_path):
        hook = tmp_path / "broken.sh"
        hook.write_text("#!/bin/bash\ncat > /dev/null\nexit 1\n")
        hook.chmod(0o755)

        runtime = await _connected_runtime(
            tmp_path,
            [AIMessage(content="ok")],
            profile_hooks={"session_start": str(hook)},
        )

        try:
            events = await _drive(runtime, "hello", 4)
        finally:
            await runtime.disconnect()

        assert [e.kind for e in events] == [
            "system_init",
            "user_message",
            "assistant_message",
            "result",
        ]


class TestSystemPrompt:
    """The workspace persona reaches the model on every turn, without entering the transcript."""

    PERSONA = "You are a terse engineering assistant."

    @pytest.mark.anyio
    async def test_persona_is_sent_to_the_model(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

        model = _ScriptedChatModel(responses=[AIMessage(content="ok")])
        seen: list[list[BaseMessage]] = []
        original = model._generate

        def _capture(messages, *args, **kwargs):
            seen.append(list(messages))

            return original(messages, *args, **kwargs)

        monkeypatch.setattr(model, "_generate", _capture)

        runtime = LangGraphRuntime(
            _make_config(tmp_path, "persona-session", system_prompt=self.PERSONA),
        )

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            return_value=model,
        ):
            await runtime.connect()

        try:
            await _drive(runtime, "hello", 4)

            assert runtime._graph is not None
            state = await runtime._graph.aget_state(
                {"configurable": {"thread_id": runtime._thread_id}},
            )
        finally:
            await runtime.disconnect()

        assert seen, "the model was never invoked"
        assert any(
            isinstance(message, SystemMessage) and message.content == self.PERSONA
            for message in seen[0]
        )

        # Applied per call, not appended to the conversation, so it never accumulates in the checkpointed thread.
        persisted = [str(getattr(m, "content", "")) for m in state.values["messages"]]
        assert self.PERSONA not in persisted

    @pytest.mark.anyio
    async def test_no_persona_configured_sends_no_system_message(self, tmp_path, monkeypatch):
        monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

        model = _ScriptedChatModel(responses=[AIMessage(content="ok")])
        seen: list[list[BaseMessage]] = []
        original = model._generate

        def _capture(messages, *args, **kwargs):
            seen.append(list(messages))

            return original(messages, *args, **kwargs)

        monkeypatch.setattr(model, "_generate", _capture)

        runtime = LangGraphRuntime(_make_config(tmp_path, "no-persona-session"))

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            return_value=model,
        ):
            await runtime.connect()

        try:
            await _drive(runtime, "hello", 4)
        finally:
            await runtime.disconnect()

        assert seen
        assert not any(isinstance(message, SystemMessage) for message in seen[0])


class TestRealGraphResume:
    @pytest.mark.anyio
    async def test_reopened_thread_keeps_prior_messages(self, tmp_path):
        """A second runtime over the same session_dir continues the conversation.

        First disconnects before second builds; thread survives only via checkpoint file (container-restart route).
        """

        first = await _connected_runtime(tmp_path, [AIMessage(content="remembered")])

        try:
            await _drive(first, "remember this", 4)
        finally:
            await first.disconnect()

        checkpoints = tmp_path / "checkpoints.sqlite"
        assert checkpoints.exists(), "the turn must have been checkpointed to disk"
        assert checkpoints.stat().st_size > 0

        second = await _connected_runtime(tmp_path, [AIMessage(content="still here")])

        try:
            events = await _drive(second, "still there?", 4)

            assert second._graph is not None
            state = await second._graph.aget_state(
                {"configurable": {"thread_id": second._thread_id}},
            )
        finally:
            await second.disconnect()

        # A reopened session announces itself again before driving the turn.
        assert [e.kind for e in events] == [
            "system_init",
            "user_message",
            "assistant_message",
            "result",
        ]

        # Both turns survive in the thread, not just the one that just ran.
        texts = [getattr(message, "content", "") for message in state.values["messages"]]
        assert "remember this" in texts
        assert "still there?" in texts


class TestContextUsageSeededOnResume:
    """A resumed thread's context bar must read the real size, not zero, before any reply."""

    @pytest.mark.anyio
    async def test_seeded_from_the_checkpointed_reply_before_any_turn_runs(self, tmp_path):
        first = await _connected_runtime(
            tmp_path,
            [
                AIMessage(
                    content="remembered",
                    usage_metadata={"input_tokens": 400, "output_tokens": 80, "total_tokens": 480},
                ),
            ],
        )

        try:
            await _drive(first, "remember this", 4)
        finally:
            await first.disconnect()

        second = await _connected_runtime(tmp_path, [AIMessage(content="unused")])

        try:
            usage = await second.get_context_usage()
        finally:
            await second.disconnect()

        assert usage is not None
        assert usage.used_tokens == 480

    @pytest.mark.anyio
    async def test_a_thread_with_no_history_still_reads_zero(self, tmp_path):
        """A session that never took a turn has nothing to seed from - zero is correct."""

        runtime = await _connected_runtime(tmp_path, [AIMessage(content="unused")])

        try:
            usage = await runtime.get_context_usage()
        finally:
            await runtime.disconnect()

        assert usage is not None
        assert usage.used_tokens == 0

    @pytest.mark.anyio
    async def test_seeds_from_the_most_recent_reply_not_an_earlier_one(self, tmp_path):
        """Same as reopening after compaction: the latest call's total wins, not an earlier, larger figure."""

        first = await _connected_runtime(
            tmp_path,
            [
                AIMessage(
                    content="first",
                    usage_metadata={"input_tokens": 900, "output_tokens": 60, "total_tokens": 960},
                ),
                AIMessage(
                    content="second",
                    usage_metadata={"input_tokens": 120, "output_tokens": 30, "total_tokens": 150},
                ),
            ],
        )

        try:
            await _drive(first, "first message", 4)
            await _drive(first, "second message", 4)
        finally:
            await first.disconnect()

        second = await _connected_runtime(tmp_path, [AIMessage(content="unused")])

        try:
            usage = await second.get_context_usage()
        finally:
            await second.disconnect()

        assert usage is not None
        assert usage.used_tokens == 150
