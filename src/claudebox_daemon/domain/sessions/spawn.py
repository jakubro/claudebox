"""Unix-socket spawn listener: the closed set of verbs a container's agent can ask the daemon for.

Bound in the workspace's sessions/ dir, mounted into every container - no network, no token.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import struct
from pathlib import Path
from typing import TYPE_CHECKING, get_args

from claudebox import EffortLevelId, InvalidSessionId, get_logger, validate_session_id
from claudebox.constants import SPAWN_SOCKET_LINE_LIMIT, SPAWN_SOCKET_NAME
from ..errors import DaemonError


if TYPE_CHECKING:
    from .service import SessionService
    from ..containers import ContainerService
    from ..ports import PortService
    from ..workspaces import RegisteredWorkspace


# Mirrors _MAX_SUBAGENT_DEPTH (claudebox.agent_session.langgraph_tools.subagent), duplicated
# because the daemon domain must not import a LangGraph tool module. Keep the two in step.
MAX_SPAWN_DEPTH = 3

# A closed set per verb - no optional extension point; an unrecognized key is refused rather than
# silently ignored (see the wire-protocol note in ARCHITECTURE.md section 6.3).
_VERB_KEYS = {
    "spawn": frozenset({"verb", "caller_session_id", "prompt", "name", "model", "effort"}),
    "stop": frozenset({"verb", "caller_session_id", "session_id"}),
    "resume": frozenset({"verb", "caller_session_id", "session_id"}),
    "list": frozenset({"verb", "caller_session_id"}),
    "turn_ended": frozenset({"verb", "caller_session_id", "delivery_id", "outcome", "text"}),
    "port_close": frozenset({"verb", "caller_session_id", "port"}),
}

_OUTCOMES = frozenset({"ended", "asking", "interrupted", "failed"})

_EFFORT_LEVELS = frozenset(get_args(EffortLevelId))

_SESSION_NAMING_ERRORS = frozenset({"not_own_sibling", "hosts_your_thread"})

_UNAPPLIED_KEYS = {"model": "model", "effort_level": "effort"}

# Longest path a unix socket binds on Linux: sun_path holds 108 bytes, its terminator included.
_SUN_PATH_MAX = 107


class SpawnListener:
    """One unix-socket listener per workspace; bound at start()/stop(). Identity always comes from
    peer credentials - caller_session_id is an unverified claim, logged only on a refusal.
    """

    def __init__(
        self,
        workspace: RegisteredWorkspace,
        sessions: SessionService,
        containers: ContainerService,
        socket_dir: Path,
        *,
        ports: PortService,
    ) -> None:
        self._logger = get_logger(__name__)
        self._workspace = workspace
        self._sessions = sessions
        self._containers = containers
        self._ports = ports
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

        self._server = await self._bind()

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

    async def _bind(self) -> asyncio.Server:
        path = str(self._socket_path)

        if len(os.fsencode(path)) <= _SUN_PATH_MAX:
            return await asyncio.start_unix_server(
                self._handle_connection,
                path=path,
                limit=SPAWN_SOCKET_LINE_LIMIT,
            )

        # A path through the directory's descriptor names the same file in fewer bytes. asyncio's
        # own cleanup would unlink that path after the descriptor is closed; stop() unlinks instead.
        dir_fd = os.open(self._socket_path.parent, os.O_RDONLY | os.O_DIRECTORY)

        try:
            return await asyncio.start_unix_server(
                self._handle_connection,
                path=f"/proc/self/fd/{dir_fd}/{self._socket_path.name}",
                cleanup_socket=False,
                limit=SPAWN_SOCKET_LINE_LIMIT,
            )
        finally:
            os.close(dir_fd)

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

        caller = caller_container.session_id
        verbs = {
            "spawn": self._spawn,
            "stop": self._stop,
            "resume": self._resume,
            "list": self._list,
            "turn_ended": self._turn_ended,
            "port_close": self._port_close,
        }

        try:
            body = await verbs[request["verb"]](request, caller)
        except DaemonError as exc:
            self._logger.info(
                "Spawn socket request refused",
                verb=request["verb"],
                error=exc.error_key,
                resolved_caller_session_id=caller,
                claimed_caller_session_id=request["caller_session_id"],
                context=exc.context,
                **self._log_context,
            )
            body = {"error": exc.error_key}

            if exc.error_key in _SESSION_NAMING_ERRORS:
                body["session_id"] = exc.context.get("session_id")

        await self._respond(writer, **body)

    async def _spawn(self, request: dict, caller: str) -> dict:
        depth = self._sessions.compute_spawn_depth(caller)

        if depth is None:
            return {"error": "caller_record_unreadable"}

        if depth + 1 > MAX_SPAWN_DEPTH:
            self._logger.info(
                "Spawn depth exceeded",
                resolved_caller_session_id=caller,
                claimed_caller_session_id=request["caller_session_id"],
                depth=depth,
                cap=MAX_SPAWN_DEPTH,
                **self._log_context,
            )

            return {"error": "spawn_depth_exceeded", "cap": MAX_SPAWN_DEPTH, "depth": depth}

        explicit = {"model": request["model"], "effort_level": request["effort"]}
        caller_info = await self._sessions.get(caller)
        result = await self._sessions.create_with_prompt(
            request["prompt"],
            spawned_from_session_id=caller,
            bundle=caller_info.bundle,
            name=request["name"].strip() if request["name"] else None,
            model=explicit["model"],
            effort_level=explicit["effort_level"],
        )
        unapplied = [
            _UNAPPLIED_KEYS[key]
            for key in result.failed_seeds or []
            if explicit.get(key) is not None
        ]

        return {
            "session_id": result.session_id,
            "container_id": result.container_id,
            "prompt_delivered": not result.failed_prompts,
            "unapplied": unapplied,
        }

    async def _stop(self, request: dict, caller: str) -> dict:
        await self._sessions.stop_spawned(caller, request["session_id"])

        return {"session_id": request["session_id"], "state": "stopped"}

    async def _resume(self, request: dict, caller: str) -> dict:
        info, resumed = await self._sessions.resume_spawned(caller, request["session_id"])

        return {
            "session_id": info.session_id,
            "container_id": info.container_id,
            "resumed": resumed,
        }

    async def _list(self, _request: dict, caller: str) -> dict:
        siblings = await self._sessions.list_spawned(caller)

        return {"sessions": [sibling.asdict() for sibling in siblings]}

    async def _port_close(self, request: dict, caller: str) -> dict:
        await self._ports.close(caller, request["port"])

        return {"port": request["port"], "state": "closed"}

    async def _turn_ended(self, request: dict, caller: str) -> dict:
        outcome = await self._sessions.deliver_turn_end(
            caller,
            delivery_id=request["delivery_id"],
            outcome=request["outcome"],
            text=request["text"],
        )

        return {outcome: True}

    @staticmethod
    def _validate(request: object) -> str | None:
        """Return an error key, or None when the request shape is exactly right."""

        verb = request.get("verb") if isinstance(request, dict) else None

        if not isinstance(verb, str) or verb not in _VERB_KEYS:
            return "unknown_verb"

        assert isinstance(request, dict)

        if set(request) != _VERB_KEYS[verb]:
            return "unknown_fields"

        caller = request["caller_session_id"]

        if not isinstance(caller, str) or not caller.strip():
            return "invalid_caller_session_id"
        elif verb == "spawn":
            return _spawn_error(request)
        elif verb in ("stop", "resume"):
            return _session_id_error(request["session_id"])
        elif verb == "turn_ended":
            return _turn_end_error(request)
        elif verb == "port_close":
            return _port_error(request["port"])
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


def _spawn_error(request: dict) -> str | None:
    prompt, name, model, effort = (request[key] for key in ("prompt", "name", "model", "effort"))

    if not isinstance(prompt, str) or not prompt.strip():
        return "invalid_prompt"
    elif name is not None and (
        not isinstance(name, str) or not name.strip() or len(name.strip().splitlines()) != 1
    ):
        return "invalid_name"
    elif model is not None and (
        not isinstance(model, str) or not model.strip() or any(c.isspace() for c in model)
    ):
        return "invalid_model"
    elif effort is not None and effort not in _EFFORT_LEVELS:
        return "invalid_effort"
    else:
        return None


def _session_id_error(session_id: str) -> str | None:
    try:
        validate_session_id(session_id)
    except InvalidSessionId:
        return "invalid_session_id"

    return None


def _turn_end_error(request: dict) -> str | None:
    delivery_id, outcome, text = (request[key] for key in ("delivery_id", "outcome", "text"))

    if not isinstance(delivery_id, str) or not delivery_id.strip():
        return "invalid_delivery_id"
    elif outcome not in _OUTCOMES:
        return "invalid_outcome"
    elif not isinstance(text, str):
        return "invalid_text"
    else:
        return None


def _port_error(port: object) -> str | None:
    valid = isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535

    return None if valid else "invalid_port"
