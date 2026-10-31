"""Daemon service - top-level object owning all daemon dependencies."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from pathlib import Path

from claudebox import Workspace, get_logger, library_commit
from claudebox.constants import CONFIG_DIR_NAME, SESSIONS_DIR_NAME, WORKSPACE_MARKER
from .broadcaster import DaemonBroadcaster
from .config import DaemonConfig
from .containers import ContainerProxyClient, ContainerStatus
from .errors import ValidationError, WorkspaceNotRegistered
from .executors import DaemonExecutors
from .health import HealthMonitor
from .mutation_observer import SessionMutationObserver
from .serving import ServingProbe
from .watchdog import DaemonWatchdog
from .workspaces import RegisteredWorkspace, WorkspaceService


class DaemonService:
    """Top-level daemon service - owns the lifecycle of every sub-service."""

    def __init__(self) -> None:

        self._logger = get_logger(__name__)

        self._daemon_config = DaemonConfig.load()
        self._commit = library_commit()
        self._health_monitor = HealthMonitor(self)
        self._mutation_observer = SessionMutationObserver(self)
        self._workspaces: dict[str, WorkspaceService] = {}
        self._loads: dict[str, asyncio.Future[WorkspaceService]] = {}
        self._executors = DaemonExecutors.create()

        self.proxy = ContainerProxyClient()
        self.events = DaemonBroadcaster()
        self.watchdog = DaemonWatchdog()
        self.serving = ServingProbe(self._executors)

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Initialize per-workspace services and start health polling."""

        self._logger.debug("Starting daemon service...")

        await self._sync_state()
        await self._health_monitor.probe_once()
        await self._health_monitor.start()
        await self._mutation_observer.start()
        await self.watchdog.start()
        await self.serving.start()

        self._logger.info("Daemon service initialized")

    async def stop(self) -> None:
        """Stop health polling, close clients, and persist workspace state."""

        self._logger.debug("Stopping daemon service...")

        await self.serving.stop()
        await self.watchdog.stop()
        await self._mutation_observer.stop()
        await self._health_monitor.stop()
        await self.proxy.close()

        for workspace in self._workspaces.values():
            await workspace.stop()

        self._executors.shutdown()

        self._logger.info("Daemon service stopped")

    # Workspace Discovery
    # ----------------------------------------------------------------------------------------------

    async def get_workspace(self, workspace_id: str) -> WorkspaceService:
        """Return loaded workspace, lazy-loading from config if needed - a cached entry whose
        directory has returned since being snapshotted unavailable is rebuilt here too.
        """

        svc = self._workspaces.get(workspace_id)

        if svc is not None and workspace_id not in self._loads and _is_current(svc):
            return svc

        if svc is None:
            self._reload_config()

        return await self._load_workspace(self._daemon_config.get_workspace(workspace_id))

    async def list_workspaces(self, sync: bool = True) -> list[WorkspaceService]:
        """Sync with config and return all loaded workspace services."""

        if sync:
            await self._sync_state()

        return list(self._workspaces.values())

    async def register_workspace(self, path: str | Path) -> tuple[RegisteredWorkspace, bool]:
        """Mark a directory as a workspace and register it; also say whether it already was.

        Newly-registered workspaces are eagerly loaded into the in-memory map so they
        are reachable via `get_workspace` without a subsequent sync.
        """

        loop = asyncio.get_running_loop()
        workspace, already_registered, marked = await loop.run_in_executor(
            self._executors.state,
            self._register,
            path,
        )

        # A service built before the marker existed reads its sessions from another directory.
        if marked:
            await self._evict(workspace.id)

        try:
            await self._load_workspace(workspace)
        except Exception:
            self._logger.exception(
                "Failed to load newly registered workspace",
                workspace={"id": workspace.id, "path": workspace.path},
            )

        return workspace, already_registered

    async def deregister_workspace(self, workspace_id: str) -> None:
        """Remove a workspace from config and evict it from the map; raises WorkspaceNotRegistered if absent."""

        loop = asyncio.get_running_loop()
        removed = await loop.run_in_executor(
            self._executors.state,
            self._daemon_config.deregister_workspace,
            workspace_id,
        )

        if not removed:
            raise WorkspaceNotRegistered(workspace_id=workspace_id)

        await self._evict(workspace_id)

    # Aggregation
    # ----------------------------------------------------------------------------------------------

    async def list_workspaces_with_counts(self) -> list[dict]:
        """Return every registered workspace with its running/stopped container counts."""

        workspaces = await self.list_workspaces(sync=True)

        entries: list[dict] = []

        for ws in workspaces:
            running = 0
            stopped = 0

            if ws.available and ws._container_service is not None:
                for container in ws._container_service.list_all():
                    if container.status == ContainerStatus.RUNNING:
                        running += 1
                    else:
                        stopped += 1

            entries.append(
                {
                    "id": ws.workspace.id,
                    "path": str(ws.workspace.path),
                    "containers": {"running": running, "stopped": stopped},
                },
            )

        return entries

    # Diagnostics
    # ----------------------------------------------------------------------------------------------

    def health(self) -> dict:
        """Aggregate every liveness signal, naming the one that tripped. Reads cached state only."""

        signals = {
            "event_loop": "ok" if self.watchdog.healthy else "degraded",
            "serving": "ok" if self.serving.healthy else "degraded",
        }
        degraded = [name for name, state in signals.items() if state == "degraded"]

        return {
            "mode": "daemon",
            "status": "degraded" if degraded else "ok",
            "commit": self._commit,
            "degraded": degraded,
            "signals": signals,
            "serving": {
                "unanswered_pools": self.serving.failing,
                "consecutive_failures": self.serving.consecutive_failures,
                "latency_seconds": self.serving.last_latency_seconds,
            },
            "pools": self._executors.stats(),
        }

    def report_frontend_error(
        self,
        *,
        kind: str,
        message: str,
        stack_trace: str | None,
        app_version: str | None,
        client_timestamp: str,
    ) -> None:
        """Log a frontend-reported failure. Named stack_trace, not stack - structlog's StackInfoRenderer silently drops a literal "stack" key."""

        self._logger.warning(
            "frontend_error",
            kind=kind,
            message=message,
            stack_trace=stack_trace,
            app_version=app_version,
            client_timestamp=client_timestamp,
        )

    # State Management
    # ----------------------------------------------------------------------------------------------

    async def _sync_state(self) -> None:
        """Reload config; load newly registered workspaces and rebuild ones whose directory returned."""

        self._reload_config()

        for workspace in self._daemon_config.workspaces:
            try:
                await self._load_workspace(workspace)
            except Exception:
                self._logger.exception(
                    "Failed to load workspace",
                    workspace={"id": workspace.id, "path": workspace.path},
                )

    def _reload_config(self) -> None:
        """Re-read daemon config from disk."""

        self._daemon_config = DaemonConfig.load()

    def _register(self, path: str | Path) -> tuple[RegisteredWorkspace, bool, bool]:
        directory, marked = _marked_directory(path)

        if (existing := self._daemon_config.find_workspace(directory)) is not None:
            return existing, True, marked

        return self._daemon_config.register_workspace(directory), False, marked

    async def _evict(self, workspace_id: str) -> None:
        # A load finishing after the pop would store the evicted service; its error is its callers'.
        if (load := self._loads.get(workspace_id)) is not None:
            with suppress(Exception):
                await asyncio.shield(load)

        svc = self._workspaces.pop(workspace_id, None)

        if svc is not None:
            try:
                await svc.stop()
            except Exception:
                self._logger.exception(
                    "Failed to stop evicted workspace service",
                    workspace={"id": workspace_id},
                )

    def _repair_marker(self, workspace: RegisteredWorkspace) -> None:
        if not workspace.available:
            return

        own_sessions = workspace.path / CONFIG_DIR_NAME / SESSIONS_DIR_NAME

        try:
            # Config uses the registered path, Workspace the nearest marker; a marker aligns them.
            if Workspace(workspace.path).sessions_root.resolve() != own_sessions.resolve():
                (workspace.path / WORKSPACE_MARKER).touch()
        except OSError as exc:
            self._logger.warning(
                "Failed to write workspace marker",
                workspace={"id": workspace.id, "path": workspace.path},
                error=str(exc),
            )

    async def _load_workspace(self, workspace: RegisteredWorkspace) -> WorkspaceService:
        """Return the workspace's current service, joining the load in flight or starting one.

        A load is shielded so it always completes: a half-started one would leak its watcher and socket.
        """

        if (load := self._loads.get(workspace.id)) is not None:
            return await asyncio.shield(load)

        cached = self._workspaces.get(workspace.id)

        if cached is not None and _is_current(cached):
            return cached

        load = asyncio.ensure_future(self._build_workspace(workspace))
        self._loads[workspace.id] = load
        load.add_done_callback(lambda done: self._finish_load(workspace.id, done))

        return await asyncio.shield(load)

    async def _build_workspace(self, workspace: RegisteredWorkspace) -> WorkspaceService:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(self._executors.state, self._repair_marker, workspace)

        svc = WorkspaceService(workspace, self.events, self.proxy, self._executors)
        await svc.start()

        self._workspaces[workspace.id] = svc

        return svc

    def _finish_load(self, workspace_id: str, load: asyncio.Future) -> None:
        if self._loads.get(workspace_id) is load:
            del self._loads[workspace_id]

        # Marks a failure retrieved when every caller has left, so it is not reported as unhandled.
        if not load.cancelled():
            load.exception()


def _is_current(svc: WorkspaceService) -> bool:
    # Stale: snapshotted unavailable while its directory has since come back.
    return svc.available or not svc.workspace.available


def _marked_directory(path: str | Path) -> tuple[Path, bool]:
    # An unknown ~user raises rather than expanding; left as written, the path is not absolute.
    try:
        directory = Path(path).expanduser()
    except RuntimeError:
        directory = Path(path)

    if not directory.is_absolute():
        raise ValidationError(
            "workspace_path_relative",
            path=str(path),
            message=f"Not an absolute path: {path}",
        )

    try:
        if not directory.exists():
            raise ValidationError(
                "workspace_path_missing",
                path=str(directory),
                message=f"No directory at {directory}",
            )
        elif not directory.is_dir():
            raise ValidationError(
                "workspace_path_not_a_directory",
                path=str(directory),
                message=f"Not a directory: {directory}",
            )

        directory = directory.resolve()
        marker = directory / WORKSPACE_MARKER
        marked = not marker.exists()

        if marked:
            marker.touch()
    except OSError as exc:
        raise ValidationError(
            "workspace_marker_unwritable",
            path=str(directory),
            message=f"Cannot create the {WORKSPACE_MARKER} marker in {directory}: {exc.strerror or exc}",
        ) from exc

    return directory, marked
