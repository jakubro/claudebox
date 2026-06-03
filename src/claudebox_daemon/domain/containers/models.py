"""Container data models: status enum, tracked instance, and events."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

from claudebox import DataClass


class ContainerStatus(StrEnum):
    """Container lifecycle states."""

    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    CRASHED = "crashed"
    STOPPED = "stopped"
    UNKNOWN = "unknown"


@dataclass
class Container(DataClass):
    """Tracked container instance.

    Attributes:
        id: Stable auto-generated UUID. Primary key, podman container name, label value.
        backend_id: Container runtime ID from podman/docker.
        port: Host port mapped to the container's web port.
        status: Lifecycle state.
        created_at: Timestamp when the container was registered.
        failure_count: Consecutive health check failures.
        labels: Caller-defined metadata (e.g. instance_id, channel_id).
        session_id: Session ID currently served by this container.
    """

    id: str
    backend_id: str
    port: int
    status: ContainerStatus = ContainerStatus.STARTING
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    failure_count: int = 0
    labels: dict[str, str] = field(default_factory=dict)
    session_id: str | None = None

    @property
    def base_url(self) -> str:
        """HTTP base URL for the container (without /api suffix)."""

        return f"http://localhost:{self.port}"


@dataclass
class ContainerStatusEvent(DataClass):
    """Container lifecycle status change broadcast via SSE."""

    container_id: str
    workspace_id: str
    status: ContainerStatus
    type: str = "container_status"
