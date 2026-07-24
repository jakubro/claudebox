"""Container runtime protocol - interface for runtime implementations."""

from pathlib import Path
from typing import TYPE_CHECKING, Iterable, Protocol


if TYPE_CHECKING:
    from .models import ImageBuildMode
    from ..config import Config


class ContainerRuntimeProtocol(Protocol):
    """Interface that all container runtime implementations must satisfy.

    Implemented by ContainerRuntime (podman/docker) and LocalRuntime (subprocess).
    """

    def build(self, mode: "ImageBuildMode | None" = None) -> None:
        """Build the container image."""

        ...

    def run(self, args: Iterable = (), *, kind: str = "agent") -> int:
        """Run a container interactively; return its exit code."""

        ...

    def run_container(
        self,
        *,
        name: str,
        labels: dict[str, str],
        env: dict[str, str],
        network: str | None = None,
        publish_all: bool = False,
        extra_volumes: list[tuple[str | Path, str | Path, bool]] | None = None,
        run_args: Iterable = (),
        cmd_args: Iterable = (),
        detach: bool = False,
        config: "Config | None" = None,
    ) -> str | None:
        """Spawn a container, returning backend ID if detached.

        ``config`` overrides the runtime's captured config for this launch so
        run args reflect the current workspace settings.
        """

        ...

    def get_host_port(self, backend_id: str, container_port: int) -> int:
        """Get the host port mapped to a container port."""

        ...

    def list_containers(self, labels: dict[str, str] | None = None) -> list[dict]:
        """List containers matching optional label filters."""

        ...

    def stop_container(self, backend_id: str, *, grace_seconds: int) -> None:
        """Send SIGTERM and wait up to ``grace_seconds`` before escalating to SIGKILL."""

        ...

    def kill_container(self, backend_id: str) -> None:
        """Send SIGKILL immediately."""

        ...

    def remove_container(self, backend_id: str) -> None:
        """Force-remove a container by backend ID."""

        ...

    def create_network(self, name: str) -> None:
        """Create a container network idempotently."""

        ...
