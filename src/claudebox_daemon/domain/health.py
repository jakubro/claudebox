"""Background health monitoring for daemon-managed containers."""

import logging
from typing import TYPE_CHECKING

from httpx import Response

from claudebox import AsyncPoller, get_logger
from .containers import Container, ContainerStatus
from .workspaces import WorkspaceService
from ..constants import (
    CONTAINER_HEALTH_MAX_FAILURES,
    CONTAINER_HEALTH_MONITOR_INTERVAL,
)


if TYPE_CHECKING:
    from .service import DaemonService


class HealthMonitor(AsyncPoller):
    """Poll container health endpoints and update registry status.

    Iterates all workspace registries, pinging each container's /health endpoint
    every CONTAINER_HEALTH_MONITOR_INTERVAL seconds. Tracks consecutive failures
    and transitions containers to "crashed" after CONTAINER_HEALTH_MAX_FAILURES
    consecutive failures. Uses the daemon's shared proxy client for HTTP requests.

    Attributes:
        _service: Daemon service providing access to workspaces and proxy client.
    """

    def __init__(self, service: "DaemonService") -> None:
        super().__init__(
            interval=CONTAINER_HEALTH_MONITOR_INTERVAL.total_seconds(),
            name="Health monitor",
        )

        self._probe_logger = get_logger(__name__)
        self._service = service

    # Polling
    # ----------------------------------------------------------------------------------------------

    async def _poll(self) -> None:
        """Probe all containers across all workspaces."""

        for svc in await self._service.list_workspaces(sync=False):
            if not svc.workspace.available:
                continue

            await svc.container_service.sync_state()

            for container in svc.container_service.list_all():
                await self._probe_container(svc, container)

    async def _probe_container(self, svc: WorkspaceService, container: Container) -> None:
        """Probe a single container and transition to CRASHED after max consecutive failures."""

        if container.status not in (ContainerStatus.STARTING, ContainerStatus.RUNNING):
            return

        if container.port <= 0:
            return

        response: Response | None = None

        try:
            response = await self._service.proxy.send(
                payload=None,
                container=container,
                endpoint="api/health",
                method="GET",
                raw=True,
            )
            response.raise_for_status()
        except Exception as exc:
            container.failure_count += 1
            crashed = container.failure_count >= CONTAINER_HEALTH_MAX_FAILURES

            self._probe_logger.log(
                logging.WARN if crashed else logging.DEBUG,
                "Container health check failed",
                workspace={"id": svc.workspace.id, "path": svc.workspace.path},
                container={"id": container.id, "failures": container.failure_count},
                error={"type": type(exc), "message": str(exc)},
                response=response and {"status": response.status_code, "data": response.text},
            )

            if crashed:
                await svc.container_service.update(container, status=ContainerStatus.CRASHED)
        else:
            container.failure_count = 0
            update_kwargs = {"status": ContainerStatus.RUNNING}

            data = response.json()

            if session_id := data.get("session_id"):
                update_kwargs["session_id"] = session_id

            await svc.container_service.update(container, **update_kwargs)
