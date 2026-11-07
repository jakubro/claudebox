"""End-to-end tests for a new session before its first message: attachments, a session prompt, a name.

Real container routes, registry, pipeline and Claude runtime with a scripted CLI; renames via the daemon.
"""

from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import claudebox_container_api.session as container_session
from claudebox.session.repository import SessionRepository
from claudebox.workspace import Workspace
from claudebox_container_api.handlers import api_router
from claudebox_container_api.session import SessionRegistry
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService as DaemonSessions
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.sessions import router as daemon_sessions_router
from .scripted_cli import ScriptedCli


pytestmark = pytest.mark.usefixtures("claude_runtime_env")


PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="


@pytest.fixture
async def container(workspace, monkeypatch):
    registry = SessionRegistry(workspace=workspace, system_prompt_file=None, permission_mode=None)
    monkeypatch.setattr(container_session, "registry", registry)
    app = FastAPI()
    app.include_router(api_router)

    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", ScriptedCli):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://container",
        ) as client:
            yield client

        await registry.stop_all()


def _session_dir(workspace: Path, session_id: str) -> Path:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None

    return session.path


async def _until(predicate, timeout: float = 10) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.05)


def _events(workspace: Path, session_id: str) -> list[dict]:
    path = _session_dir(workspace, session_id) / "events.jsonl"

    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


# SPEC: input:attachment-first-message
@pytest.mark.anyio
async def test_a_new_sessions_first_message_takes_its_attachments(workspace, container):
    session_id = (await container.post("/api/sessions/new")).json()["session_id"]
    attachments = [
        {
            "name": "notes.txt",
            "type": "text/plain",
            "data": base64.b64encode(b"line one\n").decode(),
        },
        {"name": "dot.png", "type": "image/png", "data": PNG},
    ]

    response = await container.post(
        f"/api/send?session_id={session_id}",
        json={"prompt": "reply with ok", "attachments": attachments},
    )

    assert response.status_code == 200
    await _until(lambda: any(e["type"] == "result" for e in _events(workspace, session_id)))
    stored = sorted(
        p.name.split("_", 1)[1]
        for p in (_session_dir(workspace, session_id) / "attachments").iterdir()
    )
    assert stored == ["dot.png", "notes.txt"]
    (human,) = [
        e for e in _events(workspace, session_id) if e["type"] == "user" and e.get("is_human")
    ]
    assert sorted(a["name"] for a in human["attachments"]) == ["dot.png", "notes.txt"]


# SPEC: chat:session-prompt-before-first-message
@pytest.mark.anyio
async def test_a_session_prompt_set_before_the_first_message_is_kept(workspace, container):
    session_id = (await container.post("/api/sessions/new")).json()["session_id"]

    response = await container.patch(
        f"/api/sessions/current/prompt?session_id={session_id}",
        json={"session_prompt": "keep it short"},
    )

    assert response.status_code == 200
    current = (await container.get(f"/api/sessions/current?session_id={session_id}")).json()
    assert current["session_prompt"] == "keep it short"
    record = json.loads((_session_dir(workspace, session_id) / "session.json").read_text())
    assert record["session_prompt"] == "keep it short"
    (listed,) = SessionRepository(Workspace(start_dir=workspace)).list_all()
    assert (listed.session_id, listed.num_turns) == (session_id, 0)


# SPEC: panel-session:rename-before-first-message
def test_a_session_renamed_before_its_first_message_is_listed_under_that_name(workspace):
    session_id = "11111111-2222-3333-4444-555555555555"
    Workspace(start_dir=workspace).ensure_session(session_id)
    containers = MagicMock(list_all=MagicMock(return_value=[]))
    containers.find_by_session = AsyncMock(return_value=None)
    service = DaemonSessions(
        RegisteredWorkspace(id="ws", path=workspace),
        containers,
        AsyncMock(),
        agent="claude",
        executor=ObservedPool(1, name="listing"),
    )
    app = FastAPI()
    app.include_router(daemon_sessions_router)
    app.dependency_overrides[get_workspace] = lambda workspace_id: SimpleNamespace(
        session_service=service,
    )
    client = TestClient(app)

    response = client.patch(
        f"/api/workspaces/ws/sessions/{session_id}",
        json={"name": "named early"},
    )

    assert response.status_code == 200
    (listed,) = client.get("/api/workspaces/ws/sessions").json()["sessions"]
    assert (listed["session_id"], listed["name"]) == (session_id, "named early")
    assert not listed["num_turns"]
