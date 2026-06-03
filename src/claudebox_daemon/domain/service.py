"""Daemon service — top-level object owning all daemon dependencies."""

from pathlib import Path

from claudebox import Broadcaster, get_logger
from .config import DaemonConfig
from .containers import ContainerProxyClient, ContainerStatus
from .errors import WorkspaceNotRegistered
from .health import HealthMonitor
from .mutation_observer import SessionMutationObserver
from .workspaces import RegisteredWorkspace, WorkspaceService


class DaemonService:
    """Top-level daemon service — owns the lifecycle of every sub-service."""

    def __init__(self) -> None:

        self._logger = get_logger(__name__)

        self._daemon_config = DaemonConfig.load()
        self._health_monitor = HealthMonitor(self)
        self._mutation_observer = SessionMutationObserver(self)
        self._workspaces: dict[str, WorkspaceService] = {}

        self.proxy = ContainerProxyClient()
        self.events = Broadcaster()

    # Service
    # ----------------------------------------------------------------------------------------------

    async def start(self) -> None:
        """Initialize per-workspace services and start health polling."""

        self._logger.debug("Starting daemon service...")

        await self._sync_state()
        await self._health_monitor.start()
        await self._mutation_observer.start()

        self._logger.info("Daemon service initialized")

    async def stop(self) -> None:
        """Stop health polling, close clients, and persist workspace state."""

        self._logger.debug("Stopping daemon service...")

        await self._mutation_observer.stop()
        await self._health_monitor.stop()
        await self.proxy.close()

        for workspace in self._workspaces.values():
            await workspace.stop()

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
        """Register a workspace; idempotent — re-register returns the existing entry.

        Newly-registered workspaces are eagerly loaded into the in-memory map so they
        are reachable via `get_workspace` without a subsequent sync.
        """

        workspace = self._daemon_config.register_workspace(path)
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
        """Remove a workspace from config and evict it from the in-memory map.

        Raises WorkspaceNotRegistered if the workspace is not in config.
        """

        if not self._daemon_config.deregister_workspace(workspace_id):
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
                }
            )

        return entries

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
        """Load a registered workspace into the daemon runtime.

        Raises WorkspaceNotRegistered if workspace_id is not in the daemon config.
        """

        workspace = self._daemon_config.get_workspace(workspace_id)

        svc = WorkspaceService(workspace, self.events, self.proxy)
        await svc.start()

        self._workspaces[workspace_id] = svc
        return svc
