"""Turn identity end to end, send to saved log: real session and runtime, a scripted agent CLI."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

import pytest
from claude_agent_sdk import AssistantMessage, SystemMessage, UserMessage
from claude_agent_sdk.types import TextBlock, ToolResultBlock, ToolUseBlock

from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from claudebox.workspace import Workspace
from .scripted_cli import ScriptedCli


ANSWER = "Migration 0007 is pending."
NOT_LOGGED_IN = "Not logged in · Please run /login"


class _ToolTurnCli(ScriptedCli):
    failing = False

    def reply(self) -> list:
        call = AssistantMessage(
            content=[ToolUseBlock(id="tu_1", name="Bash", input={"command": "ls migrations/"})],
            model="m",
        )
        result = UserMessage(
            [ToolResultBlock(tool_use_id="tu_1", content="0007_add_index.py")],
            uuid="tool-result-1",
            tool_use_result={"stdout": "0007_add_index.py"},
        )
        background = UserMessage(
            [ToolResultBlock(tool_use_id="tu_9", content="12 files")],
            uuid="background-result-1",
            parent_tool_use_id="tu_bg",
        )

        if self.failing:
            failure = AssistantMessage(
                content=[TextBlock(text=NOT_LOGGED_IN)],
                model="m",
                error="authentication_failed",
            )

            return [call, result, background, failure, self.result(NOT_LOGGED_IN, is_error=True)]

        answer = AssistantMessage(content=[TextBlock(text=ANSWER)], model="m")

        return [call, result, answer, background, self.result(ANSWER)]


class _FailingToolTurnCli(_ToolTurnCli):
    failing = True


class _StreamEndsWhenIdleCli(ScriptedCli):
    answered = False

    async def receive_response(self) -> AsyncIterator:
        if self.answered:
            return

        async for message in super().receive_response():
            yield message

        self.answered = True


class _FollowUpThenStreamEndsCli(_StreamEndsWhenIdleCli):
    async def receive_response(self) -> AsyncIterator:
        if self.answered:
            yield SystemMessage(
                subtype="task_notification",
                data={"task_id": "agent_1", "status": "completed", "summary": "Audit done"},
            )
            yield AssistantMessage(
                content=[TextBlock(text="The audit found two issues.")],
                model="m",
            )

            return

        async for message in super().receive_response():
            yield message


class _FailsToStartOnResumeCli(ScriptedCli):
    def __init__(self, options):
        self._resuming = "resume" in options.extra_args

        if not self._resuming:
            super().__init__(options)

    async def connect(self) -> None:
        if self._resuming:
            raise RuntimeError("agent process exited with code 1")


class _ConnectionDropsBeforeEchoCli(_StreamEndsWhenIdleCli):
    def __init__(self, options):
        super().__init__(options)
        self._sent = asyncio.Event()

    async def query(self, prompt) -> None:
        if self.answered:
            self._sent.set()

            return

        await super().query(prompt)

    async def receive_response(self) -> AsyncIterator:
        if self.answered:
            await self._sent.wait()

            return

        async for message in super().receive_response():
            yield message


class _UnechoedUnknownCommandCli(ScriptedCli):
    async def query(self, prompt) -> None:
        if isinstance(prompt, str) and prompt.startswith("/"):
            await self._out.put(self.result("Unknown skill: reveiw"))

            return

        await super().query(prompt)


def _events(workspace: Path, session_id: str) -> list[dict]:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None
    path = session.path / "events.jsonl"

    if not path.exists():
        return []

    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


@asynccontextmanager
async def _session(workspace: Path, cli: type) -> AsyncGenerator[tuple[ContainerSession, str]]:
    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", cli):
        session = ContainerSession(workspace=workspace, remaps_tmp=False)
        session_id = await session.start()

        try:
            yield session, session_id
        finally:
            await session.stop()


async def _until(workspace: Path, session_id: str, done: Callable[[list[dict]], bool]) -> None:
    async with asyncio.timeout(10):
        while not done(_events(workspace, session_id)):
            await asyncio.sleep(0.05)


def _results(events: list[dict]) -> int:
    return sum(e["type"] == "result" for e in events)


def _answered(events: list[dict]) -> bool:
    return _results(events) > 0


def _failed(events: list[dict]) -> bool:
    return any(e["subtype"] == "error" for e in events)


async def _one_turn(workspace: Path, cli: type[ScriptedCli]) -> list[dict]:
    async with _session(workspace, cli) as (session, session_id):
        await session.send("run the migration")
        await _until(workspace, session_id, _answered)

    return _events(workspace, session_id)


def _outcomes(events: list[dict]) -> list[tuple[str, str | None]]:
    return [
        (e["subtype"], e["turn_id"])
        for e in events
        if e["type"] in ("result", "system") and e["subtype"] in ("success", "error")
    ]


def _after_the_persons_message(events: list[dict]) -> tuple[dict, list[dict]]:
    (human,) = [e for e in events if e["type"] == "user" and e.get("is_human")]

    return human, events[events.index(human) + 1 :]


# SPEC: chat:turn-outcome-after-tools
@pytest.mark.anyio
@pytest.mark.parametrize("cli", [_ToolTurnCli, _FailingToolTurnCli], ids=["answered", "failed"])
async def test_every_event_of_a_tool_turn_belongs_to_the_turn_the_person_opened(workspace, cli):
    human, after = _after_the_persons_message(await _one_turn(workspace, cli))

    assert {e["subtype"] for e in after} >= {"tool_use", "tool_result", "success"}
    assert [f"{e['type']}/{e['subtype']}" for e in after if e["turn_id"] != human["turn_id"]] == []


# SPEC: chat:turn-outcome-after-tools
@pytest.mark.anyio
async def test_a_failure_after_a_tool_call_is_the_outcome_of_the_turn_that_asked(workspace):
    human, after = _after_the_persons_message(await _one_turn(workspace, _FailingToolTurnCli))

    assert [(e["type"], e["subtype"], e["turn_id"]) for e in after if e["type"] != "assistant"][
        -2:
    ] == [
        ("system", "error", human["turn_id"]),
        ("result", "success", human["turn_id"]),
    ]


# SPEC: chat:answer-shown-once
@pytest.mark.anyio
async def test_the_closing_message_is_saved_once_when_a_background_result_follows_it(workspace):
    _, after = _after_the_persons_message(await _one_turn(workspace, _ToolTurnCli))

    assert [e["content"] for e in after if e["type"] == "assistant"].count(ANSWER) == 1
    assert [e["subtype"] for e in after if e["type"] == "result"] == ["success"]


# SPEC: chat:failure-between-turns
@pytest.mark.anyio
async def test_a_connection_ending_after_the_turn_finished_leaves_the_turn_alone(workspace):
    async with _session(workspace, _StreamEndsWhenIdleCli) as (session, session_id):
        await session.send("run the migration")
        await _until(workspace, session_id, _failed)

    human, after = _after_the_persons_message(_events(workspace, session_id))

    assert _outcomes(after) == [("success", human["turn_id"]), ("error", None)]


# SPEC: chat:failure-between-turns
@pytest.mark.anyio
async def test_a_start_failure_after_a_restart_leaves_the_finished_turn_alone(workspace):
    async with _session(workspace, _FailsToStartOnResumeCli) as (session, session_id):
        await session.send("run the migration")
        await _until(workspace, session_id, _answered)
        await session.restart(session_id)
        await _until(workspace, session_id, _failed)

    human, after = _after_the_persons_message(_events(workspace, session_id))
    (failure,) = [e for e in after if e["subtype"] == "error"]

    assert failure["content"].startswith("Failed to start:")
    assert _outcomes(after) == [("success", human["turn_id"]), ("error", None)]


# SPEC: chat:failure-between-turns
@pytest.mark.anyio
async def test_a_connection_ending_during_a_follow_up_marks_the_turn(workspace):
    async with _session(workspace, _FollowUpThenStreamEndsCli) as (session, session_id):
        await session.send("run the migration")
        await _until(workspace, session_id, _failed)

    human, after = _after_the_persons_message(_events(workspace, session_id))

    assert _outcomes(after) == [("success", human["turn_id"]), ("error", human["turn_id"])]


# SPEC: chat:result-only-reply
@pytest.mark.anyio
async def test_a_reply_that_is_only_a_result_lands_on_its_own_question(workspace):
    async with _session(workspace, _UnechoedUnknownCommandCli) as (session, session_id):
        await session.send("run the migration")
        await _until(workspace, session_id, _answered)
        await session.send("/reveiw everything")
        await _until(workspace, session_id, lambda events: _results(events) == 2)

    events = _events(workspace, session_id)
    first, question = [e for e in events if e.get("is_human")]
    after = events[events.index(question) + 1 :]

    assert question["content"] == "/reveiw everything"
    assert question["turn_id"] != first["turn_id"]
    assert [(e["type"], e["subtype"], e["content"], e["turn_id"]) for e in after] == [
        ("assistant", "text", "Unknown skill: reveiw", question["turn_id"]),
        ("result", "error", "Unknown skill: reveiw", question["turn_id"]),
    ]
    assert [e["subtype"] for e in events[: events.index(question)] if e["type"] == "result"] == [
        "success",
    ]


# SPEC: chat:unacknowledged-message-failed
@pytest.mark.anyio
async def test_a_message_the_agent_never_acknowledged_shows_as_its_own_failed_turn(workspace):
    async with _session(workspace, _ConnectionDropsBeforeEchoCli) as (session, session_id):
        await session.send("run the migration")
        await _until(workspace, session_id, _answered)
        await session.send("and the next one")
        await _until(workspace, session_id, _failed)

    events = _events(workspace, session_id)
    first, question = [e for e in events if e.get("is_human")]

    assert question["content"] == "and the next one"
    assert question["turn_id"] != first["turn_id"]
    assert _outcomes(events) == [("success", first["turn_id"]), ("error", question["turn_id"])]
