"""The tunnel a session container's ports reach the host through: one line naming a port, then bytes."""

from __future__ import annotations

import asyncio
import contextlib
import os
from collections.abc import Callable

from claudebox import get_logger, relay_streams
from claudebox.constants import TUNNEL_PORT_ENV


logger = get_logger(__name__)


def managed() -> Callable:
    """Serve the tunnel for the app's lifetime when the daemon published a port for it."""

    @contextlib.asynccontextmanager
    async def handler(*_args, **_kwargs):
        port = os.environ.get(TUNNEL_PORT_ENV)

        if not port:
            yield

            return

        server = await asyncio.start_server(_handle, host="0.0.0.0", port=int(port))
        logger.info("Port tunnel serving", port=int(port))

        try:
            yield
        finally:
            server.close()
            await server.wait_closed()

    return handler


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        line = await reader.readline()
        port = int(line.strip())

        if not 1 <= port <= 65535:
            raise ValueError(port)

        upstream = await _dial(port)
    except (ValueError, OSError) as exc:
        logger.info("Port tunnel refused a connection", error=str(exc))
        writer.close()

        return

    await relay_streams((reader, writer), upstream)


async def _dial(port: int) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    try:
        return await asyncio.open_connection("127.0.0.1", port)
    except OSError:
        return await asyncio.open_connection("::1", port)
