"""Container runtime facade - build, run, and backend delegation."""

from pathlib import Path
from typing import TYPE_CHECKING, Iterable

from .backend import ContainerBackend
from .build import build_image
from .run import get_container_run_args, run_container
from ..config import Config


if TYPE_CHECKING:
    from .models import ImageBuildMode


class ContainerRuntime:
    """High-level interface to container build and run operations.

    Wraps ContainerBackend (podman/docker) and provides a unified API
    that matches ContainerRuntimeProtocol.
    """

    def __init__(self, config: Config | None = None, *, verbose: bool = False):
        self.config = config or Config.load()
        self.verbose = verbose
        self._backend = ContainerBackend(self.config.backend, verbose=verbose)

    def build(self, mode: "ImageBuildMode | None" = None) -> None:
        """Build the container image."""

        build_image(mode, config=self.config, backend=self._backend)

    def run(self, args: Iterable = (), *, kind: str = "agent") -> int:
        """Run a container interactively; return its exit code.

        ``kind`` labels the container (``agent`` for sessions, ``shell`` for bash).
        """

        return run_container(
            args,
            config=self.config,
            backend=self._backend,
            verbose=self.verbose,
            kind=kind,
        )

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
        config: Config | None = None,
    ) -> str | None:
        """Build run args and spawn a container; ``config`` overrides the runtime config for this launch."""

        args = get_container_run_args(
            config or self.config,
            verbose=self.verbose,
            name=name,
            labels=labels,
            env=env,
            network=network,
            publish_all=publish_all,
            extra_volumes=extra_volumes,
            run_args=run_args,
            cmd_args=cmd_args,
        )

        return self._backend.run_container(*args, detach=detach)  # ty: ignore[invalid-return-type]

    def get_host_port(self, backend_id: str, container_port: int) -> int:
        """Get the host port mapped to a container port."""

        return self._backend.get_host_port(backend_id, container_port)

    def list_containers(self, labels: dict[str, str] | None = None) -> list[dict]:
        """List containers matching optional label filters."""

        return self._backend.list_containers(labels)

    def stop_container(self, backend_id: str, *, grace_seconds: int) -> None:
        """Send SIGTERM and wait up to ``grace_seconds`` before escalating to SIGKILL."""

        self._backend.stop(backend_id, timeout=grace_seconds)

    def kill_container(self, backend_id: str) -> None:
        """Send SIGKILL immediately."""

        self._backend.kill(backend_id)

    def remove_container(self, backend_id: str) -> None:
        """Force-remove a container by backend ID."""

        self._backend.remove_container(backend_id)

    def create_network(self, name: str) -> None:
        """Create a container network idempotently."""

        self._backend.create_network(name)
