"""Container runtime abstraction for podman and docker backends."""

import json
import os
import subprocess
import time
from typing import Literal

from ..constants import DEFAULT_LABELS, PODMAN_COMMAND_TIMEOUT, PODMAN_RUN_TIMEOUT
from ..core.cli import print_command
from ..core.logging import get_logger


class ContainerBackend:
    """Podman/docker subprocess wrapper."""

    def __init__(self, name: str, *, verbose: bool = False):
        self.name = name
        self.verbose = verbose
        self._logger = get_logger(__name__)

    # Image Operations
    # ----------------------------------------------------------------------------------------------

    def build_image(self, *args) -> None:
        # Unbounded: a build/pull can run for minutes; CLI-only, never daemon-dispatched.
        self._exec("build", *args, check=True)

    # Container Lifecycle
    # ----------------------------------------------------------------------------------------------

    def run_container(self, *args, detach: bool = False) -> int | str:
        """Run a container, returning container ID if detached, exit code otherwise."""

        if not detach:
            # Unbounded: this is the interactive foreground agent session.
            result = self._exec("run", "--rm", *args)

            return result.returncode  # ty: ignore[unresolved-attribute]
        else:
            result = self._exec(
                "run",
                "--detach",
                *args,
                capture_output=True,
                timeout=PODMAN_RUN_TIMEOUT.total_seconds(),
            )
            container_id = result.stdout.decode().strip()  # ty: ignore[unresolved-attribute]

            try:
                result.check_returncode()  # ty: ignore[unresolved-attribute]
            except subprocess.CalledProcessError:
                try:
                    self.print_container_logs(container_id)
                finally:
                    self.remove_container(container_id)

                raise

            return container_id

    def create_network(self, name: str) -> None:
        """Create a container network idempotently."""

        self._exec(
            "network",
            "create",
            "--ignore",
            name,
            check=True,
            capture_output=True,
            timeout=PODMAN_COMMAND_TIMEOUT.total_seconds(),
        )

    def stop(self, container_id: str, *, timeout: int) -> int:
        """Send SIGTERM, then SIGKILL after ``timeout`` seconds."""

        result = self._exec(
            "stop",
            "--time",
            str(timeout),
            container_id,
            check=True,
            # Exceeds podman's own --time grace period so its SIGKILL escalation can finish first.
            timeout=timeout + PODMAN_COMMAND_TIMEOUT.total_seconds(),
        )

        return result.returncode  # ty: ignore[unresolved-attribute]

    def kill(self, container_id: str) -> int:
        """Send SIGKILL to the container immediately."""

        result = self._exec(
            "kill",
            "--signal",
            "KILL",
            container_id,
            check=True,
            timeout=PODMAN_COMMAND_TIMEOUT.total_seconds(),
        )

        return result.returncode  # ty: ignore[unresolved-attribute]

    def remove_container(self, container_id: str) -> None:
        """Force-remove a container by ID."""

        self._exec(
            "rm",
            "--force",
            container_id,
            check=True,
            timeout=PODMAN_COMMAND_TIMEOUT.total_seconds(),
        )

    def print_container_logs(self, container_id: str) -> None:
        self._exec(
            "logs",
            container_id,
            check=True,
            timeout=PODMAN_COMMAND_TIMEOUT.total_seconds(),
        )

    # Inspection
    # ----------------------------------------------------------------------------------------------

    def inspect_container(self, container_id: str) -> dict:
        result = self._exec(
            "inspect",
            container_id,
            capture_output=True,
            check=True,
            timeout=PODMAN_COMMAND_TIMEOUT.total_seconds(),
        )

        return json.loads(result.stdout.decode())  # ty: ignore[unresolved-attribute]

    def get_host_port(
        self,
        container_id: str,
        container_port: int,
        protocol: Literal["tcp", "udp"] = "tcp",
    ) -> int:
        """Get the host port mapped to a container port."""

        data = self.inspect_container(container_id)
        port_key = f"{container_port}/{protocol}"
        host_port = data[0]["NetworkSettings"]["Ports"][port_key][0]["HostPort"]

        return int(host_port)

    def list_containers(self, labels: dict[str, str] | None = None) -> list[dict]:
        """List containers matching a label filter."""

        labels = labels or {}
        labels = {**labels, **DEFAULT_LABELS}

        args = ["ps", "--all", "--format", "json"]

        for key, val in labels.items():
            args += ["--filter", f"label={key}={val}"]

        result = self._exec(
            *args,
            capture_output=True,
            check=True,
            timeout=PODMAN_COMMAND_TIMEOUT.total_seconds(),
        )
        output = result.stdout.decode().strip()  # ty: ignore[unresolved-attribute]

        if not output:
            return []

        return json.loads(output)

    def _exec(
        self,
        *args,
        replace: bool = False,
        timeout: float | None = None,
        **kwargs,
    ) -> subprocess.CompletedProcess | None:
        """Execute a backend command, optionally replacing the current process.

        ``timeout`` bounds the subprocess itself, distinct from any ``--time`` flag passed in ``args``.
        """

        if self.verbose:
            print_command(self.name, *args)

        if replace:
            os.execvp(self.name, [self.name, *args])
        else:
            if timeout is not None:
                kwargs["timeout"] = timeout

            started = time.monotonic()

            try:
                return subprocess.run([self.name, *args], **kwargs)
            except subprocess.TimeoutExpired:
                self._logger.warning(
                    "podman_command_timed_out",
                    argv=[self.name, *args],
                    timeout=timeout,
                    duration_s=round(time.monotonic() - started, 2),
                )

                raise
