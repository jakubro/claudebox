"""End-to-end tests for a session needing the user, from agent events to the session listing.

Real projection, ``session.json`` and daemon sessions route; only a fork's container side is stubbed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.agent_session.orchestration.models import PublishedEvent
from claudebox.agent_session.orchestration.projection import Projection
from claudebox.core.io import read_json, write_json
from claudebox.workspace import Workspace
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.sessions import router


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    (tmp_path / ".workspace").touch()
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_path))

    return tmp_path


@pytest.fixture
def service(workspace):
    containers = MagicMock()
    containers.find_by_session = AsyncMock(return_value=None)
    containers.list_all = MagicMock(return_value=[])

    return SessionService(
        RegisteredWorkspace(id="ws", path=workspace),
        containers,
        AsyncMock(),
        agent="claude",
        executor=ObservedPool(1, name="listing"),
    )


@pytest.fixture
def listing(service, workspace):
    app = FastAPI()
    app.include_router(router)

    async def _workspace(workspace_id: str):
        return SimpleNamespace(session_service=service, workspace=SimpleNamespace(path=workspace))

    app.dependency_overrides[get_workspace] = _workspace
    client = TestClient(app)

    def _needs_user() -> dict[str, str | None]:
        sessions = client.get("/api/workspaces/ws/sessions").json()["sessions"]

        return {s["session_id"]: s["needs_user"] for s in sessions}

    return _needs_user


def _session(workspace, session_id: str, **lineage) -> Projection:
    projection = Projection(session_id, Workspace(start_dir=workspace))
    projection.save()

    if lineage:
        write_json(projection._path, {**read_json(projection._path), **lineage})

    return projection


def _event(n: int, **fields) -> PublishedEvent:
    defaults: dict = {
        "type": "assistant",
        "subtype": "text",
        "content": None,
        "primary": True,
        "is_human": False,
        "raw": {},
        "id": f"e{n}",
        "ts": datetime.now(UTC),
        "turn_id": "t1",
    }

    return PublishedEvent(**(defaults | fields))


def _tool(name: str, tool_input: dict) -> PublishedEvent:
    return _event(1, subtype="tool_use", tool_name=name, tool_input=tool_input)


def _reply(text: str) -> PublishedEvent:
    return _event(2, type="user", subtype="text", is_human=True, content=text)


def _apply(projection: Projection, *events: PublishedEvent) -> None:
    for event in events:
        projection.update(event)

    projection.save()


# SPEC: notify:needs-you
def test_agent_signal_is_listed_with_its_reason(workspace, listing):
    session = _session(workspace, "s-signal")

    _apply(session, _tool("mcp__claudebox__needs_user", {"reason": "Decide: retry state"}))

    assert listing()["s-signal"] == "Decide: retry state"


# SPEC: notify:needs-you
def test_langgraph_signal_is_listed_the_same_way(workspace, listing):
    session = _session(workspace, "s-langgraph")

    _apply(session, _tool("needs_user", {"reason": "Blocked: staging credentials missing"}))

    assert listing()["s-langgraph"] == "Blocked: staging credentials missing"


# SPEC: notify:needs-you-forms
def test_question_and_plan_forms_mark_the_session(workspace, listing):
    asking = _session(workspace, "s-question")
    planning = _session(workspace, "s-plan")

    _apply(asking, _tool("AskUserQuestion", {"questions": [{"question": "Which database?"}]}))
    _apply(planning, _tool("ExitPlanMode", {"plan": "1. Migrate"}))

    assert listing()["s-question"] == "Which database?"
    assert listing()["s-plan"] == "Approve the plan"


# SPEC: notify:needs-you-clears
def test_reply_clears_it_and_a_plain_finish_never_sets_it(workspace, listing):
    answered = _session(workspace, "s-answered")
    finished = _session(workspace, "s-finished")

    _apply(answered, _tool("needs_user", {"reason": "Decide: A or B"}), _reply("A"))
    _apply(finished, _event(3, type="result", subtype="success"))

    assert listing() == {"s-answered": None, "s-finished": None}


# SPEC: notify:needs-you-persists
def test_state_survives_a_stop_and_resume(workspace, listing):
    _apply(_session(workspace, "s-resumed"), _tool("needs_user", {"reason": "Decide: A"}))

    resumed = Projection("s-resumed", Workspace(start_dir=workspace))

    assert resumed.value.needs_user == "Decide: A"
    assert listing()["s-resumed"] == "Decide: A"


# SPEC: notify:needs-you-fork
@pytest.mark.anyio
async def test_fork_starts_without_it(workspace, service, listing):
    _apply(_session(workspace, "s-parent"), _tool("needs_user", {"reason": "Decide: A"}))
    service._containers.find_by_session = AsyncMock(
        return_value=Container(
            id="ctr-1",
            backend_id="backend-1",
            port=8080,
            status=ContainerStatus.RUNNING,
            session_id="s-parent",
        ),
    )
    service._containers.update = AsyncMock()
    folder = Workspace(workspace).sdk_projects_root / "-ws"
    folder.mkdir(parents=True)
    (folder / "s-parent.jsonl").write_text('{"type":"user","uuid":"t1"}\n')

    with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as client_cls:
        client = AsyncMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.post = AsyncMock(return_value=MagicMock())
        client_cls.return_value = client
        fork = await service.fork("s-parent", reuse_container=True)

    service._containers.find_by_session = AsyncMock(return_value=None)

    assert listing() == {"s-parent": "Decide: A", fork.session_id: None}


# SPEC: notify:needs-you-spawned
def test_spawned_session_never_needs_you_but_its_fork_can(workspace, listing):
    spawned = _session(workspace, "s-spawned", spawned_from_session_id="s-parent")
    spawned_fork = _session(workspace, "s-spawned-fork", parent_session_id="s-spawned")

    for session in (spawned, spawned_fork):
        _apply(session, _tool("AskUserQuestion", {"questions": [{"question": "Which branch?"}]}))

    assert listing() == {"s-spawned": None, "s-spawned-fork": "Which branch?"}


# SPEC: notify:needs-you-side-thread
def test_side_thread_never_needs_you(workspace, listing):
    thread = _session(workspace, "s-thread", is_side_thread=True, parent_session_id="s-main")

    _apply(thread, _tool("needs_user", {"reason": "Decide: A"}))

    assert listing()["s-thread"] is None
