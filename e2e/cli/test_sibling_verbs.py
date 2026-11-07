"""End-to-end tests for the session tools an agent drives its siblings with.

The agent's own client talks to the real spawn socket and the daemon's real session service, records on
disk; only the containers and their HTTP surface are stand-ins.
"""

from __future__ import annotations

import asyncio
import json
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from claudebox.agent_session._sibling_sessions import (
    SESSION_LIST_CLAUDE_TOOL_NAME,
    SESSION_READ_CLAUDE_TOOL_NAME,
    SiblingSessionClient,
    SiblingSessionError,
)
from claudebox.agent_session.runtime_claude import ClaudeRuntime
from claudebox.core.io import read_json, write_json
from claudebox.workspace import Workspace
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.domain.sessions.spawn import SpawnListener
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


if TYPE_CHECKING:
    from claudebox_daemon.domain.containers import ContainerService


PARENT = "parent-0000"


class FakeContainers:
    """The containers a workspace runs, in memory; every request sent to one is recorded."""

    def __init__(self) -> None:
        self.containers: dict[str, Container] = {}
        self.caller: Container | None = None
        self.sent: list[tuple[str, str, dict]] = []
        self.created: list[dict] = []
        self.stopped: list[str] = []
        self.lost_prompts = False

    def run(self, session_id: str, *, threads: tuple[str, ...] = ()) -> Container:
        container = Container(
            id=f"ctr-{session_id}",
            backend_id=f"b-{session_id}",
            port=1,
            status=ContainerStatus.RUNNING,
            session_id=session_id,
            members=list(threads),
            live_session_ids=[session_id, *threads],
        )
        self.containers[container.id] = container

        return container

    async def find_by_session(self, session_id: str, *, sync: bool = False) -> Container | None:
        for container in self.containers.values():
            if container.session_id == session_id:
                return container

        return None

    async def find_by_peer_pid(self, _pid: int) -> Container | None:
        return self.caller

    def list_all(self) -> list[Container]:
        return list(self.containers.values())

    def get(self, container_id: str) -> Container:
        return self.containers[container_id]

    async def create(self, *_args, session_id: str | None = None, bundle: str | None = None, **_kw):
        self.created.append({"session_id": session_id, "bundle": bundle})
        container = Container(
            id=f"ctr-new-{len(self.created)}",
            backend_id="b",
            port=1,
            status=ContainerStatus.RUNNING,
            session_id=session_id,
        )
        self.containers[container.id] = container

        return container

    async def update(self, container: Container, **fields) -> None:
        for key, value in fields.items():
            setattr(container, key, value)

    def release_spawn(self, _container_id: str) -> None:
        pass

    async def stop_container(self, container_id: str, **_kw) -> None:
        self.stopped.append(container_id)

    async def remove(self, container_id: str) -> None:
        self.containers.pop(container_id, None)

    async def send(self, payload, container_id: str, endpoint: str, method: str) -> dict:
        self.sent.append((container_id, endpoint, payload))

        if self.lost_prompts and endpoint == "api/send":
            raise httpx.ConnectError("gone")

        return {}


def _record(workspace: Path, session_id: str, **fields) -> None:
    path = Workspace(start_dir=workspace).ensure_session(session_id).path / "session.json"
    write_json(
        path,
        {
            "session_id": session_id,
            "fork_point_cost_usd": 0.0,
            "started_at": datetime.now(UTC).isoformat(),
            **fields,
        },
    )


def _container_http():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/api/sessions/new"):
            return httpx.Response(200, json={"session_id": f"sib-{uuid.uuid4().hex[:8]}"})

        return httpx.Response(200, json={})

    real = httpx.AsyncClient

    def client(**kwargs: Any) -> httpx.AsyncClient:
        kwargs.setdefault("transport", httpx.MockTransport(handler))

        return real(**kwargs)

    return patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient", side_effect=client)


@pytest.fixture
async def world(workspace, monkeypatch):
    containers = FakeContainers()
    containers.caller = containers.run(PARENT)
    _record(workspace, PARENT, bundle=None)
    ws = RegisteredWorkspace(id="ws", path=workspace)
    sessions = SessionService(
        ws,
        cast("ContainerService", containers),
        MagicMock(broadcast=AsyncMock()),
        agent="claude",
        executor=ObservedPool(1, name="listing"),
    )
    monkeypatch.setattr(sessions, "_wait_for_health", AsyncMock(return_value={}))

    with tempfile.TemporaryDirectory(dir="/tmp") as socket_dir, _container_http():
        listener = SpawnListener(
            ws,
            sessions,
            cast("ContainerService", containers),
            Path(socket_dir),
            ports=MagicMock(),
        )
        await listener.start()

        async def dial(_path):
            return await asyncio.open_unix_connection(path=str(listener.socket_path))

        monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", staticmethod(dial))
        sent_to_siblings: list[dict] = []

        def sibling_http(request: httpx.Request) -> httpx.Response:
            sent_to_siblings.append(
                {"host": request.url.host, "prompt": json.loads(request.content)["prompt"]},
            )

            return httpx.Response(200, json={})

        monkeypatch.setattr(
            SiblingSessionClient,
            "_build_http_client",
            staticmethod(lambda: httpx.AsyncClient(transport=httpx.MockTransport(sibling_http))),
        )

        try:
            yield {
                "workspace": workspace,
                "containers": containers,
                "client": SiblingSessionClient(session_id=PARENT, workspace_path=workspace),
                "sent_to_siblings": sent_to_siblings,
            }
        finally:
            await listener.stop()


def _on_disk(workspace: Path, session_id: str) -> dict:
    session = Workspace(start_dir=workspace).find_session(session_id)
    assert session is not None

    return read_json(session.path / "session.json")


# SPEC: runtime:sibling-settings
@pytest.mark.anyio
async def test_a_sibling_starts_named_on_its_model_and_effort_under_the_parents_bundle(world):
    containers = world["containers"]
    _record(world["workspace"], PARENT, bundle=None)

    spawned = await world["client"].spawn("lint src/", name="lint-fix", model="haiku", effort="low")

    sibling = spawned["session_id"]
    assert _on_disk(world["workspace"], sibling)["name"] == "lint-fix"
    assert _on_disk(world["workspace"], sibling)["spawned_from_session_id"] == PARENT
    assert [endpoint.split("?")[0] for _, endpoint, _ in containers.sent] == [
        "api/model",
        "api/effort-level",
        "api/send",
    ]
    assert containers.sent[0][2] == {"model": "haiku"}
    assert containers.created == [{"session_id": None, "bundle": None}]


# SPEC: runtime:sibling-prompt-lost
@pytest.mark.anyio
async def test_a_prompt_that_never_arrived_is_reported_naming_the_session(world):
    world["containers"].lost_prompts = True

    spawned = await world["client"].spawn("lint src/", name="lint-fix")

    assert spawned["prompt_delivered"] is False
    assert spawned["note"].startswith(
        "Session lint-fix was created, but your prompt did not reach it",
    )


# SPEC: runtime:sibling-stop
# SPEC: runtime:sibling-stop-tree
@pytest.mark.anyio
async def test_a_stop_reaches_the_sibling_and_everything_below_it_and_keeps_their_records(world):
    workspace, containers = world["workspace"], world["containers"]
    _record(workspace, "child-1", spawned_from_session_id=PARENT)
    _record(workspace, "grand-1", spawned_from_session_id="child-1")
    containers.run("child-1")
    containers.run("grand-1")

    stopped = await world["client"].stop("child-1")

    assert stopped == {"session_id": "child-1", "state": "stopped"}
    assert containers.stopped == ["ctr-grand-1", "ctr-child-1"]
    assert {s["session_id"]: s["state"] for s in await world["client"].list_siblings()} == {
        "child-1": "stopped",
    }
    assert Workspace(start_dir=workspace).find_session("grand-1") is not None


# SPEC: runtime:sibling-stop-spares-your-thread
@pytest.mark.anyio
async def test_a_stop_is_refused_while_a_reply_thread_runs_in_its_tree(world):
    workspace, containers = world["workspace"], world["containers"]
    _record(workspace, "child-1", spawned_from_session_id=PARENT)
    _record(workspace, "grand-1", spawned_from_session_id="child-1")
    containers.run("child-1")
    containers.run("grand-1", threads=("thread-9",))

    with pytest.raises(SiblingSessionError, match="reply thread 'thread-9'"):
        await world["client"].stop("child-1")

    assert containers.stopped == []


# SPEC: runtime:sibling-list
@pytest.mark.anyio
async def test_the_list_shows_each_sibling_with_its_state_from_any_restart(world):
    workspace, containers = world["workspace"], world["containers"]
    _record(workspace, "child-1", spawned_from_session_id=PARENT, name="lint-fix")
    _record(workspace, "child-2", spawned_from_session_id=PARENT, auto_name="Docs pass")
    _record(workspace, "other-1", spawned_from_session_id="someone-else")
    containers.run("child-1")

    restarted_parent = SiblingSessionClient(session_id=PARENT, workspace_path=workspace)

    assert sorted(
        (s["session_id"], s["name"], s["state"]) for s in await restarted_parent.list_siblings()
    ) == [("child-1", "lint-fix", "idle"), ("child-2", "Docs pass", "stopped")]


# SPEC: runtime:sibling-wake
@pytest.mark.anyio
async def test_a_message_to_a_stopped_sibling_resumes_it_then_reaches_its_new_container(world):
    workspace, containers = world["workspace"], world["containers"]
    _record(workspace, "child-1", spawned_from_session_id=PARENT)

    asked = await world["client"].ask("child-1", "carry on")

    assert asked["resumed"] is True
    assert containers.created == [{"session_id": "child-1", "bundle": None}]
    assert world["sent_to_siblings"] == [{"host": "ctr-new-1", "prompt": "carry on"}]

    again = await world["client"].ask("child-1", "and again")

    assert again["resumed"] is False
    assert world["sent_to_siblings"][-1]["host"] == "ctr-new-1"


# SPEC: runtime:sibling-own-only
@pytest.mark.anyio
async def test_only_own_siblings_take_a_message_or_a_stop_and_any_session_reads(world):
    workspace, containers = world["workspace"], world["containers"]
    _record(workspace, "other-1", spawned_from_session_id="someone-else")
    containers.run("other-1")

    with pytest.raises(SiblingSessionError, match="'other-1' was not started by this session"):
        await world["client"].ask("other-1", "hi")

    with pytest.raises(SiblingSessionError, match="'other-1' was not started by this session"):
        await world["client"].stop("other-1")

    assert world["sent_to_siblings"] == []
    assert containers.stopped == []
    assert await world["client"].read("other-1") == []


# SPEC: runtime:sibling-permission-mode
def test_reading_and_listing_need_no_permission_while_the_rest_follow_the_mode(tmp_path):
    from claudebox.agent_session.config import ClaudeAgentSessionConfig
    from claudebox.agent_session.hooks import HookCallbacks

    config = ClaudeAgentSessionConfig(
        runtime="claude",
        model=None,
        permission_mode="default",
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="s",
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=HookCallbacks(),
        system_prompt_file=None,
        setting_sources=[],
        sdk_passthrough={},
        max_buffer_size=1,
        debug_mode=False,
        is_primary=True,
    )
    allowed = ClaudeRuntime._build_sdk_options(config).allowed_tools
    tools = {t.name: t for t in ClaudeRuntime(config)._sibling_sdk_tools()}

    assert SESSION_READ_CLAUDE_TOOL_NAME in allowed
    assert SESSION_LIST_CLAUDE_TOOL_NAME in allowed
    assert not {"session_spawn", "session_ask", "session_stop"} & {
        n.split("__")[-1] for n in allowed
    }
    assert {name for name, tool in tools.items() if tool.annotations} == {
        "session_read",
        "session_list",
    }
