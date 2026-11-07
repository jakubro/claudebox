"""Container lifecycle orchestration - spawn, stop, list."""

from __future__ import annotations

import asyncio
import functools
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi.responses import Response
from starlette.requests import Request

from claudebox import (
    Broadcaster,
    Config,
    SingleFlight,
    TmpRemapBlocked,
    create_runtime,
    get_logger,
    network_mode_publishes,
    read_json,
    write_json,
)
from claudebox.constants import (
    LABEL_DAEMON_MANAGED,
    LABEL_ID,
    LABEL_WORKSPACE,
    NETWORK_NAME_TEMPLATE,
    TUNNEL_CONTAINER_PORT,
    TUNNEL_PORT_ENV,
    WEB_CONTAINER_PORT,
)
from .errors import (
    BundleNotDeclared,
    ContainerNotFound,
    ContainerTmpMountConflict,
    ContainerUnavailable,
    NetworkModeUnsupported,
)
from .models import Container, ContainerStatus, ContainerStatusEvent
from .proxy import ContainerProxyClient
from .._locking import locked
from ...constants import CONTAINER_STARTUP_BUDGET, DAEMON_STATE_FILE


if TYPE_CHECKING:
    from ..workspaces import RegisteredWorkspace


# The fields a reconcile rewrites from its listing; a service write to one outranks that listing.
_RECONCILED_FIELDS = frozenset({"status", "backend_id", "port"})


class ContainerService:
    """Manage container lifecycle within a single workspace."""

    def __init__(
        self,
        workspace: RegisteredWorkspace,
        events: Broadcaster,
        config: Config,
        proxy: ContainerProxyClient,
        podman_executor: ThreadPoolExecutor,
        state_executor: ThreadPoolExecutor,
    ) -> None:
        self._logger = get_logger(__name__)

        self._workspace = workspace
        self._claudebox_config = config
        self._events = events
        self._proxy = proxy
        # Separate pools: a spawn blocked on podman's store lock must not hold up the write recording it.
        self._executor = podman_executor
        self._state_executor = state_executor

        self._runtime = create_runtime(self._claudebox_config)
        # A local session runs on the host, so its ports need no tunnel to reach it.
        self._tunnels = self._claudebox_config.backend != "local"

        self._containers: dict[str, Container] = {}
        self._state_path = config.config_dir / DAEMON_STATE_FILE

        # One reconcile at a time; during one, the ids this service wrote since its listing began.
        self._sync_flight = SingleFlight()
        self._written_during_sync: set[str] | None = None
        # Adopted without a registry entry; the first health answer rebuilds their side-thread members.
        self._freshly_adopted: set[str] = set()
        # Ids a spawn in this process still holds: minted, not yet registered with an owner or settled.
        # In memory on purpose - after a restart nothing holds them, exactly when they are unreachable.
        self._spawning: set[str] = set()
        self._status_observers: list[Callable[[Container], None]] = []

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
            self._state_executor,
            functools.partial(self._write_state, self._state_path, data),
        )

    @classmethod
    def _write_state(cls, path, data) -> None:
        """Synchronous state write under file lock."""

        with locked(path.with_suffix(".lock")):
            write_json(path, data)

    def _load(self) -> None:
        """Read persisted registry from disk into the in-memory store."""

        data = read_json(self._state_path, default=[])
        containers = {it["id"]: Container.fromdict(it) for it in data}
        self._containers.update(containers)

    async def sync_state(self) -> None:
        """Reconcile the registry with the runtime's listing; concurrent callers share one run."""

        await self._sync_flight.run(self._sync_once)

    def consume_fresh_adoption(self, container_id: str) -> bool:
        """Whether `container_id` was adopted with no registry entry and not yet probed; clears it."""

        if container_id in self._freshly_adopted:
            self._freshly_adopted.discard(container_id)

            return True

        return False

    async def _sync_once(self) -> None:
        """Observe the runtime across awaits, then apply the listing without one - skipping every
        entry this service wrote after the listing began, which is newer than the listing.
        """

        self._written_during_sync = set()

        try:
            observed = await self._observe_runtime()

            if observed is None:
                return

            self._apply_observation(observed, self._written_during_sync)
        finally:
            self._written_during_sync = None

        await self.save()

    async def _observe_runtime(self) -> dict[str, tuple[str, ContainerStatus, int | None]] | None:
        """This workspace's containers as the runtime lists them: backend id, status, running port."""

        loop = asyncio.get_running_loop()

        try:
            containers = await loop.run_in_executor(self._executor, self._runtime.list_containers)
        except Exception:
            self._logger.warning(
                "Failed to list containers during rediscovery",
                exc_info=True,
                **self._log_context,
            )

            return None

        observed = {}

        for container in containers:
            labels = container.get("Labels") or {}
            container_id = labels.get(LABEL_ID)

            if not container_id or labels.get(LABEL_WORKSPACE) != self._workspace.id:
                continue

            backend_id = container.get("Id", container.get("ID", ""))
            state = container.get("State", "unknown")
            status = ContainerStatus.RUNNING if state == "running" else ContainerStatus.STOPPED
            port = (
                await self._lookup_port(backend_id) if status == ContainerStatus.RUNNING else None
            )

            observed[container_id] = (backend_id, status, port)

        return observed

    def _apply_observation(
        self,
        observed: dict[str, tuple[str, ContainerStatus, int | None]],
        written: set[str],
    ) -> None:
        changed: list[Container] = []

        for container_id, (backend_id, status, port) in observed.items():
            if container_id in written:
                continue

            if existing := self._containers.get(container_id):
                existing.backend_id = backend_id
                was = existing.status

                # The runtime says a process exists; only the probe says the API answers, so a
                # crashed verdict outranks a running one, and the count belongs to the probe.
                crashed_but_alive = (
                    existing.status == ContainerStatus.CRASHED and status == ContainerStatus.RUNNING
                )

                if not crashed_but_alive:
                    existing.status = status

                if existing.status != was:
                    changed.append(existing)
            else:
                self._containers[container_id] = Container(
                    id=container_id,
                    backend_id=backend_id,
                    port=0,
                    status=status,
                )
                self._freshly_adopted.add(container_id)

            entry = self._containers[container_id]

            if port and entry.status == ContainerStatus.RUNNING:
                self._apply_port(entry, port)

        # Remove containers no longer present in the backend
        for container_id in list(self._containers):
            if container_id not in observed and container_id not in written:
                changed.append(self._containers.pop(container_id))
                self._freshly_adopted.discard(container_id)

        for container in changed:
            for observer in self._status_observers:
                observer(container)

    # Container Management
    # ----------------------------------------------------------------------------------------------

    def get(self, container_id: str) -> Container:
        """Look up a container by ID."""

        try:
            return self._containers[container_id]
        except KeyError:
            raise ContainerNotFound(container_id=container_id)

    async def find_by_session(self, session_id: str, *, sync: bool = False) -> Container | None:
        """Find a container serving the given session - as owner first, then as a member.

        The owner wins when both match: a stop must resolve to it, not to dict iteration order.
        """

        if sync:
            await self.sync_state()

        # Match RUNNING and STARTING so in-flight spawns resolve before the health check completes.
        live = (ContainerStatus.RUNNING, ContainerStatus.STARTING)

        for container in self._containers.values():
            if container.session_id == session_id and container.status in live:
                return container

        for container in self._containers.values():
            if session_id in container.members and container.status in live:
                return container

        return None

    async def find_by_peer_pid(self, pid: int) -> Container | None:
        """Resolve a unix-socket peer's OS pid to the container it is running inside.

        The pid's place in a container's process tree (cgroup, or process group) is the only truth.
        """

        candidate_ids = [c.backend_id for c in self._containers.values()]

        loop = asyncio.get_running_loop()
        backend_id = await loop.run_in_executor(
            self._executor,
            functools.partial(self._runtime.identify_container_from_pid, pid, candidate_ids),
        )

        if not backend_id:
            return None

        for container in self._containers.values():
            if container.backend_id == backend_id:
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
        *,
        bundle: str | None = None,
    ) -> Container:
        """Spawn a new container, register it, and broadcast status; `bundle` names the settings
        bundle the container is built from, refused before anything spawns when undeclared."""

        container = await self._start_container(
            labels,
            env,
            extra_volumes,  # ty: ignore[invalid-argument-type]
            run_args,
            session_id=session_id,
            bundle=bundle,
        )
        container.status = ContainerStatus.STARTING
        container.session_id = session_id

        self._containers[container.id] = container
        self._mark_written(container.id)

        if session_id:
            self._spawning.discard(container.id)

        await self.save()

        await self._broadcast_status(container)

        return container

    async def update(self, container: Container, **fields) -> None:
        """Apply field updates to a container; persist only when a value actually changed."""

        previous_status = container.status
        changed = False

        for key, val in fields.items():
            if not hasattr(container, key):
                raise TypeError(f"Container has no field {key!r}")

            if getattr(container, key) != val:
                setattr(container, key, val)
                changed = True

                if key in _RECONCILED_FIELDS:
                    self._mark_written(container.id)

        if changed:
            await self.save()

        if container.status != previous_status:
            await self._broadcast_status(container)

    def add_status_observer(self, observer: Callable[[Container], None]) -> None:
        """Call `observer` with each container whose state changes, removal included; must not block."""

        self._status_observers.append(observer)

    def remove_status_observer(self, observer: Callable[[Container], None]) -> None:
        """Stop calling `observer`; one never added, as by a service stopped before it started, is ignored."""

        if observer in self._status_observers:
            self._status_observers.remove(observer)

    def release_spawn(self, container_id: str) -> None:
        """Drop a spawn's claim on its container once the operation that started it has settled."""

        self._spawning.discard(container_id)

    async def reap_orphan(self, container_id: str) -> bool:
        """Kill and remove a container no session can reach; whether it was reaped.

        Only one with no owner, members or sessions, past its startup budget, unclaimed by a spawn.
        """

        container = self._containers.get(container_id)

        if (
            container is None
            or container_id in self._spawning
            or container.session_id
            or container.members
            or container.live_session_ids
            or container.status not in (ContainerStatus.RUNNING, ContainerStatus.STOPPED)
            or datetime.now(UTC) - container.created_at <= CONTAINER_STARTUP_BUDGET
        ):
            return False

        self._logger.warning(
            "Reaping a container no session can reach",
            container={"id": container_id, "status": container.status},
            **self._log_context,
        )

        if container.status == ContainerStatus.RUNNING:
            await self.kill_container(container_id)

        await self.remove(container_id)

        return True

    async def stop_container(self, container_id: str, *, grace_seconds: int = 10) -> None:
        """Send SIGTERM with a ``grace_seconds`` grace period; container ends STOPPED. Raises
        ContainerNotFound if not in registry.
        """

        await self._signal_to_stopped(
            container_id,
            functools.partial(self._runtime.stop_container, grace_seconds=grace_seconds),
            failure_message="Container stop failed",
        )

    async def kill_container(self, container_id: str) -> None:
        """Send SIGKILL immediately; container ends STOPPED. Raises ContainerNotFound if not
        in registry.
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
        self._mark_written(container_id)
        await self._broadcast_status(container)

        loop = asyncio.get_running_loop()

        try:
            await loop.run_in_executor(self._executor, runtime_call, container.backend_id)
        except Exception:
            self._logger.warning(
                failure_message,
                exc_info=True,
                container={"id": container_id},
                **self._log_context,
            )

        container.status = ContainerStatus.STOPPED
        self._mark_written(container_id)
        await self._broadcast_status(container)

    async def remove(self, container_id: str) -> None:
        """Force-remove the container backend and drop it from the registry.

        Broadcasts ``SessionsChangedEvent`` when the container served a session, so tabs
        refetch and drop it promptly. Raises ContainerNotFound if not in registry.
        """

        # Local import avoids a containers <-> sessions circular import at module load time.
        from ..sessions.models import SessionsChangedEvent

        container = self.get(container_id)
        session_id = container.session_id
        self._mark_written(container_id)

        loop = asyncio.get_running_loop()

        try:
            await loop.run_in_executor(
                self._executor,
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
        self._freshly_adopted.discard(container_id)
        self._mark_written(container_id)
        await self.save()

        for observer in self._status_observers:
            observer(container)

        if session_id:
            await self._events.broadcast(
                SessionsChangedEvent(
                    workspace_id=self._workspace.id,
                    container_id=container_id,
                ),
            )

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
        *,
        session_id: str | None = None,
        bundle: str | None = None,
    ) -> Container:
        """Spawn a container via the backend and return a Container with discovered port."""

        container_id = str(uuid.uuid4())
        # Claimed before podman runs: a reconcile can adopt the container while it still starts.
        self._spawning.add(container_id)

        try:
            return await self._spawn(
                container_id,
                labels,
                env,
                extra_volumes,
                run_args,
                session_id,
                bundle,
            )
        except BaseException:
            self._spawning.discard(container_id)

            raise

    async def _spawn(
        self,
        container_id: str,
        labels: dict[str, str] | None,
        env: dict[str, str] | None,
        extra_volumes: list[tuple[str | Path, str | Path]] | None,
        run_args: list[str] | None,
        session_id: str | None,
        bundle: str | None,
    ) -> Container:
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
        }

        if self._tunnels:
            env[TUNNEL_PORT_ENV] = str(TUNNEL_CONTAINER_PORT)

        # Reload so mount/port/env/network reflect current settings.toml; agent/profile/backend
        # stay on the load-time snapshot.
        config = Config.load(self._workspace.path)

        if bundle:
            if bundle not in (config.bundles or {}):
                session = {"session_id": session_id} if session_id else {}

                raise BundleNotDeclared(bundle=bundle, **session)

            config = Config.resolve_bundle(self._workspace.path, bundle)

        if (mode := config.network_mode) is not None and not network_mode_publishes(mode):
            session = {"session_id": session_id} if session_id else {}
            bundle_table = (config.bundles or {}).get(bundle or "", {})

            if bundle and (bundle_table.get("network") or {}).get("mode") is not None:
                raise NetworkModeUnsupported(mode=mode, source="bundle", bundle=bundle, **session)

            raise NetworkModeUnsupported(mode=mode, source="workspace", **session)

        loop = asyncio.get_running_loop()

        try:
            backend_id = await loop.run_in_executor(
                self._executor,
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
                    config=config,
                ),
            )
        except TmpRemapBlocked as exc:
            raise ContainerTmpMountConflict(paths=exc.context["paths"]) from exc

        port = 0
        tunnel_port = 0

        try:
            port = await loop.run_in_executor(
                self._executor,
                functools.partial(
                    self._runtime.get_host_port,
                    backend_id,
                    WEB_CONTAINER_PORT,
                ),
            )

            if self._tunnels:
                tunnel_port = await loop.run_in_executor(
                    self._executor,
                    functools.partial(
                        self._runtime.get_host_port,
                        backend_id,
                        TUNNEL_CONTAINER_PORT,
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
            tunnel_port=tunnel_port,
        )

    async def _create_network(self) -> None:
        """Ensure the workspace-scoped container network exists."""

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            self._executor,
            functools.partial(self._runtime.create_network, self._network),
        )

    async def _refresh_port(self, container: Container) -> None:
        """Re-discover the host port for a running container, updating in-place; skips
        silently if not running or discovery fails.
        """

        if container.status != ContainerStatus.RUNNING:
            return

        if port := await self._lookup_port(container.backend_id):
            self._apply_port(container, port)

    async def _lookup_port(self, backend_id: str) -> int | None:
        """The runtime's host port for the container's API, or None when discovery fails."""

        loop = asyncio.get_running_loop()

        try:
            return await loop.run_in_executor(
                self._executor,
                functools.partial(self._runtime.get_host_port, backend_id, WEB_CONTAINER_PORT),
            )
        except Exception:  # noqa: BLE001 - best-effort refresh, never fatal
            self._logger.debug(
                "Port refresh failed",
                container={"backend_id": backend_id},
                **self._log_context,
            )

            return None

    def _apply_port(self, container: Container, port: int) -> None:
        if port == container.port:
            return

        if container.port:
            self._logger.warning(
                "Registered container port disagreed with the runtime",
                recorded_port=container.port,
                runtime_port=port,
                container={"id": container.id},
                **self._log_context,
            )
        else:
            self._logger.info(
                "Refreshed container port",
                old_port=container.port,
                new_port=port,
                container={"id": container.id},
                **self._log_context,
            )

        container.port = port

    @property
    def _network(self) -> str:
        """Workspace-scoped network name."""

        return NETWORK_NAME_TEMPLATE.format(workspace_id=self._workspace.id)

    # Misc
    # ----------------------------------------------------------------------------------------------

    def _mark_written(self, container_id: str) -> None:
        if self._written_during_sync is not None:
            self._written_during_sync.add(container_id)

    async def _broadcast_status(self, container: Container) -> None:
        for observer in self._status_observers:
            observer(container)

        await self._events.broadcast(
            ContainerStatusEvent(
                container_id=container.id,
                workspace_id=self._workspace.id,
                status=container.status,
            ),
        )

    @property
    def _log_context(self) -> dict:
        return {
            "workspace": {"id": self._workspace.id, "path": self._workspace.path},
        }
