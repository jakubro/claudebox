"""End-to-end tests for message previews, from a session's own record to the sessions listing.

Real projection, ``session.json`` and daemon sessions route; a subagent's prompt also runs through the
real container routes, pipeline and Claude runtime with a scripted CLI.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from claude_agent_sdk import AssistantMessage, UserMessage
from claude_agent_sdk.types import TextBlock, ToolUseBlock
from fastapi import FastAPI
from fastapi.testclient import TestClient

import claudebox_container_api.session as container_session
from claudebox.agent_session.orchestration.models import PublishedEvent
from claudebox.agent_session.orchestration.projection import Projection
from claudebox.core.io import read_json
from claudebox.workspace import Workspace
from claudebox_container_api.handlers import api_router
from claudebox_container_api.session import SessionRegistry
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.sessions import router
from .scripted_cli import ScriptedCli


SUBAGENT_PROMPT = "Review the diff and list every hunk."


class SubagentCli(ScriptedCli):
    def reply(self) -> list:
        launch = ToolUseBlock(id="tu_agent", name="Task", input={"prompt": SUBAGENT_PROMPT})

        return [
            AssistantMessage(content=[launch], model="m"),
            UserMessage(SUBAGENT_PROMPT, parent_tool_use_id="tu_agent"),
            AssistantMessage(content=[TextBlock(text="done")], model="m"),
            self.result("done"),
        ]


@pytest.fixture
def client(workspace):
    containers = MagicMock(list_all=MagicMock(return_value=[]))
    service = SessionService(
        RegisteredWorkspace(id="ws", path=workspace),
        containers,
        AsyncMock(),
        agent="claude",
        executor=ObservedPool(1, name="listing"),
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_workspace] = lambda workspace_id: SimpleNamespace(
        session_service=service,
    )

    return TestClient(app)


@pytest.fixture
async def container(workspace, monkeypatch):
    registry = SessionRegistry(workspace=workspace, system_prompt_file=None, permission_mode=None)
    monkeypatch.setattr(container_session, "registry", registry)
    app = FastAPI()
    app.include_router(api_router)

    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", SubagentCli):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://container",
        ) as client:
            yield client

        await registry.stop_all()


def _prompted(workspace, session_id: str, *prompts: str) -> Projection:
    projection = Projection(session_id, Workspace(start_dir=workspace))

    for n, prompt in enumerate(prompts):
        projection.update(
            PublishedEvent(
                type="user",
                subtype="text",
                content=prompt,
                primary=True,
                is_human=True,
                raw={},
                id=f"e{n}",
                ts=datetime.now(UTC),
                turn_id=f"t{n}",
            ),
        )

    projection.save()

    return projection


# SPEC: panel-session:preview-tooltip
def test_long_prompts_are_listed_as_previews_and_kept_whole_on_disk(workspace, client):
    projection = _prompted(workspace, "s-long", "f" * 4000, "l" * 5000)

    (listed,) = client.get("/api/workspaces/ws/sessions").json()["sessions"]

    assert listed["first_message"] == "f" * 300 + "..."
    assert listed["last_message"] == "l" * 300 + "..."
    on_disk = read_json(projection._path)
    assert len(on_disk["first_message"]) == 4000
    assert len(on_disk["last_message"]) == 5000


# SPEC: panel-session:preview-tooltip
def test_short_prompts_are_listed_whole(workspace, client):
    _prompted(workspace, "s-short", "first prompt", "second prompt")

    (listed,) = client.get("/api/workspaces/ws/sessions").json()["sessions"]

    assert listed["first_message"] == "first prompt"
    assert listed["last_message"] == "second prompt"


# SPEC: panel-session:user-messages-only
@pytest.mark.anyio
@pytest.mark.usefixtures("claude_runtime_env")
async def test_a_subagents_prompt_is_neither_previewed_nor_counted_as_a_turn(
    workspace,
    container,
    client,
):
    session_id = (await container.post("/api/sessions/new")).json()["session_id"]
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None
    session_dir = session.path

    def results() -> int:
        log = session_dir / "events.jsonl"
        lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []

        return sum(json.loads(line)["type"] == "result" for line in lines)

    def turns() -> int:
        record = session_dir / "session.json"

        return json.loads(record.read_text(encoding="utf-8"))["num_turns"] if record.exists() else 0

    for n, prompt in enumerate(("launch a reviewer", "commit what it approved"), 1):
        response = await container.post(
            f"/api/send?session_id={session_id}",
            json={"prompt": prompt},
        )
        assert response.status_code == 200

        async with asyncio.timeout(10):
            while results() < n or turns() < n:
                await asyncio.sleep(0.05)

    (listed,) = client.get("/api/workspaces/ws/sessions").json()["sessions"]

    assert (listed["num_turns"], listed["first_message"], listed["last_message"]) == (
        2,
        "launch a reviewer",
        "commit what it approved",
    )
