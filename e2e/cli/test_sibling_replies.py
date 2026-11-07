"""End-to-end tests for a sibling session's turn ends reaching the session that spawned it.

Two real sessions on the Claude runtime against a scripted agent CLI, the real spawn socket and the
daemon's real delivery; only the containers are stand-ins, the parent's reached in-process.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session._sibling_sessions import SiblingSessionClient, report_sibling_turn_end
from claudebox.agent_session.hooks import CompactStartPayload
from claudebox.agent_session.orchestration.models import EventSubtype, EventType
from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from claudebox.agent_session.orchestration.sibling_turns import SiblingMessage
from claudebox.core.io import read_json, write_json
from claudebox.workspace import Workspace
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService as DaemonSessions
from claudebox_daemon.domain.sessions.spawn import SpawnListener
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from .scripted_cli import ScriptedCli


if TYPE_CHECKING:
    from claudebox_daemon.domain.containers import ContainerService


class _Cli(ScriptedCli):
    """Answer a sibling's message with "noted" and anything else with "PONG"."""

    def reply(self) -> list:
        from claude_agent_sdk import AssistantMessage
        from claude_agent_sdk.types import TextBlock

        lines = self.transcript.read_text().splitlines()
        last = json.loads(lines[-1])["message"]
        text = "noted" if "<sibling-message" in str(last) else "PONG"

        return [AssistantMessage(content=[TextBlock(text=text)], model="m"), self.result(text)]


class _Containers:
    """The parent's container, reached in-process; any other is the sibling, which the socket names."""

    def __init__(self, parent: ContainerSession, parent_id: str, sibling_id: str) -> None:
        self.parent, self.parent_id = parent, parent_id
        self.parent_running = True
        self.sibling = Container(
            id="ctr-sib",
            backend_id="b-sib",
            port=1,
            status=ContainerStatus.RUNNING,
            session_id=sibling_id,
        )
        self._parent = Container(
            id="ctr-parent",
            backend_id="b-parent",
            port=1,
            status=ContainerStatus.RUNNING,
            session_id=parent_id,
        )

    async def find_by_session(self, session_id: str, *, sync: bool = False) -> Container | None:
        if session_id == self.parent_id:
            return self._parent if self.parent_running else None

        return self.sibling if session_id == self.sibling.session_id else None

    async def find_by_peer_pid(self, _pid: int) -> Container:
        return self.sibling

    async def send(self, payload, container_id: str, endpoint: str, method: str) -> dict:
        assert container_id == "ctr-parent"
        assert endpoint == f"api/sibling-message?session_id={self.parent_id}"
        await self.parent.deliver_sibling_message(SiblingMessage(**payload))

        return {}


def _record_path(workspace: Path, session_id: str) -> Path:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None

    return session.path / "session.json"


def _events(workspace: Path, session_id: str) -> list[dict]:
    session = Workspace(start_dir=workspace).find_session(session_id)
    path = session.path / "events.jsonl" if session else None

    if path is None or not path.exists():
        return []

    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _siblings(workspace: Path, session_id: str) -> list[dict]:
    return [
        e
        for e in _events(workspace, session_id)
        if e["type"] == EventType.SYSTEM and e["subtype"] == EventSubtype.SIBLING_MESSAGE
    ]


async def _until(predicate, timeout: float = 10.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.05)


async def _send_and_wait(session, workspace, session_id, prompt) -> None:
    def results():
        return sum(1 for e in _events(workspace, session_id) if e["type"] == "result")

    done = results()
    await session.send(prompt)
    await _until(lambda: results() > done)


@pytest.fixture
async def pair(workspace, monkeypatch):
    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", _Cli):
        parent = ContainerSession(workspace=workspace, remaps_tmp=False)
        parent_id = await parent.start()
        await _send_and_wait(parent, workspace, parent_id, "hello")
        write_json(
            _record_path(workspace, parent_id),
            {
                **read_json(
                    _record_path(workspace, parent_id),
                ),
                "name": "planner",
            },
        )

        sibling = ContainerSession(
            workspace=workspace,
            remaps_tmp=False,
            report_turn_end=report_sibling_turn_end,
        )
        sibling_id = await sibling.start()
        write_json(
            Workspace(start_dir=workspace).ensure_session(sibling_id).path / "session.json",
            {"spawned_from_session_id": parent_id, "name": "lint-fix"},
        )

        containers = _Containers(parent, parent_id, sibling_id)
        ws = RegisteredWorkspace(id="ws", path=workspace)
        daemon = DaemonSessions(
            ws,
            cast("ContainerService", containers),
            MagicMock(broadcast=AsyncMock()),
            agent="claude",
            executor=ObservedPool(1, name="listing"),
        )

        with tempfile.TemporaryDirectory(dir="/tmp") as socket_dir:
            listener = SpawnListener(
                ws,
                daemon,
                cast("ContainerService", containers),
                Path(socket_dir),
                ports=MagicMock(),
            )
            await listener.start()

            async def dial(_path):
                return await asyncio.open_unix_connection(path=str(listener.socket_path))

            monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", staticmethod(dial))

            try:
                yield {
                    "workspace": workspace,
                    "parent": parent,
                    "parent_id": parent_id,
                    "sibling": sibling,
                    "sibling_id": sibling_id,
                    "containers": containers,
                }
            finally:
                await sibling.stop()
                await parent.stop()
                await listener.stop()


# SPEC: runtime:sibling-replies
@pytest.mark.anyio
async def test_each_sibling_turn_end_arrives_in_the_parent_in_order(pair):
    workspace, sibling, sibling_id = pair["workspace"], pair["sibling"], pair["sibling_id"]

    await _send_and_wait(sibling, workspace, sibling_id, "first job")
    await _send_and_wait(sibling, workspace, sibling_id, "second job")
    await _until(lambda: len(_siblings(workspace, pair["parent_id"])) == 2)

    arrived = _siblings(workspace, pair["parent_id"])
    assert [(e["content"], e["message_data"]["from_session_id"]) for e in arrived] == [
        ("PONG", sibling_id),
        ("PONG", sibling_id),
    ]
    assert arrived[0]["message_data"]["from_name"] == "lint-fix"
    assert not any(
        e["is_human"] and "<sibling-message" in (e["content"] or "")
        for e in _events(workspace, pair["parent_id"])
    )


# SPEC: notify:needs-you-sibling-message
@pytest.mark.anyio
@pytest.mark.parametrize("needs_user", ["Decide: R", None])
async def test_a_sibling_message_leaves_the_parents_needs_you_as_it_was(pair, needs_user):
    workspace, parent = pair["workspace"], pair["parent"]
    parent._projection.update_fields(
        needs_user=needs_user,
        needs_user_replies=["Go"] if needs_user else None,
    )

    await _send_and_wait(pair["sibling"], workspace, pair["sibling_id"], "job")
    await _until(lambda: len(_siblings(workspace, pair["parent_id"])) == 1)
    await _until(lambda: _events(workspace, pair["parent_id"])[-1]["type"] == "result")

    record = read_json(
        _record_path(workspace, pair["parent_id"]),
    )
    assert record["needs_user"] == needs_user
    assert record["needs_user_replies"] == (["Go"] if needs_user else None)


# SPEC: runtime:sibling-replies-held
@pytest.mark.anyio
async def test_a_turn_end_for_a_stopped_parent_waits_and_goes_ahead_of_its_next_message(pair):
    workspace, parent, parent_id = pair["workspace"], pair["parent"], pair["parent_id"]
    pair["containers"].parent_running = False
    before = len(_events(workspace, parent_id))

    await _send_and_wait(pair["sibling"], workspace, pair["sibling_id"], "job")
    held = _record_path(workspace, parent_id).with_name("sibling-messages.pending.jsonl")
    await _until(held.exists)
    await asyncio.sleep(0.2)

    assert len(_events(workspace, parent_id)) == before

    await _send_and_wait(parent, workspace, parent_id, "my next message")
    await _until(
        lambda: any(e["content"] == "my next message" for e in _events(workspace, parent_id)),
    )
    after = _events(workspace, parent_id)[before:]
    kinds = [
        (e["subtype"], e["content"])
        for e in after
        if e["subtype"] in ("sibling_message", "message")
    ]

    assert kinds[:2] == [("sibling_message", "PONG"), ("message", "my next message")]
    assert not held.exists()


# SPEC: runtime:sibling-briefed
@pytest.mark.anyio
async def test_the_sibling_is_briefed_on_its_first_turn_and_again_after_compacting(pair):
    workspace, sibling, sibling_id = pair["workspace"], pair["sibling"], pair["sibling_id"]

    await _send_and_wait(sibling, workspace, sibling_id, "first job")
    await sibling._on_compact_start(CompactStartPayload(trigger="manual"))
    await sibling._event_pipeline.inject_event(
        event_type=EventType.SYSTEM,
        subtype=EventSubtype.COMPACT_BOUNDARY,
    )
    transcript = sibling._sdk_client._sdk.transcript
    await _until(lambda: len(transcript.read_text().splitlines()) >= 2)

    told = [json.loads(line)["message"] for line in transcript.read_text().splitlines()]
    first, after_compaction = str(told[0]), str(told[-1])

    for text in (first, after_compaction):
        assert f'<sibling-brief session="{pair["parent_id"]}" name="planner">' in text
        assert "end your turn with the question in plain text" in text

    assert first.startswith("first job")
