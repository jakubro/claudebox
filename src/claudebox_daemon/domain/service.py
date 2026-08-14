"""Daemon service - top-level object owning all daemon dependencies."""

import asyncio
from pathlib import Path

from claudebox import get_logger
from .broadcaster import DaemonBroadcaster
from .config import DaemonConfig
from .containers import ContainerProxyClient, ContainerStatus
from .errors import WorkspaceNotRegistered
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
        self._health_monitor = HealthMonitor(self)
        self._mutation_observer = SessionMutationObserver(self)
        self._workspaces: dict[str, WorkspaceService] = {}
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
        """Return loaded workspace, lazy-loading from config if needed."""

        try:
            return self._workspaces[workspace_id]
        except KeyError:
            self._reload_config()

            return await self._load_workspace(workspace_id)

    async def list_workspaces(self, sync: bool = True) -> list[WorkspaceService]:
        """Sync with config and return all loaded workspace services."""

        if sync:
            await self._sync_state()

        return list(self._workspaces.values())

    async def register_workspace(self, path: str | Path) -> RegisteredWorkspace:
        """Register a workspace; idempotent - re-register returns the existing entry.

        Newly-registered workspaces are eagerly loaded into the in-memory map so they
        are reachable via `get_workspace` without a subsequent sync.
        """

        loop = asyncio.get_running_loop()
        workspace = await loop.run_in_executor(
            self._executors.state,
            self._daemon_config.register_workspace,
            path,
        )

        if workspace.id not in self._workspaces:
            try:
                await self._load_workspace(workspace.id)
            except Exception:
                self._logger.exception(
                    "Failed to load newly registered workspace",
                    workspace={"id": workspace.id, "path": workspace.path},
                )

        return workspace

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

        svc = self._workspaces.pop(workspace_id, None)

        if svc is not None:
            try:
                await svc.stop()
            except Exception:
                self._logger.exception(
                    "Failed to stop workspace service during deregister",
                    workspace={"id": workspace_id},
                )

    # Aggregation
    # ----------------------------------------------------------------------------------------------

    async def list_workspaces_with_counts(self) -> list[dict]:
        """Return every registered workspace with its running/stopped container counts."""

        workspaces = await self.list_workspaces(sync=True)

        entries: list[dict] = []

        for ws in workspaces:
            running = 0
            stopped = 0

            if ws.workspace.available and ws.container_service is not None:
                for container in ws.container_service.list_all():
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
        """Reload config and load any newly registered workspaces."""

        self._reload_config()

        for workspace in self._daemon_config.workspaces:
            if workspace.id not in self._workspaces:
                try:
                    await self._load_workspace(workspace.id)
                except Exception:
                    self._logger.exception(
                        "Failed to load workspace",
                        workspace={"id": workspace.id, "path": workspace.path},
                    )

    def _reload_config(self) -> None:
        """Re-read daemon config from disk."""

        self._daemon_config = DaemonConfig.load()

    async def _load_workspace(self, workspace_id: str) -> WorkspaceService:
        """Load a registered workspace into the daemon runtime; raises WorkspaceNotRegistered if unregistered."""

        workspace = self._daemon_config.get_workspace(workspace_id)

        svc = WorkspaceService(workspace, self.events, self.proxy, self._executors)
        await svc.start()

        self._workspaces[workspace_id] = svc

        return svc
