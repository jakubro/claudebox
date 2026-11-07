"""Container runtime facade - build, run, and backend delegation."""

from __future__ import annotations

import contextlib
import threading
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from .backend import ContainerBackend
from .build import build_image
from .run import get_container_run_args, run_container, substitute_held_ports, tmp_mount_conflicts
from ..config import Config
from ..core.logging import get_logger
from ..core.ports import parse_ports
from ..temp import TmpRemapBlocked


if TYPE_CHECKING:
    from .models import ImageBuildMode


# Probe and run share one lock per process, or two spawns both see a fixed host port free.
_FIXED_PORT_LOCK = threading.Lock()


class ContainerRuntime:
    """High-level interface to container build and run operations.

    Wraps ContainerBackend (podman/docker) and provides a unified API that matches ContainerRuntimeProtocol.
    """

    def __init__(self, config: Config | None = None, *, verbose: bool = False):
        self.config = config or Config.load()
        self.verbose = verbose
        self._backend = ContainerBackend(self.config.backend, verbose=verbose)

    def build(self, mode: ImageBuildMode | None = None) -> None:
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
        """Build run args and spawn a container; ``config`` overrides the captured config.
        A config mounting anything at or under /tmp is refused: the session would delete it."""

        config = config or self.config

        if conflicts := tmp_mount_conflicts(config):
            raise TmpRemapBlocked(paths=",".join(map(str, conflicts)), reason="mounted")

        fixed_ports = any(parse_ports(config.ports) or {})

        with _FIXED_PORT_LOCK if fixed_ports else contextlib.nullcontext():
            substitutes = substitute_held_ports(config.ports) if fixed_ports else {}

            for held, free in substitutes.items():
                get_logger(__name__).warning(
                    "Fixed host port in use; published on a free one",
                    host_port=held,
                    substitute_port=free,
                    container=name,
                )

            args = get_container_run_args(
                config,
                verbose=self.verbose,
                name=name,
                labels=labels,
                env=env,
                network=network,
                publish_all=publish_all,
                extra_volumes=extra_volumes,
                port_substitutes=substitutes,
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

    def identify_container_from_pid(self, pid: int, candidate_ids: list[str]) -> str | None:
        """Return whichever `candidate_ids` entry the given host pid is running inside, or None."""

        return self._backend.identify_container_from_pid(pid, candidate_ids)
