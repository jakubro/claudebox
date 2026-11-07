"""End-to-end tests for the ports an agent opens to this computer.

A real session on the Claude runtime against a scripted agent CLI that calls the session's own port tools,
the daemon's real port service and spawn socket, the container's real tunnel, and a server listening
inside the session; only the containers are stand-ins, every one of them on this computer's loopback.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import socket
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING, cast
from unittest.mock import MagicMock, patch

import pytest
from mcp import types

from claudebox import Config
from claudebox.agent_session._ports import (
    PORT_CLOSE_CLAUDE_TOOL_NAME,
    PORT_CLOSE_TOOL_NAME,
    PORT_OPEN_CLAUDE_TOOL_NAME,
    PORT_OPEN_TOOL_NAME,
    port_answer,
)
from claudebox.agent_session._sibling_sessions import (
    CLAUDEBOX_MCP_SERVER_NAME,
    SiblingSessionClient,
)
from claudebox.agent_session.orchestration.session import SessionService as ContainerSession
from claudebox.constants import TUNNEL_PORT_ENV
from claudebox.core.io import read_json, write_json
from claudebox.workspace import Workspace
from claudebox_container_api import tunnel
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.ports import PortRequestRefused, PortService
from claudebox_daemon.domain.sessions.spawn import SpawnListener
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from .scripted_cli import ScriptedCli


if TYPE_CHECKING:
    from claudebox_daemon.domain.containers import ContainerService


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])

_ASK = re.compile(r"please (open|close) port (\d+)")


class _PortCli(ScriptedCli):
    def __init__(self, options):
        super().__init__(options)
        self.options = options
        self.server = options.mcp_servers[CLAUDEBOX_MCP_SERVER_NAME]["instance"]
        self._turn: list = []

    async def query(self, prompt) -> None:
        messages = [prompt] if isinstance(prompt, str) else [m async for m in prompt]
        ask = _ASK.search(_text(messages[0]))
        self._turn = await self._call(ask[1], int(ask[2])) if ask else []

        await super().query(prompt if isinstance(prompt, str) else _replay(messages))

    def reply(self) -> list:
        return self._turn or super().reply()

    async def _call(self, verb: str, port: int) -> list:
        from claude_agent_sdk import AssistantMessage, UserMessage
        from claude_agent_sdk.types import TextBlock, ToolResultBlock, ToolUseBlock

        name, wire = (
            (PORT_OPEN_TOOL_NAME, PORT_OPEN_CLAUDE_TOOL_NAME)
            if verb == "open"
            else (PORT_CLOSE_TOOL_NAME, PORT_CLOSE_CLAUDE_TOOL_NAME)
        )
        handler = self.server.request_handlers[types.CallToolRequest]
        called = await handler(
            types.CallToolRequest(
                method="tools/call",
                params=types.CallToolRequestParams(name=name, arguments={"port": port}),
            ),
        )
        result = cast("types.CallToolResult", called.root)
        text = cast("types.TextContent", result.content[0]).text
        turn = [
            AssistantMessage(
                content=[ToolUseBlock(id=f"call-{verb}", name=wire, input={"port": port})],
                model="m",
            ),
            UserMessage(
                content=[
                    ToolResultBlock(
                        tool_use_id=f"call-{verb}",
                        content=text,
                        is_error=result.isError,
                    ),
                ],
            ),
        ]

        # port_open is a terminal tool: the agent CLI ends the turn on the call itself.
        if verb == "close":
            turn.append(AssistantMessage(content=[TextBlock(text="closed")], model="m"))

        return [*turn, self.result(text)]


class _Containers:
    def __init__(self) -> None:
        self.containers: dict[str, Container] = {}
        self.sessions: dict[str, ContainerSession] = {}
        self.observers: list = []
        self.caller: Container | None = None

    def run(self, session_id: str, session: ContainerSession, tunnel_port: int) -> Container:
        container = Container(
            id=f"ctr-{session_id}",
            backend_id="b",
            port=1,
            status=ContainerStatus.RUNNING,
            session_id=session_id,
            tunnel_port=tunnel_port,
        )
        self.containers[container.id] = container
        self.sessions[session_id] = session
        self.caller = container

        return container

    def set_status(self, container: Container, status: ContainerStatus) -> None:
        container.status = status

        for observer in self.observers:
            observer(container)

    def list_all(self) -> list[Container]:
        return list(self.containers.values())

    async def find_by_session(self, session_id: str, *, sync: bool = False) -> Container | None:
        return next((c for c in self.containers.values() if c.session_id == session_id), None)

    async def find_by_peer_pid(self, _pid: int) -> Container | None:
        return self.caller

    def add_status_observer(self, observer) -> None:
        self.observers.append(observer)

    def remove_status_observer(self, observer) -> None:
        self.observers.remove(observer)

    async def send(self, payload, container_id: str, endpoint: str, method: str) -> dict:
        route, session_id = endpoint.split("?session_id=")
        assert (route, method) == ("api/send", "POST")
        await self.sessions[session_id].send(payload["prompt"])

        return {}


class _Daemon:
    def __init__(self, workspace: Path, containers: _Containers, socket_dir: Path) -> None:
        self._workspace = RegisteredWorkspace(id="ws", path=workspace)
        self._containers = containers
        self._socket_dir = socket_dir
        self._executor = ThreadPoolExecutor(1)
        self._config = Config.load(workspace)
        self._config.backend = "podman"
        self.ports_file = self._config.config_dir / "ports.json"
        self.ports: PortService | None = None
        self._listener: SpawnListener | None = None

    async def start(self) -> None:
        containers = cast("ContainerService", self._containers)
        self.ports = PortService(self._workspace, containers, self._config, self._executor)
        await self.ports.start()
        self._listener = SpawnListener(
            self._workspace,
            MagicMock(),
            containers,
            self._socket_dir,
            ports=self.ports,
        )
        await self._listener.start()

    async def stop(self) -> None:
        assert self.ports is not None and self._listener is not None
        await self._listener.stop()
        await self.ports.stop()

    async def dial(self, _path):
        assert self._listener is not None

        return await asyncio.open_unix_connection(path=str(self._listener.socket_path))

    def close(self) -> None:
        self._executor.shutdown()


@pytest.fixture
async def world(workspace, monkeypatch):
    app_port = _free_port()
    monkeypatch.setenv(TUNNEL_PORT_ENV, str(tunnel_port := _free_port()))

    async def app(reader, writer):
        while data := await reader.read(1024):
            writer.write(f"app {app_port}: ".encode() + data)
            await writer.drain()

        writer.close()

    server = await asyncio.start_server(app, host="127.0.0.1", port=app_port)
    containers = _Containers()

    with (
        patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient", _PortCli),
        tempfile.TemporaryDirectory(dir="/tmp") as socket_dir,
    ):
        daemon = _Daemon(workspace, containers, Path(socket_dir))
        monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", daemon.dial)

        async with tunnel.managed()(None):
            session = ContainerSession(workspace=workspace, remaps_tmp=False)
            session_id = await session.start()
            container = containers.run(session_id, session, tunnel_port)
            await daemon.start()

            try:
                yield {
                    "workspace": workspace,
                    "session": session,
                    "session_id": session_id,
                    "container": container,
                    "containers": containers,
                    "daemon": daemon,
                    "app_port": app_port,
                }
            finally:
                await daemon.stop()
                await session.stop()
                daemon.close()
                server.close()
                await server.wait_closed()


# SPEC: container:port-request
# SPEC: container:port-request-needs-you
@pytest.mark.anyio
async def test_asking_ends_the_turn_on_the_request_and_the_session_needs_you(world):
    port = world["app_port"]

    await _turn(
        world,
        world["session"].send(f"Start the dev server, then please open port {port}."),
    )

    events = _events(world)
    (call,) = [e for e in events if e["subtype"] == "tool_use"]
    assert (call["tool_name"], call["tool_input"]) == (PORT_OPEN_CLAUDE_TOOL_NAME, {"port": port})
    assert _tool_result(events).startswith(f"Asked the user to open port {port} to their computer.")
    assert events[-1]["type"] == "result"
    assert _record(world)["needs_user"] == f"Approve: open port {port}"


# SPEC: container:port-approve
@pytest.mark.anyio
async def test_approving_makes_the_port_reachable_here_and_the_agent_carries_on(world):
    port, daemon = world["app_port"], world["daemon"]
    await _turn(world, world["session"].send(f"please open port {port}"))

    answer = await _turn(world, daemon.ports.answer(world["session_id"], port, approve=True))

    host_port = answer["host_port"]
    # The session's own port is held on this computer by the server inside it, so a free one stands in.
    assert host_port != port
    assert answer["address"] == f"http://127.0.0.1:{host_port}"
    assert await _through(host_port, b"ping") == f"app {port}: ping".encode()
    assert _human_messages(world)[-1] == port_answer(port, answer["address"])
    assert _record(world)["needs_user"] is None
    assert world["session"]._session_id == world["session_id"]


# SPEC: container:port-reject
@pytest.mark.anyio
async def test_rejecting_opens_nothing_and_the_agent_carries_on(world):
    port, daemon = world["app_port"], world["daemon"]
    await _turn(world, world["session"].send(f"please open port {port}"))

    answer = await _turn(world, daemon.ports.answer(world["session_id"], port, approve=False))

    assert answer == {"port": port, "state": "rejected"}
    assert read_json(daemon.ports_file, default={}) == {}
    assert _human_messages(world)[-1] == port_answer(port, None)
    assert _record(world)["needs_user"] is None


# SPEC: container:port-lifetime
@pytest.mark.anyio
async def test_an_opened_port_lasts_until_the_agent_closes_it(world):
    port, daemon, containers = world["app_port"], world["daemon"], world["containers"]
    await _turn(world, world["session"].send(f"please open port {port}"))
    answer = await _turn(world, daemon.ports.answer(world["session_id"], port, approve=True))
    host_port = answer["host_port"]

    await daemon.stop()
    await _until_refused(host_port)
    await daemon.start()
    assert await _through(host_port, b"after restart") == f"app {port}: after restart".encode()

    containers.set_status(world["container"], ContainerStatus.STOPPED)
    await _until_refused(host_port)

    with _held(host_port):
        containers.set_status(world["container"], ContainerStatus.RUNNING)
        moved = await _until_moved(daemon, world["session_id"], port, host_port)

    assert await _through(moved, b"moved") == f"app {port}: moved".encode()

    await _turn(world, world["session"].send("How is the build going?"))
    told = _cli_messages(world)[-1]
    assert f"Port {port} you opened is reachable at http://127.0.0.1:{moved} now" in told
    assert told.startswith("How is the build going?")

    await _turn(world, world["session"].send(f"please close port {port}"))
    assert json.loads(_tool_result(_events(world))) == {"port": port, "state": "closed"}
    await _until_refused(moved)

    await daemon.stop()
    await daemon.start()
    await asyncio.sleep(0.2)
    assert not await _reachable(moved)
    assert read_json(daemon.ports_file, default={}) == {}


# SPEC: container:port-own-session-only
@pytest.mark.anyio
@pytest.mark.parametrize(
    ("field", "where"),
    [
        ("spawned_from_session_id", "Ask the session that started it"),
        ("is_side_thread", "Ask in the conversation's main session"),
    ],
)
async def test_a_spawned_session_or_a_reply_thread_cannot_ask(world, field, where):
    port = world["app_port"]
    path = _record_path(world)
    record = read_json(path, default=None) or {}
    write_json(path, {**record, field: "parent-1" if field.startswith("spawned") else True})

    await _turn(world, world["session"].send(f"please open port {port}"))

    reply = _tool_result(_events(world))
    assert reply.startswith("Not asked:")
    assert where in reply
    assert _record(world)["needs_user"] is None

    with pytest.raises(PortRequestRefused):
        await world["daemon"].ports.answer(world["session_id"], port, approve=True)


# SPEC: container:port-permission-mode
@pytest.mark.anyio
async def test_asking_and_closing_are_allowed_in_every_mode_but_plan(world):
    cli = world["session"]._sdk_client._sdk
    listed = await cli.server.request_handlers[types.ListToolsRequest](
        types.ListToolsRequest(method="tools/list"),
    )
    tools = {tool.name: tool for tool in cast("types.ListToolsResult", listed.root).tools}

    assert {PORT_OPEN_CLAUDE_TOOL_NAME, PORT_CLOSE_CLAUDE_TOOL_NAME} <= set(
        cli.options.allowed_tools,
    )
    # Plan mode lets through only what declares itself read-only, which neither does.
    assert [tools[name].annotations for name in (PORT_OPEN_TOOL_NAME, PORT_CLOSE_TOOL_NAME)] == [
        None,
        None,
    ]


async def _turn(world, action):
    done = _results(world)
    returned = await action

    async with asyncio.timeout(10):
        while _results(world) == done:
            await asyncio.sleep(0.05)

    return returned


def _results(world) -> int:
    return sum(1 for e in _events(world) if e["type"] == "result")


def _events(world) -> list[dict]:
    path = _record_path(world).with_name("events.jsonl")

    if not path.exists():
        return []

    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _tool_result(events: list[dict]) -> str:
    return [e for e in events if e["subtype"] == "tool_result"][-1]["content"]


def _human_messages(world) -> list[str]:
    return [e["content"] for e in _events(world) if e.get("is_human")]


def _cli_messages(world) -> list[str]:
    transcript = world["session"]._sdk_client._sdk.transcript

    return [_text(json.loads(line)) for line in transcript.read_text().splitlines()]


def _record_path(world) -> Path:
    session = Workspace(start_dir=world["workspace"]).find_session(world["session_id"])
    assert session is not None

    return session.path / "session.json"


def _record(world) -> dict:
    return read_json(_record_path(world))


def _text(message) -> str:
    content = message if isinstance(message, str) else message["message"]

    if isinstance(content, dict):
        content = content["content"]

    if isinstance(content, str):
        return content

    return "".join(block.get("text", "") for block in content)


async def _replay(messages):
    for message in messages:
        yield message


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))

        return probe.getsockname()[1]


@contextlib.contextmanager
def _held(port: int):
    with socket.socket() as holder:
        holder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        holder.bind(("127.0.0.1", port))
        holder.listen()
        yield


async def _through(port: int, data: bytes) -> bytes:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(data)
    await writer.drain()

    try:
        return await asyncio.wait_for(reader.read(1024), 5)
    finally:
        writer.close()


async def _reachable(port: int) -> bool:
    try:
        return bool(await _through(port, b"?"))
    except OSError:
        return False


async def _until_refused(port: int) -> None:
    async with asyncio.timeout(5):
        while await _reachable(port):
            await asyncio.sleep(0.05)


async def _until_moved(daemon: _Daemon, session_id: str, port: int, recorded: int) -> int:
    async with asyncio.timeout(5):
        while True:
            host_port = read_json(daemon.ports_file, default={}).get(session_id, {}).get(str(port))

            if host_port not in (None, recorded):
                return host_port

            await asyncio.sleep(0.05)
