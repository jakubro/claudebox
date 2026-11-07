"""Tests for the container's port tunnel - one line naming a port, then bytes both ways."""

from __future__ import annotations

import asyncio

import pytest

from claudebox_container_api import tunnel


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


async def _echo_server():
    async def echo(reader, writer):
        while data := await reader.read(1024):
            writer.write(b"echo:" + data)
            await writer.drain()

        writer.close()

    server = await asyncio.start_server(echo, host="127.0.0.1", port=0)

    return server, server.sockets[0].getsockname()[1]


async def _tunnel_server():
    server = await asyncio.start_server(tunnel._handle, host="127.0.0.1", port=0)

    return server, server.sockets[0].getsockname()[1]


@pytest.mark.anyio
async def test_a_port_served_on_ipv6_loopback_alone_is_reached_too():
    async def echo(reader, writer):
        writer.write(b"v6:" + await reader.read(1024))
        await writer.drain()
        writer.close()

    app = await asyncio.start_server(echo, host="::1", port=0)
    relay, relay_port = await _tunnel_server()

    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", relay_port)
        writer.write(f"{app.sockets[0].getsockname()[1]}\nhi".encode())
        await writer.drain()

        assert await asyncio.wait_for(reader.read(1024), 5) == b"v6:hi"
        writer.close()
    finally:
        app.close()
        relay.close()


@pytest.mark.anyio
async def test_bytes_reach_the_named_port_and_come_back():
    echo, echo_port = await _echo_server()
    relay, relay_port = await _tunnel_server()

    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", relay_port)
        writer.write(f"{echo_port}\n".encode() + b"ping")
        await writer.drain()

        assert await asyncio.wait_for(reader.read(1024), 5) == b"echo:ping"

        writer.close()
    finally:
        relay.close()
        echo.close()


@pytest.mark.anyio
@pytest.mark.parametrize("header", [b"not-a-port\n", b"0\n", b"70000\n"])
async def test_a_bad_header_closes_the_connection(header):
    relay, relay_port = await _tunnel_server()

    try:
        reader, writer = await asyncio.open_connection("127.0.0.1", relay_port)
        writer.write(header)
        await writer.drain()

        assert await asyncio.wait_for(reader.read(1024), 5) == b""
    finally:
        relay.close()


@pytest.mark.anyio
async def test_nothing_is_served_without_the_daemons_port(monkeypatch):
    monkeypatch.delenv("CLAUDEBOX_TUNNEL_PORT", raising=False)

    async with tunnel.managed()():
        pass
