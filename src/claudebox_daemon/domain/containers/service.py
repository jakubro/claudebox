"""Container lifecycle orchestration - spawn, stop, list."""

import asyncio
import functools
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi.responses import Response
from filelock import FileLock
from starlette.requests import Request

from claudebox import Broadcaster, Config, create_runtime, get_logger, read_json, write_json
from claudebox.constants import (
    LABEL_DAEMON_MANAGED,
    LABEL_ID,
    LABEL_WORKSPACE,
    NETWORK_NAME_TEMPLATE,
    WEB_CONTAINER_PORT,
)
from .errors import ContainerNotFound, ContainerUnavailable
from .models import Container, ContainerStatus, ContainerStatusEvent
from .proxy import ContainerProxyClient
from ...constants import DAEMON_STATE_FILE


if TYPE_CHECKING:
    from ..workspaces import RegisteredWorkspace


class ContainerService:
    """Manage container lifecycle within a single workspace."""

    def __init__(
        self,
        workspace: "RegisteredWorkspace",
        events: Broadcaster,
        config: Config,
        proxy: ContainerProxyClient,
    ) -> None:
        self._logger = get_logger(__name__)

        self._workspace = workspace
        self._claudebox_config = config
        self._events = events
        self._proxy = proxy

        self._runtime = create_runtime(self._claudebox_config)

        self._containers: dict[str, Container] = {}
        self._state_path = config.config_dir / DAEMON_STATE_FILE

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Load persisted state, create network, and sync with the backend."""

        self._logger.debug("Starting container service...", **self._log_context)

        self._load()
        await self._create_network()
        await self.sync_state()

        self._logger.info("Container service started", **self._log_context)

    async def stop(self) -> None:
        """Persist registry state to disk."""

        self._logger.debug("Stopping container service...", **self._log_context)

        await self.save()

        self._logger.info("Container service stopped")

    # State Management
    # ----------------------------------------------------------------------------------------------

    async def save(self) -> None:
        """Write registry state to disk."""

        loop = asyncio.get_running_loop()
        data = self.list_all()
        await loop.run_in_executor(
            None,
            functools.partial(self._write_state, self._state_path, data),
        )

    @classmethod
    def _write_state(cls, path, data) -> None:
        """Synchronous state write under file lock."""

        with FileLock(path.with_suffix(".lock")):
            write_json(path, data)

    def _load(self) -> None:
        """Read persisted registry from disk into the in-memory store."""

        data = read_json(self._state_path, default=[])
        containers = {it["id"]: Container.fromdict(it) for it in data}
        self._containers.update(containers)

    async def sync_state(self) -> None:
        """Rebuild registry from running containers via the container backend.

        Queries the container backend for containers with the claudebox label,
        matches them against the registry by the claudebox-id label, and updates
        or registers entries accordingly. Only claims containers with a matching
        claudebox-workspace label.
        """

        loop = asyncio.get_running_loop()

        try:
            containers = await loop.run_in_executor(None, self._runtime.list_containers)
        except Exception:
            self._logger.warning(
                "Failed to list containers during rediscovery",
                exc_info=True,
                **self._log_context,
            )

            return

        seen_ids = set()

        for container in containers:
            labels = container.get("Labels") or {}
            container_id = labels.get(LABEL_ID)

            if not container_id:
                continue

            # Filter by workspace label
            container_workspace = labels.get(LABEL_WORKSPACE)

            if container_workspace != self._workspace.id:
                continue

            seen_ids.add(container_id)
            backend_id = container.get("Id", container.get("ID", ""))
            state = container.get("State", "unknown")
            status = ContainerStatus.RUNNING if state in ("running",) else ContainerStatus.STOPPED

            if existing := self._containers.get(container_id):
                existing.backend_id = backend_id
                existing.status = status
                existing.failure_count = 0
            else:
                self._containers[container_id] = Container(
                    id=container_id,
                    backend_id=backend_id,
                    port=0,
                    status=status,
                )

            container_entry = self._containers[container_id]

            if container_entry.port == 0:
                await self._refresh_port(container_entry)

        # Remove containers no longer present in the backend
        for cid in list(self._containers):
            if cid not in seen_ids:
                del self._containers[cid]

        await self.save()

    # Container Management
    # ----------------------------------------------------------------------------------------------

    def get(self, container_id: str) -> Container:
        """Look up a container by ID."""

        try:
            return self._containers[container_id]
        except KeyError:
            raise ContainerNotFound(container_id=container_id)

    async def find_by_session(self, session_id: str, *, sync: bool = False) -> Container | None:
        """Find a container serving the given session."""

        if sync:
            await self.sync_state()

        # Match RUNNING and STARTING so in-flight spawns resolve before the health check completes.
        for container in self._containers.values():
            if container.session_id == session_id and container.status in (
                ContainerStatus.RUNNING,
                ContainerStatus.STARTING,
            ):
                return container

        return None

    def list_all(self) -> list[Container]:
        """Return all registered containers from the in-memory snapshot."""

        return list(self._containers.values())

    async def create(
        self,
        labels: dict[str, str] | None = None,
        env: dict[str, str] | None = None,
        extra_volumes: list[tuple[str | Path, str | Path, bool]] | None = None,
        run_args: list[str] | None = None,
        session_id: str | None = None,
    ) -> Container:
        """Spawn a new container, register it, and broadcast status."""

        container = await self._start_container(
            labels,
            env,
            extra_volumes,  # ty: ignore[invalid-argument-type]
            run_args,
        )
        container.status = ContainerStatus.STARTING
        container.session_id = session_id

        self._containers[container.id] = container
        await self.save()

        await self._broadcast_status(container)

        return container

    async def update(self, container: Container, **fields) -> None:
        """Apply field updates to a container and broadcast if status changed."""

        previous_status = container.status

        for key, val in fields.items():
            if not hasattr(container, key):
                raise TypeError(f"Container has no field {key!r}")

            setattr(container, key, val)

        await self.save()

        if container.status != previous_status:
            await self._broadcast_status(container)

    async def stop_container(self, container_id: str, *, grace_seconds: int = 10) -> None:
        """Send SIGTERM with a ``grace_seconds`` grace period; container ends STOPPED.

        Raises ContainerNotFound if not in registry.
        """

        await self._signal_to_stopped(
            container_id,
            functools.partial(self._runtime.stop_container, grace_seconds=grace_seconds),
            failure_message="Container stop failed",
        )

    async def kill_container(self, container_id: str) -> None:
        """Send SIGKILL immediately; container ends STOPPED.

        Raises ContainerNotFound if not in registry.
        """

        await self._signal_to_stopped(
            container_id,
            self._runtime.kill_container,
            failure_message="Container kill failed",
        )

    async def _signal_to_stopped(
        self,
        container_id: str,
        runtime_call,
        *,
        failure_message: str,
    ) -> None:
        """Drive container through STOPPING -> STOPPED via ``runtime_call(backend_id)``."""

        container = self.get(container_id)
        container.status = ContainerStatus.STOPPING
        await self._broadcast_status(container)

        loop = asyncio.get_running_loop()

        try:
            await loop.run_in_executor(None, runtime_call, container.backend_id)
        except Exception:
            self._logger.warning(
                failure_message,
                exc_info=True,
                container={"id": container_id},
                **self._log_context,
            )

        container.status = ContainerStatus.STOPPED
        await self._broadcast_status(container)

    async def remove(self, container_id: str) -> None:
        """Force-remove the container backend and drop it from the registry.

        Raises ContainerNotFound if not in registry.
        """

        container = self.get(container_id)

        loop = asyncio.get_running_loop()

        try:
            await loop.run_in_executor(
                None,
                functools.partial(self._runtime.remove_container, container.backend_id),
            )
        except Exception:
            self._logger.warning(
                "Force remove failed",
                exc_info=True,
                container={"id": container_id},
                **self._log_context,
            )

        self._containers.pop(container_id, None)
        await self.save()

    async def send(self, payload: Any, container_id: str, endpoint: str, method: str) -> dict:
        """Send a request to a container, retrying once on stale port."""

        container = self.get(container_id)

        try:
            return await self._proxy.send(
                payload=payload,
                container=container,
                endpoint=endpoint,
                method=method,
            )
        except ContainerUnavailable:
            await self._refresh_port(container)

            return await self._proxy.send(
                payload=payload,
                container=container,
                endpoint=endpoint,
                method=method,
            )

    async def forward(self, request: Request, container_id: str, endpoint: str) -> Response:
        """Proxy a request to a container, retrying once on stale port."""

        container = self.get(container_id)

        try:
            return await self._proxy.forward(
                request,
                container=container,
                endpoint=endpoint,
            )
        except ContainerUnavailable:
            await self._refresh_port(container)

            return await self._proxy.forward(
                request,
                container=container,
                endpoint=endpoint,
            )

    # Container Backend Integration
    # ----------------------------------------------------------------------------------------------

    async def _start_container(
        self,
        labels: dict[str, str] | None,
        env: dict[str, str] | None,
        extra_volumes: list[tuple[str | Path, str | Path]] | None,
        run_args: list[str] | None,
    ) -> Container:
        """Spawn a container via the backend and return a Container with discovered port."""

        container_id = str(uuid.uuid4())

        labels = labels or {}
        labels = {
            **labels,
            LABEL_ID: container_id,
            LABEL_WORKSPACE: self._workspace.id,
            LABEL_DAEMON_MANAGED: "true",
            "kind": "agent",
        }

        env = env or {}
        env = {
            **env,
            "CLAUDEBOX_WEB": "1",
            "CLAUDEBOX_PWD": str(self._workspace.path),
            # "CLAUDEBOX_DEV": str(int(is_dev_mode())),
        }

        loop = asyncio.get_running_loop()

        backend_id = await loop.run_in_executor(
            None,
            functools.partial(
                self._runtime.run_container,
                name=container_id,
                labels=labels,
                env=env,
                network=self._network,
                publish_all=True,
                extra_volumes=extra_volumes,
                run_args=run_args or [],
                detach=True,
            ),
        )

        port = 0

        try:
            port = await loop.run_in_executor(
                None,
                functools.partial(
                    self._runtime.get_host_port,
                    backend_id,
                    WEB_CONTAINER_PORT,
                ),
            )
        except Exception:
            self._logger.warning(
                "Failed to discover host port",
                exc_info=True,
                container={"id": container_id},
                **self._log_context,
            )

        return Container(
            id=container_id,
            backend_id=backend_id,
            port=port,
            status=ContainerStatus.STARTING,
            labels=labels,
        )

    async def _create_network(self) -> None:
        """Ensure the workspace-scoped container network exists."""

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            functools.partial(self._runtime.create_network, self._network),
        )

    async def _refresh_port(self, container: Container) -> None:
        """Re-discover the host port for a running container.

        Updates the container's port in-place. Silently skips if the container
        is not running or port discovery fails.
        """

        if container.status != ContainerStatus.RUNNING:
            return

        loop = asyncio.get_running_loop()

        try:
            port = await loop.run_in_executor(
                None,
                functools.partial(
                    self._runtime.get_host_port,
                    container.backend_id,
                    WEB_CONTAINER_PORT,
                ),
            )

            if port and port != container.port:
                self._logger.info(
                    "Refreshed container port",
                    old_port=container.port,
                    new_port=port,
                    container={"id": container.id},
                    **self._log_context,
                )
                container.port = port
        except Exception:
            self._logger.debug(
                "Port refresh failed",
                container={"id": container.id},
                **self._log_context,
            )

    @property
    def _network(self) -> str:
        """Workspace-scoped network name."""

        return NETWORK_NAME_TEMPLATE.format(workspace_id=self._workspace.id)

    # Misc
    # ----------------------------------------------------------------------------------------------

    async def _broadcast_status(self, container: Container) -> None:
        await self._events.broadcast(
            ContainerStatusEvent(
                container_id=container.id,
                workspace_id=self._workspace.id,
                status=container.status,
            )
        )

    @property
    def _log_context(self) -> dict:
        return {
            "workspace": {"id": self._workspace.id, "path": self._workspace.path},
        }
