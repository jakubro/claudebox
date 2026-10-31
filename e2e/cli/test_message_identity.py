"""End-to-end tests for a message's identity, from a send to the saved transcript and a fork's agent.

Real session, pipeline, turn tracker and Claude runtime with a scripted CLI; the daemon's real fork cuts it.
"""

from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from claudebox.workspace import Workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService as DaemonSessions
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from .scripted_cli import PROJECT, ScriptedCli


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    (tmp_path / ".workspace").touch()
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.chdir(tmp_path)

    return tmp_path


async def _started_session(workspace: Path) -> tuple[ContainerSession, str]:
    session = ContainerSession(workspace=workspace, remaps_tmp=False)
    session_id = await session.start()

    return session, session_id


def _events(workspace: Path, session_id: str) -> list[dict]:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None
    path = session.path / "events.jsonl"

    if not path.exists():
        return []

    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


async def _send_and_wait(session, workspace, session_id, prompt, **kwargs) -> None:
    done = sum(1 for e in _events(workspace, session_id) if e["type"] == "result")
    await session.send(prompt, **kwargs)

    async with asyncio.timeout(10):
        while sum(1 for e in _events(workspace, session_id) if e["type"] == "result") <= done:
            await asyncio.sleep(0.05)


def _text_file(name: str, text: str) -> dict:
    return {"name": name, "type": "text/plain", "data": base64.b64encode(text.encode()).decode()}


def _image() -> dict:
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="

    return {"name": "dot.png", "type": "image/png", "data": png}


@pytest.fixture
def scripted_cli():
    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", ScriptedCli):
        yield


# SPEC: chat:attachment-text-once
@pytest.mark.anyio
async def test_a_text_file_message_is_saved_once_and_answered_in_its_own_turn(
    workspace,
    scripted_cli,
):
    session, session_id = await _started_session(workspace)

    try:
        await _send_and_wait(session, workspace, session_id, "ready?")
        await _send_and_wait(
            session,
            workspace,
            session_id,
            "please review",
            attachments=[_text_file("notes.txt", "line one ZEBRA-4417\n")],
        )
    finally:
        await session.stop()

    events = _events(workspace, session_id)
    humans = [e for e in events if e["type"] == "user" and e.get("is_human")]
    leaked = [
        e
        for e in events
        if e["type"] == "user" and e["subtype"] == "text" and not e.get("is_human")
    ]
    reply_turn = humans[-1]["turn_id"]

    assert [h["content"] for h in humans] == ["ready?", "please review"]
    assert leaked == []
    assert not any("ZEBRA-4417" in str(e.get("content")) for e in events if e["type"] != "user")
    assert {e["turn_id"] for e in events if e["type"] in ("assistant", "result")} >= {reply_turn}
    assert [e["turn_id"] for e in events if e["type"] == "result"][-1] == reply_turn


def _daemon(workspace: Path) -> DaemonSessions:
    containers = MagicMock()
    containers.create = AsyncMock(return_value=MagicMock(id="c-fork"))
    containers.list_all = MagicMock(return_value=[])
    service = DaemonSessions(
        RegisteredWorkspace(id="ws", path=workspace),
        containers,
        AsyncMock(),
        agent="claude",
        executor=ObservedPool(1, name="listing"),
    )
    service._wait_for_health = AsyncMock()
    service._start_session_in = AsyncMock()

    return service


def _transcript_messages(workspace: Path, session_id: str) -> list:
    path = Workspace(start_dir=workspace).sdk_projects_root / PROJECT / f"{session_id}.jsonl"

    return [json.loads(line)["message"] for line in path.read_text().splitlines() if line.strip()]


async def _fork_at_second_message(workspace, middle_kwargs) -> list:
    session, session_id = await _started_session(workspace)

    try:
        await _send_and_wait(session, workspace, session_id, "APPLE")
        await _send_and_wait(session, workspace, session_id, "BANANA", **middle_kwargs)
        await _send_and_wait(session, workspace, session_id, "CHERRY")
    finally:
        await session.stop()

    humans = [
        e for e in _events(workspace, session_id) if e["type"] == "user" and e.get("is_human")
    ]
    fork = await _daemon(workspace).fork(session_id, humans[1]["turn_id"])

    return _transcript_messages(workspace, fork.session_id)


# SPEC: chat:rewind-fork-forgets-later
@pytest.mark.anyio
async def test_a_fork_at_an_attachment_message_leaves_only_the_earlier_messages(
    workspace,
    scripted_cli,
):
    kept = await _fork_at_second_message(workspace, {"attachments": [_image()]})

    assert kept == ["APPLE"]


# SPEC: chat:rewind-fork-forgets-later
@pytest.mark.anyio
async def test_a_fork_at_an_inline_reply_message_leaves_only_the_earlier_messages(
    workspace,
    scripted_cli,
):
    replies = [{"quote": "ok", "from": "assistant", "response": "tell me more"}]
    kept = await _fork_at_second_message(workspace, {"inline_replies": replies})

    assert kept == ["APPLE"]
