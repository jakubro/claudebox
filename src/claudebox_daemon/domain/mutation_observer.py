"""Background session mutation observer - detect in-session content changes."""

from __future__ import annotations

from typing import TYPE_CHECKING

from claudebox import AsyncPoller
from .containers import Container, ContainerStatus
from ..constants import SESSION_MUTATION_POLL_INTERVAL


if TYPE_CHECKING:
    from .service import DaemonService


class SessionMutationObserver(AsyncPoller):
    """Poll active containers for session changes and broadcast sessions_changed events.

    Attributes:
        _session_cache: Last-seen updated_at per container and live member session.
    """

    def __init__(self, service: DaemonService) -> None:
        super().__init__(
            interval=SESSION_MUTATION_POLL_INTERVAL.total_seconds(),
            name="Session mutation observer",
        )

        self._service = service
        self._session_cache: dict[tuple[str, str | None], str] = {}

    # Polling
    # ----------------------------------------------------------------------------------------------

    async def _poll(self) -> None:
        """Check all containers for session metadata changes - one workspace's failure is
        contained here so it never stops the poll from reaching the workspaces ordered after it.
        """

        for svc in await self._service.list_workspaces(sync=False):
            if not svc.available:
                continue

            try:
                changed_ids = []

                for container in svc.container_service.list_all():
                    if await self._check_container(container):
                        changed_ids.append(container.id)

                if changed_ids and svc.session_service:
                    await svc.session_service._broadcast_sessions_changed(
                        container_id=changed_ids[0],
                    )
            except Exception:
                self._logger.exception(
                    "Session mutation poll failed for workspace",
                    workspace={"id": svc.workspace.id, "path": svc.workspace.path},
                )

    async def _check_container(self, container: Container) -> bool:
        """Poll a container's session metadata; returns True if changed, False for non-running/errors."""

        if container.status != ContainerStatus.RUNNING or container.port <= 0:
            return False

        members = [sid for sid in container.live_session_ids if sid != container.session_id]
        changed = [await self._check_session(container, sid) for sid in (None, *members)]

        return any(changed)

    async def _check_session(self, container: Container, session_id: str | None) -> bool:
        endpoint = "api/sessions/current"

        if session_id is not None:
            endpoint += f"?session_id={session_id}"

        try:
            response = await self._service.proxy.send(
                payload=None,
                container=container,
                endpoint=endpoint,
                method="GET",
                raw=True,
            )
            response.raise_for_status()
            data = response.json()
        except Exception:  # noqa: BLE001 - any probe failure means "no update", not a crash
            return False

        updated_at = data.get("updated_at")

        if not updated_at:
            return False

        key = (container.id, session_id)
        cached = self._session_cache.get(key)

        if cached == updated_at:
            return False

        self._session_cache[key] = updated_at

        return cached is not None  # First observation is baseline, not a change
