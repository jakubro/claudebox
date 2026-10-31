"""Client of the container's syscall supervisor: registers each Bash call and asks what it did."""

from __future__ import annotations

import asyncio
from pathlib import Path

from ...constants import CONTAINER_TRACE_SOCKET
from ...core import serialization
from ...core.logging import get_logger


logger = get_logger(__name__)

_TIMEOUT_S = 1.0
_VERDICTS = {"changed": True, "unchanged": False}


class TraceClient:
    """Asks the supervisor about Bash calls; a missing, refusing or silent one gives no answer."""

    def __init__(self, socket_path: Path | None = None):
        self._socket_path = socket_path or CONTAINER_TRACE_SOCKET
        self._failure_logged = False

    async def register_command(self, tool_use_id: str, command: str) -> None:
        await self._ask({"op": "register", "id": tool_use_id, "command": command})

    async def verdict_for(self, tool_use_id: str) -> bool | None:
        """Return whether call `tool_use_id` changed something, None when that is unknown."""

        reply = await self._ask({"op": "verdict", "id": tool_use_id})

        return _VERDICTS.get(reply.get("verdict")) if isinstance(reply, dict) else None

    async def _ask(self, request: dict) -> object:
        try:
            async with asyncio.timeout(_TIMEOUT_S):
                reader, writer = await asyncio.open_unix_connection(self._socket_path)

                try:
                    writer.write(serialization.dumps(request).encode() + b"\n")
                    await writer.drain()
                    line = await reader.readline()
                finally:
                    writer.close()
                    await writer.wait_closed()

            return serialization.loads(line.decode())
        except (OSError, TimeoutError, ValueError) as exc:
            if not self._failure_logged:
                self._failure_logged = True
                logger.info("bash_trace_unavailable", socket=str(self._socket_path), error=str(exc))

            return None
