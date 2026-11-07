"""The ports agents opened to this computer: the user's approvals, and a relay per running session."""

from __future__ import annotations

import asyncio
import errno
import functools
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING

from claudebox import (
    Config,
    Workspace,
    append_json,
    get_logger,
    port_answer,
    read_json,
    relay_streams,
    write_json,
)
from claudebox.constants import SESSION_METADATA_FILE, SESSION_NOTES_PENDING_FILE
from .errors import PortNotOpen, PortRequestRefused, PortSessionNotRunning, PortTunnelMissing
from .._locking import locked
from ...constants import PORTS_STATE_FILE


if TYPE_CHECKING:
    from ..containers import Container, ContainerService
    from ..workspaces import RegisteredWorkspace


LOOPBACK = "127.0.0.1"


class PortService:
    """Keep each approved port of a session reachable on this computer while the session runs.

    Approvals outlive containers; a relay listens only while the session's own container runs.
    """

    def __init__(
        self,
        workspace: RegisteredWorkspace,
        containers: ContainerService,
        config: Config,
        state_executor: ThreadPoolExecutor,
    ) -> None:
        self._logger = get_logger(__name__)
        self._workspace = workspace
        self._containers = containers
        self._local = config.backend == "local"
        self._state_path = config.config_dir / PORTS_STATE_FILE
        self._state_executor = state_executor
        # session id -> container port -> host port
        self._approved: dict[str, dict[int, int]] = {}
        self._listeners: dict[tuple[str, int], asyncio.Server] = {}
        self._sync_lock = asyncio.Lock()

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Load the approvals and open a relay for each session that runs."""

        self._logger.debug("Starting port service...", **self._log_context)

        data = read_json(self._state_path, default={}) or {}
        self._approved = {
            session_id: {int(port): host for port, host in ports.items()}
            for session_id, ports in data.items()
        }
        self._containers.add_status_observer(self._on_container_status)
        await self.sync()

        self._logger.info("Port service started", **self._log_context)

    async def stop(self) -> None:
        """Close every relay; the approvals stay on disk."""

        self._logger.debug("Stopping port service...", **self._log_context)

        self._containers.remove_status_observer(self._on_container_status)

        for key in list(self._listeners):
            await self._close_listener(key)

        self._logger.info("Port service stopped", **self._log_context)

    # Ports
    # ----------------------------------------------------------------------------------------------

    async def answer(self, session_id: str, port: int, *, approve: bool) -> dict:
        """Apply the user's answer to a session's port request and tell the session's agent."""

        record = self._record(session_id)

        if record is None or record.get("spawned_from_session_id") or record.get("is_side_thread"):
            raise PortRequestRefused(session_id=session_id, port=str(port))

        container = await self._owner_container(session_id)

        if container is None:
            raise PortSessionNotRunning(session_id=session_id, port=str(port))

        if not approve:
            if port in self._approved.get(session_id, {}):
                await self.close(session_id, port)

            await self._tell(container, session_id, port_answer(port, None))

            return {"port": port, "state": "rejected"}

        if not self._local and not container.tunnel_port:
            raise PortTunnelMissing(session_id=session_id, port=str(port))

        host_port = await self._open(session_id, port, preferred=self._host_port(session_id, port))
        self._approved.setdefault(session_id, {})[port] = host_port
        await self._save()
        address = _address(host_port)
        await self._tell(container, session_id, port_answer(port, address))

        return {"port": port, "host_port": host_port, "address": address}

    async def close(self, session_id: str, port: int) -> None:
        """Close a port the session opened, for good."""

        if port not in self._approved.get(session_id, {}):
            raise PortNotOpen(session_id=session_id, port=str(port))

        del self._approved[session_id][port]

        if not self._approved[session_id]:
            del self._approved[session_id]

        await self._close_listener((session_id, port))
        await self._save()

    async def sync(self) -> None:
        """Bring the relays in line with the approvals and the containers that run now."""

        async with self._sync_lock:
            await self._sync_once()

    async def _sync_once(self) -> None:
        running = {
            container.session_id
            for container in self._containers.list_all()
            if container.session_id and _runs(container)
        }
        wanted = {
            (session_id, port)
            for session_id, ports in self._approved.items()
            if session_id in running and not self._local
            for port in ports
        }

        for key in set(self._listeners) - wanted:
            await self._close_listener(key)

        for session_id, port in sorted(wanted - set(self._listeners)):
            recorded = self._approved[session_id][port]
            host_port = await self._open(session_id, port, preferred=recorded)

            if host_port != recorded:
                self._approved[session_id][port] = host_port
                await self._save()
                self._note(
                    session_id,
                    f"Port {port} you opened is reachable at {_address(host_port)} now; "
                    f"{_address(recorded)} was taken.",
                )

    def _on_container_status(self, _container: Container) -> None:
        task = asyncio.ensure_future(self.sync())
        task.add_done_callback(_log_failure)

    # Relays
    # ----------------------------------------------------------------------------------------------

    async def _open(self, session_id: str, port: int, *, preferred: int | None) -> int:
        if self._local:
            return port

        if (session_id, port) in self._listeners:
            return self._listeners[(session_id, port)].sockets[0].getsockname()[1]

        relay = partial(self._relay, session_id, port)

        try:
            server = await asyncio.start_server(relay, host=LOOPBACK, port=preferred or port)
        except OSError as exc:
            if exc.errno not in (errno.EADDRINUSE, errno.EACCES):
                raise

            server = await asyncio.start_server(relay, host=LOOPBACK, port=0)

        self._listeners[(session_id, port)] = server
        host_port = server.sockets[0].getsockname()[1]
        self._logger.info(
            "Port relay listening",
            session_id=session_id,
            port=port,
            host_port=host_port,
            **self._log_context,
        )

        return host_port

    async def _close_listener(self, key: tuple[str, int]) -> None:
        server = self._listeners.pop(key, None)

        if server is not None:
            server.close()
            server.close_clients()
            await server.wait_closed()

    async def _relay(
        self,
        session_id: str,
        port: int,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        container = await self._owner_container(session_id)

        try:
            if container is None or not container.tunnel_port:
                raise ConnectionRefusedError(session_id)

            upstream = await asyncio.open_connection(LOOPBACK, container.tunnel_port)
        except OSError as exc:
            self._logger.info("Port relay could not reach the session", error=str(exc), port=port)
            writer.close()

            return

        upstream[1].write(f"{port}\n".encode())
        await relay_streams((reader, writer), upstream)

    # Internal
    # ----------------------------------------------------------------------------------------------

    async def _owner_container(self, session_id: str) -> Container | None:
        container = await self._containers.find_by_session(session_id)

        return container if container is not None and container.session_id == session_id else None

    def _host_port(self, session_id: str, port: int) -> int | None:
        return self._approved.get(session_id, {}).get(port)

    async def _tell(self, container: Container, session_id: str, prompt: str) -> None:
        await self._containers.send(
            payload={"prompt": prompt},
            container_id=container.id,
            endpoint=f"api/send?session_id={session_id}",
            method="POST",
        )

    def _note(self, session_id: str, text: str) -> None:
        session = Workspace(self._workspace.path).find_session(session_id)

        if session is not None:
            append_json(session.path / SESSION_NOTES_PENDING_FILE, {"text": text})

    def _record(self, session_id: str) -> dict | None:
        session = Workspace(self._workspace.path).find_session(session_id)

        if session is None:
            return None

        return read_json(session.path / SESSION_METADATA_FILE, default=None) or {}

    async def _save(self) -> None:
        data = {
            session_id: {str(port): host for port, host in ports.items()}
            for session_id, ports in self._approved.items()
        }
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            self._state_executor,
            functools.partial(_write_state, self._state_path, data),
        )

    @property
    def _log_context(self) -> dict:
        return {"workspace": {"id": self._workspace.id, "path": self._workspace.path}}


def _write_state(path: Path, data: dict) -> None:
    with locked(path.with_suffix(".lock")):
        write_json(path, data)


def _runs(container: Container) -> bool:
    from ..containers import ContainerStatus

    return container.status in (ContainerStatus.RUNNING, ContainerStatus.STARTING)


def _address(host_port: int) -> str:
    return f"http://{LOOPBACK}:{host_port}"


def _log_failure(task: asyncio.Task) -> None:
    if not task.cancelled() and (exc := task.exception()) is not None:
        get_logger(__name__).error("Port relay sync failed", error=str(exc), exc_info=exc)
