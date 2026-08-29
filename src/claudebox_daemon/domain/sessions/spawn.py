"""Unix-socket spawn listener: the one verb a container's agent can ask the daemon for.

Bound in the workspace's sessions/ dir, mounted into every container - no network, no token.
"""

import asyncio
import json
import os
import socket
import struct
from pathlib import Path
from typing import TYPE_CHECKING

from claudebox import get_logger
from claudebox.constants import SPAWN_SOCKET_NAME


if TYPE_CHECKING:
    from .service import SessionService
    from ..containers import ContainerService
    from ..workspaces import RegisteredWorkspace


# Mirrors _MAX_SUBAGENT_DEPTH (claudebox.agent_session.langgraph_tools.subagent), duplicated
# because the daemon domain must not import a LangGraph tool module. Keep the two in step.
MAX_SPAWN_DEPTH = 3

# A closed set - no optional extension point; an unrecognized key is refused rather than
# silently ignored (see the wire-protocol note in ARCHITECTURE.md section 6.3).
_REQUIRED_KEYS = frozenset({"verb", "caller_session_id", "prompt"})


class SpawnListener:
    """One unix-socket listener per workspace; bound at start(), unbound at stop().

    caller_session_id is recorded lineage, never identity - the caller comes from peer credentials.
    """

    def __init__(
        self,
        workspace: "RegisteredWorkspace",
        sessions: "SessionService",
        containers: "ContainerService",
        socket_dir: Path,
    ) -> None:
        self._logger = get_logger(__name__)
        self._workspace = workspace
        self._sessions = sessions
        self._containers = containers
        self._socket_path = socket_dir / SPAWN_SOCKET_NAME
        self._server: asyncio.Server | None = None

    @property
    def socket_path(self) -> Path:
        """The unix socket path this listener binds."""

        return self._socket_path

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Bind the socket, unlinking a stale one first (a hard daemon kill leaves one behind)."""

        self._socket_path.parent.mkdir(parents=True, exist_ok=True)

        if self._socket_path.exists():
            self._socket_path.unlink()

        self._server = await asyncio.start_unix_server(
            self._handle_connection,
            path=str(self._socket_path),
        )

        # Every container runs as the same host user, so mode bits separate no container from
        # its siblings - what they buy is keeping the socket off-limits to other host users.
        os.chmod(self._socket_path, 0o600)

        self._logger.debug("Spawn socket bound", path=str(self._socket_path), **self._log_context)

    async def stop(self) -> None:
        """Close the listener and unlink the socket file."""

        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

        if self._socket_path.exists():
            self._socket_path.unlink()

    # Connection handling
    # ----------------------------------------------------------------------------------------------

    async def _handle_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        """Handle one spawn request end to end; always closes the connection."""

        try:
            await self._process(reader, writer)
        except Exception:
            self._logger.exception("Spawn request failed", **self._log_context)

            try:
                await self._respond(writer, error="internal_error")
            except OSError:
                pass  # peer already gone; nothing left to report to
        finally:
            writer.close()

    async def _process(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer_pid = self._peer_pid(writer)

        if peer_pid is None:
            await self._respond(writer, error="peer_unidentified")

            return

        try:
            line = await reader.readline()
        except ValueError:
            # StreamReader.readline() wraps its own LimitOverrunError into a bare ValueError
            # once the line exceeds the stream's buffer limit with no separator found.
            await self._respond(writer, error="payload_too_large")

            return

        if not line:
            return  # peer closed without sending anything

        try:
            request = json.loads(line)
        except ValueError:
            await self._respond(writer, error="malformed_request")

            return

        error = self._validate(request)

        if error:
            await self._respond(writer, error=error)

            return

        caller_container = await self._containers.find_by_peer_pid(peer_pid)

        if caller_container is None or not caller_container.session_id:
            await self._respond(writer, error="caller_unresolved")

            return

        depth = self._sessions.compute_spawn_depth(caller_container.session_id)

        if depth is None:
            await self._respond(writer, error="caller_record_unreadable")

            return

        if depth + 1 > MAX_SPAWN_DEPTH:
            await self._respond(
                writer,
                error="spawn_depth_exceeded",
                cap=MAX_SPAWN_DEPTH,
                depth=depth,
            )

            return

        result = await self._sessions.create_with_prompt(
            request["prompt"],
            spawned_from_session_id=request["caller_session_id"],
        )

        await self._respond(writer, session_id=result.session_id, container_id=result.container_id)

    @staticmethod
    def _validate(request: object) -> str | None:
        """Return an error key, or None when the request shape is exactly right."""

        if not isinstance(request, dict) or set(request) != _REQUIRED_KEYS:
            return "unknown_fields"

        if request.get("verb") != "spawn":
            return "unknown_verb"

        prompt = request.get("prompt")
        caller = request.get("caller_session_id")

        if not isinstance(prompt, str) or not prompt.strip():
            return "invalid_prompt"
        elif not isinstance(caller, str) or not caller.strip():
            return "invalid_caller_session_id"
        else:
            return None

    @staticmethod
    def _peer_pid(writer: asyncio.StreamWriter) -> int | None:
        """Read the peer PID via SO_PEERCRED - kernel-verified, never from the payload."""

        sock = writer.get_extra_info("socket")

        if sock is None:
            return None

        try:
            creds = sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
            pid, _uid, _gid = struct.unpack("3i", creds)

            return pid
        except OSError:
            return None

    @staticmethod
    async def _respond(writer: asyncio.StreamWriter, **body) -> None:
        writer.write((json.dumps(body) + "\n").encode())
        await writer.drain()

    # Misc
    # ----------------------------------------------------------------------------------------------

    @property
    def _log_context(self) -> dict:
        return {"workspace": {"id": self._workspace.id, "path": self._workspace.path}}
