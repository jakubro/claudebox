"""Tests for claudebox_daemon.domain.containers.proxy - ContainerProxyClient timeout/pool bounds."""

import asyncio
import socket
import threading
import time

import pytest

from claudebox_daemon.constants import CONTAINER_PROXY_TIMEOUT
from claudebox_daemon.domain.containers.errors import ContainerTimeout
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.containers.proxy import ContainerProxyClient


# --- helpers ---


def _start_hanging_server() -> tuple[socket.socket, int, list[socket.socket]]:
    """Bind a loopback server that accepts one connection and hangs; keeps a live reference so it doesn't close and turn the read-timeout into a connection reset."""

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]
    accepted: list[socket.socket] = []

    def _accept_and_hang() -> None:
        try:
            conn, _ = server.accept()
            accepted.append(conn)
            conn.recv(4096)  # drain the request so the client's write completes
        except OSError:
            pass  # server closed during test teardown

    threading.Thread(target=_accept_and_hang, daemon=True).start()

    return server, port, accepted


# --- read timeout ---


@pytest.mark.enable_socket
class TestReadTimeoutIsBounded:
    """Test the client's timeout on a container that accepts but never responds."""

    @pytest.mark.anyio
    async def test_hung_container_raises_within_the_configured_bound(self):
        server, port, accepted = _start_hanging_server()
        client = ContainerProxyClient()
        container = Container(id="c1", backend_id="b1", port=port, status=ContainerStatus.RUNNING)

        try:
            started = time.monotonic()

            with pytest.raises(ContainerTimeout):
                # Backstop so a regression here fails this test instead of hanging the whole suite.
                await asyncio.wait_for(
                    client.send(
                        payload=None,
                        container=container,
                        endpoint="api/health",
                        method="GET",
                    ),
                    timeout=CONTAINER_PROXY_TIMEOUT.read + 10.0,  # ty: ignore[unsupported-operator]
                )

            elapsed = time.monotonic() - started
        finally:
            server.close()

            for conn in accepted:
                conn.close()

            await client.close()

        assert elapsed < CONTAINER_PROXY_TIMEOUT.read + 5.0  # ty: ignore[unsupported-operator]


# --- pool limits ---


class TestPoolLimitsAreExplicit:
    """Test that the shared client uses explicit pool limits instead of httpx's defaults."""

    @pytest.mark.anyio
    async def test_client_pool_matches_the_configured_limits(self):
        from claudebox_daemon.constants import CONTAINER_PROXY_LIMITS

        client = ContainerProxyClient()

        try:
            pool = client._client._transport._pool  # ty: ignore[unresolved-attribute]
            assert pool._max_connections == CONTAINER_PROXY_LIMITS.max_connections
            assert (
                pool._max_keepalive_connections == CONTAINER_PROXY_LIMITS.max_keepalive_connections
            )
        finally:
            await client.close()

    @pytest.mark.anyio
    async def test_read_timeout_is_bounded_not_none(self):
        client = ContainerProxyClient()

        try:
            assert client._client.timeout.read == CONTAINER_PROXY_TIMEOUT.read
            assert client._client.timeout.read is not None
        finally:
            await client.close()
