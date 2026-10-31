"""Background health monitoring for daemon-managed containers."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from httpx import Response

from claudebox import AsyncPoller, get_logger
from .containers import Container, ContainerStatus
from .workspaces import WorkspaceService
from ..constants import (
    CONTAINER_HEALTH_MAX_FAILURES,
    CONTAINER_HEALTH_MONITOR_INTERVAL,
    CONTAINER_STARTUP_BUDGET,
)


if TYPE_CHECKING:
    from .service import DaemonService


class HealthMonitor(AsyncPoller):
    """Poll container health endpoints and update registry status."""

    def __init__(self, service: DaemonService) -> None:
        super().__init__(
            interval=CONTAINER_HEALTH_MONITOR_INTERVAL.total_seconds(),
            name="Health monitor",
        )

        self._probe_logger = get_logger(__name__)
        self._service = service

    # Polling
    # ----------------------------------------------------------------------------------------------

    async def probe_once(self) -> None:
        """Run one poll bounded by the monitor interval, so owners match what containers report."""

        try:
            await asyncio.wait_for(self._poll(), CONTAINER_HEALTH_MONITOR_INTERVAL.total_seconds())
        except TimeoutError:
            self._probe_logger.warning("Startup health pass timed out; the monitor continues it")

    async def _poll(self) -> None:
        """Probe all containers across all workspaces - one workspace's failure is contained here
        so it never stops the poll from reaching the workspaces ordered after it.
        """

        for svc in await self._service.list_workspaces(sync=False):
            if not svc.available:
                continue

            try:
                await svc.container_service.sync_state()

                for container in svc.container_service.list_all():
                    await self._probe_container(svc, container)
            except Exception:
                self._probe_logger.exception(
                    "Health poll failed for workspace",
                    workspace={"id": svc.workspace.id, "path": svc.workspace.path},
                )

    async def _probe_container(self, svc: WorkspaceService, container: Container) -> None:
        """Probe a single container and transition to CRASHED after max consecutive failures.

        CRASHED is probed too, so a container whose API comes back returns to RUNNING on its own.
        """

        probed = (ContainerStatus.STARTING, ContainerStatus.RUNNING, ContainerStatus.CRASHED)

        # A stopped container left with no owner has nothing to answer; the reap decides the rest.
        if container.status == ContainerStatus.STOPPED:
            await svc.container_service.reap_orphan(container.id)

            return

        if container.status not in probed:
            return

        if container.port <= 0:
            return

        # A verdict computed before a stop or remove landed describes a container that is gone.
        status_before = container.status
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
        except Exception as exc:  # noqa: BLE001 - the probe's job is catching any failure mode
            if container.status != status_before:
                return

            container.failure_count += 1
            crashed = container.failure_count >= CONTAINER_HEALTH_MAX_FAILURES and _past_startup(
                container,
            )

            self._probe_logger.log(
                logging.WARNING if crashed else logging.DEBUG,
                "Container health check failed",
                workspace={"id": svc.workspace.id, "path": svc.workspace.path},
                container={"id": container.id, "failures": container.failure_count},
                error={"type": type(exc), "message": str(exc)},
                response=response and {"status": response.status_code, "data": response.text},
            )

            if crashed:
                # A dead member shown as live is the failure that matters - clear the live set
                # along with the status transition rather than leaving it at its last poll.
                await svc.container_service.update(
                    container,
                    status=ContainerStatus.CRASHED,
                    live_session_ids=[],
                )
        else:
            if container.status != status_before:
                return

            container.failure_count = 0
            update_kwargs = {"status": ContainerStatus.RUNNING}

            data = response.json()
            live = data.get("live_session_ids", [])

            if session_id := data.get("session_id"):
                update_kwargs["session_id"] = session_id

            update_kwargs["live_session_ids"] = live

            # A container adopted with no registry entry lost its members; its first answer has them.
            if svc.container_service.consume_fresh_adoption(container.id):
                primary = session_id or container.session_id
                update_kwargs["members"] = [sid for sid in live if sid != primary]

            await svc.container_service.update(container, **update_kwargs)

            # Decided from this answer, never the cached live set: an adopted entry's cache is empty.
            if not (session_id or live):
                await svc.container_service.reap_orphan(container.id)


def _past_startup(container: Container) -> bool:
    """Whether the container has had its full startup budget to answer for the first time."""

    return datetime.now(UTC) - container.created_at > CONTAINER_STARTUP_BUDGET
