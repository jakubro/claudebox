"""Tests for the port service - the user's answers, the relays, and the approvals they outlive."""

from __future__ import annotations

import asyncio
import errno
import json
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING, cast

import pytest

from claudebox import Config, Workspace, write_json
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.ports import (
    PortNotOpen,
    PortRequestRefused,
    PortService,
    PortSessionNotRunning,
    PortTunnelMissing,
)
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


if TYPE_CHECKING:
    from claudebox_daemon.domain.containers import ContainerService


pytestmark = pytest.mark.allow_hosts(["127.0.0.1"])


class _Containers:
    def __init__(self) -> None:
        self.containers: dict[str, Container] = {}
        self.sent: list[tuple[str, str, dict]] = []
        self.observers = []

    def run(self, session_id: str, tunnel_port: int) -> Container:
        container = Container(
            id=f"ctr-{session_id}",
            backend_id="b",
            port=1,
            status=ContainerStatus.RUNNING,
            session_id=session_id,
            tunnel_port=tunnel_port,
        )
        self.containers[container.id] = container

        return container

    def add_status_observer(self, observer) -> None:
        self.observers.append(observer)

    def remove_status_observer(self, observer) -> None:
        self.observers.remove(observer)

    def list_all(self) -> list[Container]:
        return list(self.containers.values())

    async def find_by_session(self, session_id: str, *, sync: bool = False) -> Container | None:
        return next((c for c in self.containers.values() if c.session_id == session_id), None)

    async def send(self, payload, container_id: str, endpoint: str, method: str) -> dict:
        self.sent.append((container_id, endpoint, payload))

        return {}


async def _tunnel():
    async def serve(reader, writer):
        port = (await reader.readline()).decode().strip()

        while data := await reader.read(1024):
            writer.write(f"{port}:".encode() + data)
            await writer.drain()

        writer.close()

    server = await asyncio.start_server(serve, host="127.0.0.1", port=0)

    return server, server.sockets[0].getsockname()[1]


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))

        return probe.getsockname()[1]


@pytest.fixture
def world(tmp_path):
    (tmp_path / ".workspace").touch()
    workspace = Workspace(start_dir=tmp_path)
    write_json(workspace.ensure_session("main").path / "session.json", {"session_id": "main"})
    write_json(
        workspace.ensure_session("spawned").path / "session.json",
        {"spawned_from_session_id": "main"},
    )
    write_json(workspace.ensure_session("thread").path / "session.json", {"is_side_thread": True})
    containers = _Containers()
    executor = ThreadPoolExecutor(1)

    def service(*, backend: str = "podman") -> PortService:
        config = Config.load(tmp_path)
        config.backend = backend

        return PortService(
            RegisteredWorkspace(id="ws", path=tmp_path),
            cast("ContainerService", containers),
            config,
            executor,
        )

    yield {"path": tmp_path, "containers": containers, "service": service}
    executor.shutdown()


async def _through(host_port: int, data: bytes) -> bytes:
    reader, writer = await asyncio.open_connection("127.0.0.1", host_port)
    writer.write(data)
    await writer.drain()
    answer = await asyncio.wait_for(reader.read(1024), 5)
    writer.close()

    return answer


@pytest.mark.anyio
async def test_an_approved_port_is_reachable_on_its_own_number_and_the_agent_told(world):
    tunnel, tunnel_port = await _tunnel()
    container = world["containers"].run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()
    port = _free_port()

    try:
        opened = await ports.answer("main", port, approve=True)

        assert opened == {"port": port, "host_port": port, "address": f"http://127.0.0.1:{port}"}
        assert await _through(port, b"hello") == f"{port}:hello".encode()
        assert world["containers"].sent == [
            (
                container.id,
                "api/send?session_id=main",
                {
                    "prompt": f'<response:port_open port="{port}">Approved: port {port} is '
                    f"reachable at http://127.0.0.1:{port}.</response:port_open>",
                },
            ),
        ]
    finally:
        await ports.stop()
        tunnel.close()


@pytest.mark.anyio
async def test_a_held_port_number_is_swapped_for_a_free_one(world):
    tunnel, tunnel_port = await _tunnel()
    world["containers"].run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()

    with socket.socket() as holder:
        holder.bind(("127.0.0.1", 0))
        holder.listen()
        held = holder.getsockname()[1]

        try:
            opened = await ports.answer("main", held, approve=True)
        finally:
            await ports.stop()
            tunnel.close()

    assert opened["host_port"] != held


@pytest.mark.anyio
async def test_a_rejection_opens_nothing_and_tells_the_agent(world):
    world["containers"].run("main", 1)
    ports = world["service"]()
    await ports.start()

    assert await ports.answer("main", 8080, approve=False) == {"port": 8080, "state": "rejected"}
    assert world["containers"].sent[0][2] == {
        "prompt": '<response:port_open port="8080">Rejected: port 8080 stays closed.</response:port_open>',
    }
    assert not (world["path"] / ".claudebox" / "ports.json").exists()
    await ports.stop()


@pytest.mark.anyio
@pytest.mark.parametrize("session_id", ["spawned", "thread", "nobody"])
async def test_a_session_that_cannot_ask_is_refused(world, session_id):
    world["containers"].run(session_id, 1)
    ports = world["service"]()

    with pytest.raises(PortRequestRefused):
        await ports.answer(session_id, 8080, approve=True)


@pytest.mark.anyio
async def test_a_stopped_session_cannot_get_a_port(world):
    with pytest.raises(PortSessionNotRunning):
        await world["service"]().answer("main", 8080, approve=True)


@pytest.mark.anyio
async def test_a_container_without_a_tunnel_needs_a_new_run(world):
    world["containers"].run("main", 0)

    with pytest.raises(PortTunnelMissing):
        await world["service"]().answer("main", 8080, approve=True)


@pytest.mark.anyio
async def test_the_local_backend_opens_the_port_itself(world):
    world["containers"].run("main", 0)
    ports = world["service"](backend="local")

    assert (await ports.answer("main", 8080, approve=True))["host_port"] == 8080
    assert ports._listeners == {}


@pytest.mark.anyio
async def test_a_closed_port_stops_answering_and_is_forgotten(world):
    tunnel, tunnel_port = await _tunnel()
    world["containers"].run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()
    port = _free_port()
    await ports.answer("main", port, approve=True)

    await ports.close("main", port)

    with pytest.raises(OSError):
        await _through(port, b"x")

    with pytest.raises(PortNotOpen):
        await ports.close("main", port)

    assert json.loads((world["path"] / ".claudebox" / "ports.json").read_text()) == {}
    await ports.stop()
    tunnel.close()


@pytest.mark.anyio
async def test_a_port_closes_while_the_session_is_stopped_and_opens_again_when_it_runs(world):
    tunnel, tunnel_port = await _tunnel()
    containers = world["containers"]
    container = containers.run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()
    port = _free_port()
    await ports.answer("main", port, approve=True)

    container.status = ContainerStatus.STOPPED
    await ports.sync()

    with pytest.raises(OSError):
        await _through(port, b"x")

    container.status = ContainerStatus.RUNNING
    await ports.sync()

    assert await _through(port, b"again") == f"{port}:again".encode()
    await ports.stop()
    tunnel.close()


@pytest.mark.anyio
async def test_closing_cuts_a_connection_still_open_through_the_port(world):
    tunnel, tunnel_port = await _tunnel()
    world["containers"].run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()
    port = _free_port()
    await ports.answer("main", port, approve=True)
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(b"held")
    await writer.drain()
    assert await asyncio.wait_for(reader.read(1024), 5) == f"{port}:held".encode()

    await asyncio.wait_for(ports.close("main", port), 5)

    assert await asyncio.wait_for(reader.read(1024), 5) == b""
    assert json.loads(ports._state_path.read_text()) == {}
    writer.close()
    await ports.stop()
    tunnel.close()


@pytest.mark.anyio
async def test_a_port_the_host_will_not_lend_is_swapped_for_a_free_one(world, monkeypatch):
    tunnel, tunnel_port = await _tunnel()
    world["containers"].run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()
    start_server = asyncio.start_server

    async def privileged(handler, host, port):
        if port == 80:
            raise PermissionError(errno.EACCES, "Permission denied")

        return await start_server(handler, host=host, port=port)

    monkeypatch.setattr(asyncio, "start_server", privileged)

    try:
        opened = await ports.answer("main", 80, approve=True)
    finally:
        await ports.stop()
        tunnel.close()

    assert opened["host_port"] not in (0, 80)


@pytest.mark.anyio
async def test_rejecting_a_port_already_open_closes_it(world):
    tunnel, tunnel_port = await _tunnel()
    world["containers"].run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()
    port = _free_port()
    await ports.answer("main", port, approve=True)

    await ports.answer("main", port, approve=False)

    with pytest.raises(OSError):
        await _through(port, b"x")

    assert json.loads(ports._state_path.read_text()) == {}
    await ports.stop()
    tunnel.close()


@pytest.mark.anyio
async def test_a_stopped_service_leaves_container_changes_alone(world):
    world["containers"].run("main", 1)
    ports = world["service"]()
    await ports.start()

    await ports.stop()

    assert world["containers"].observers == []


@pytest.mark.anyio
async def test_a_stop_seen_while_a_sync_is_under_way_still_closes_the_port(world):
    tunnel, tunnel_port = await _tunnel()
    containers = world["containers"]
    container = containers.run("main", tunnel_port)
    ports = world["service"]()
    await ports.start()
    port = _free_port()
    await ports.answer("main", port, approve=True)
    container.status = ContainerStatus.STOPPED
    await ports.sync()
    listed = asyncio.Event()
    list_all = containers.list_all
    containers.list_all = lambda: (listed.set(), list_all())[1]

    container.status = ContainerStatus.RUNNING
    reopening = asyncio.ensure_future(ports.sync())
    await listed.wait()
    container.status = ContainerStatus.STOPPED
    await ports.sync()
    await reopening

    with pytest.raises(OSError):
        await _through(port, b"x")

    await ports.stop()
    tunnel.close()


@pytest.mark.anyio
async def test_a_restarted_daemon_reopens_the_port_and_a_moved_address_is_noted(world):
    tunnel, tunnel_port = await _tunnel()
    world["containers"].run("main", tunnel_port)
    first = world["service"]()
    await first.start()
    port = _free_port()
    await first.answer("main", port, approve=True)
    await first.stop()

    with socket.socket() as holder:
        holder.bind(("127.0.0.1", port))
        holder.listen()
        restarted = world["service"]()
        await restarted.start()

    moved = restarted._approved["main"][port]
    session = Workspace(start_dir=world["path"]).find_session("main")
    assert session is not None
    notes = session.path / "notes.pending.jsonl"

    assert moved != port
    assert await _through(moved, b"hi") == f"{port}:hi".encode()
    assert json.loads(notes.read_text())["text"].startswith(
        f"Port {port} you opened is reachable at http://127.0.0.1:{moved} now",
    )
    await restarted.stop()
    tunnel.close()


@pytest.mark.anyio
async def test_a_container_change_resyncs_the_relays(world):
    world["containers"].run("main", 1)
    ports = world["service"]()
    await ports.start()

    assert len(world["containers"].observers) == 1

    world["containers"].observers[0](world["containers"].list_all()[0])
    await asyncio.sleep(0.05)
    await ports.stop()


def test_the_approvals_file_lives_beside_the_container_registry(world):
    ports = world["service"]()

    assert ports._state_path == Path(world["path"]) / ".claudebox" / "ports.json"
