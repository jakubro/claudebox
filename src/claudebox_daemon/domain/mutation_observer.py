"""Background session mutation observer - detect in-session content changes."""

from typing import TYPE_CHECKING

from claudebox import AsyncPoller
from .containers import Container, ContainerStatus
from ..constants import SESSION_MUTATION_POLL_INTERVAL


if TYPE_CHECKING:
    from .service import DaemonService


class SessionMutationObserver(AsyncPoller):
    """Poll active containers for session metadata changes and broadcast updates.

    Iterates all workspace registries, checking each container's session
    updated_at timestamp. When a change is detected, emits a sessions_changed
    event so frontends refresh. Uses the daemon's shared proxy client for HTTP requests.

    Attributes:
        _service: Daemon service providing access to workspaces and proxy client.
        _session_cache: Last-seen updated_at per container for change detection.
    """

    def __init__(self, service: "DaemonService") -> None:
        super().__init__(
            interval=SESSION_MUTATION_POLL_INTERVAL.total_seconds(),
            name="Session mutation observer",
        )

        self._service = service
        self._session_cache: dict[str, str] = {}

    # Polling
    # ----------------------------------------------------------------------------------------------

    async def _poll(self) -> None:
        """Check all containers for session metadata changes."""

        for svc in await self._service.list_workspaces(sync=False):
            if not svc.workspace.available:
                continue

            changed_ids = []

            for container in svc.container_service.list_all():
                if await self._check_container(container):
                    changed_ids.append(container.id)

            if changed_ids and svc.session_service:
                await svc.session_service._broadcast_sessions_changed(
                    container_id=changed_ids[0],
                )

    async def _check_container(self, container: Container) -> bool:
        """Poll a container's session metadata and return True if it changed.

        Calls GET /api/sessions/current and compares updated_at against the
        cached value. Skips non-running containers and silently absorbs errors.
        """

        if container.status != ContainerStatus.RUNNING or container.port <= 0:
            return False

        try:
            response = await self._service.proxy.send(
                payload=None,
                container=container,
                endpoint="api/sessions/current",
                method="GET",
                raw=True,
            )
            response.raise_for_status()
            data = response.json()
        except Exception:
            return False

        updated_at = data.get("updated_at")

        if not updated_at:
            return False

        cached = self._session_cache.get(container.id)

        if cached == updated_at:
            return False

        self._session_cache[container.id] = updated_at

        return cached is not None  # First observation is baseline, not a change
