"""End-to-end tests for a session opening: a picker change the agent refuses never swallows a message.

Real container routes and Claude runtime; the scripted CLI holds connect until released and refuses Bypass.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI

import claudebox_container_api.session as container_session
from claudebox.errors import ApiError
from claudebox.workspace import Workspace
from claudebox_container_api.app import handle_api_error
from claudebox_container_api.handlers import api_router
from claudebox_container_api.session import SessionRegistry
from .scripted_cli import ScriptedCli


REFUSAL = "Cannot set permission mode to bypassPermissions: not launched with skip-permissions"


class SlowStartingCli(ScriptedCli):
    connected = asyncio.Event()

    async def connect(self) -> None:
        await self.connected.wait()

    async def set_permission_mode(self, mode: str) -> None:
        if mode == "bypassPermissions":
            raise Exception(REFUSAL)  # noqa: TRY002 - the SDK reports a refusal as a bare Exception


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    (tmp_path / ".workspace").touch()
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))
    monkeypatch.setenv("CLAUDEBOX_NO_TMP_REMAP", "1")
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (tmp_path / "home" / ".claude").mkdir(parents=True)
    monkeypatch.chdir(tmp_path)

    return tmp_path


@pytest.fixture
async def container(workspace, monkeypatch):
    registry = SessionRegistry(workspace=workspace, system_prompt_file=None, permission_mode=None)
    monkeypatch.setattr(container_session, "registry", registry)
    monkeypatch.setattr(SlowStartingCli, "connected", asyncio.Event())
    app = FastAPI()
    app.add_exception_handler(ApiError, handle_api_error)  # ty: ignore[invalid-argument-type]
    app.include_router(api_router)

    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", SlowStartingCli):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://container",
        ) as client:
            yield client

        await registry.stop_all()


def _results(workspace: Path, session_id: str) -> list[dict]:
    session = Workspace(start_dir=workspace).find_session(session_id)

    if session is None or not (session.path / "events.jsonl").exists():
        return []

    events = [json.loads(line) for line in (session.path / "events.jsonl").read_text().splitlines()]

    return [e for e in events if e["type"] == "result"]


# SPEC: input:opening-refused-pick-answered
@pytest.mark.anyio
async def test_a_message_sent_beside_a_refused_pick_is_answered(workspace, container):
    session_id = (await container.post("/api/sessions/new")).json()["session_id"]

    pick = asyncio.create_task(
        container.post(
            f"/api/permission-mode?session_id={session_id}",
            json={"permission_mode": "bypassPermissions"},
        ),
    )
    await asyncio.sleep(0.1)
    send = await container.post(
        f"/api/send?session_id={session_id}",
        json={"prompt": "Reply with the single word: alpha"},
    )
    SlowStartingCli.connected.set()
    refused = await pick

    assert send.status_code == 200
    assert refused.status_code == 409
    assert refused.json()["error"] == "change_refused"
    assert refused.json()["reason"] == REFUSAL

    async with asyncio.timeout(10):
        while not _results(workspace, session_id):
            await asyncio.sleep(0.05)
