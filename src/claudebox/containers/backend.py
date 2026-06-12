"""Container runtime abstraction for podman and docker backends."""

import json
import os
import subprocess
from typing import Literal

from ..constants import DEFAULT_LABELS
from ..core.cli import print_command


class ContainerBackend:
    """Podman/docker subprocess wrapper."""

    def __init__(self, name: str, *, verbose: bool = False):
        self.name = name
        self.verbose = verbose

    # Image Operations
    # ----------------------------------------------------------------------------------------------

    def build_image(self, *args) -> None:
        self._exec("build", *args, check=True)

    # Container Lifecycle
    # ----------------------------------------------------------------------------------------------

    def run_container(self, *args, detach: bool = False) -> int | str:
        """Run a container, returning container ID if detached, exit code otherwise.

        On detached failure, logs container output and removes the container
        before re-raising CalledProcessError.
        """

        if not detach:
            result = self._exec("run", "--rm", *args)

            return result.returncode  # ty: ignore[unresolved-attribute]
        else:
            result = self._exec("run", "--detach", *args, capture_output=True)
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

        self._exec("network", "create", "--ignore", name, check=True, capture_output=True)

    def stop(self, container_id: str, *, timeout: int) -> int:
        """Send SIGTERM, then SIGKILL after ``timeout`` seconds."""

        result = self._exec("stop", "--time", str(timeout), container_id, check=True)

        return result.returncode  # ty: ignore[unresolved-attribute]

    def kill(self, container_id: str) -> int:
        """Send SIGKILL to the container immediately."""

        result = self._exec("kill", "--signal", "KILL", container_id, check=True)

        return result.returncode  # ty: ignore[unresolved-attribute]

    def remove_container(self, container_id: str) -> None:
        """Force-remove a container by ID."""

        self._exec("rm", "--force", container_id, check=True)

    def print_container_logs(self, container_id: str) -> None:
        self._exec("logs", container_id, check=True)

    # Inspection
    # ----------------------------------------------------------------------------------------------

    def inspect_container(self, container_id: str) -> dict:
        result = self._exec("inspect", container_id, capture_output=True, check=True)

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

        result = self._exec(*args, capture_output=True, check=True)
        output = result.stdout.decode().strip()  # ty: ignore[unresolved-attribute]

        if not output:
            return []

        return json.loads(output)

    def _exec(self, *args, replace: bool = False, **kwargs) -> subprocess.CompletedProcess | None:
        """Execute a backend command, optionally replacing current process."""

        if self.verbose:
            print_command(self.name, *args)

        if replace:
            os.execvp(self.name, [self.name, *args])
        else:
            return subprocess.run([self.name, *args], **kwargs)
