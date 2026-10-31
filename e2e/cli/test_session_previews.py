"""End-to-end tests for message previews, from a session's own record to the sessions listing.

Real projection, ``session.json`` and daemon sessions route; no container is involved.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.agent_session.orchestration.models import PublishedEvent
from claudebox.agent_session.orchestration.projection import Projection
from claudebox.core.io import read_json
from claudebox.workspace import Workspace
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.sessions import router


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    (tmp_path / ".workspace").touch()
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))

    return tmp_path


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
