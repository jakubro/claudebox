"""Local container runtime — subprocess-based, no podman/docker required."""

import os
import signal as _signal
import socket
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Iterable

from ..core.logging import get_logger


if TYPE_CHECKING:
    from .models import ImageBuildMode


@dataclass
class _Process:
    """Tracked subprocess entry in the local runtime registry."""

    process: subprocess.Popen
    port: int
    labels: dict[str, str] = field(default_factory=dict)
    name: str = ""


class LocalRuntime:
    """Run the container API as a local subprocess; same interface as ContainerRuntime."""

    def __init__(self, config=None, *, verbose: bool = False):
        self.config = config
        self.verbose = verbose
        self._registry: dict[str, _Process] = {}
        self._logger = get_logger(__name__)

        # Set env var so ensure_tmp() is suppressed in this process and any
        # child that inherits os.environ (hook callbacks run in-process via
        # the SDK control channel, so they see this directly)
        os.environ["CLAUDEBOX_NO_TMP_REMAP"] = "1"

    def build(self, mode: "ImageBuildMode | None" = None) -> None:
        """No-op — local runtime has no image to build."""

    def run(self, args: Iterable = (), *, kind: str = "agent") -> int:
        """Not supported — use run_container with detach=True."""

        raise NotImplementedError("LocalRuntime does not support interactive run")

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
    ) -> str | None:
        """Spawn container_api_server.py as a subprocess on a free port."""

        port = self._find_free_port()
        backend_id = str(uuid.uuid4())

        server_script = Path(__file__).resolve().parents[2] / "container_api_server.py"

        proc_env = {**os.environ, **env}
        # Remove container API args that belong to the host daemon
        proc_env.pop("CLAUDEBOX_CONTAINER_API_ARGS", None)
        # Prevent subcontainer from remapping /tmp — it shares the host filesystem
        proc_env["CLAUDEBOX_NO_TMP_REMAP"] = "1"

        proc = subprocess.Popen(
            [sys.executable, str(server_script), "--port", str(port)],
            env=proc_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )

        self._registry[backend_id] = _Process(
            process=proc,
            port=port,
            labels=labels,
            name=name,
        )

        self._logger.info(
            "Started local container",
            backend_id=backend_id,
            port=port,
            pid=proc.pid,
        )

        return backend_id if detach else None

    def get_host_port(self, backend_id: str, container_port: int) -> int:
        """Return the port assigned during run_container."""

        entry = self._registry.get(backend_id)
        if not entry:
            raise KeyError(f"Unknown backend_id: {backend_id}")
        return entry.port

    def list_containers(self, labels: dict[str, str] | None = None) -> list[dict]:
        """Return in-memory registry as synthetic podman-format dicts."""

        result = []
        for backend_id, entry in self._registry.items():
            # Check if process is still alive
            if entry.process.poll() is not None:
                continue

            if labels:
                if not all(entry.labels.get(k) == v for k, v in labels.items()):
                    continue

            result.append(
                {
                    "Id": backend_id,
                    "Names": [entry.name],
                    "State": "running",
                    "Labels": entry.labels,
                }
            )

        return result

    def stop_container(self, backend_id: str, *, grace_seconds: int) -> None:
        """Send SIGTERM and wait up to ``grace_seconds`` before escalating to SIGKILL."""

        entry = self._registry.get(backend_id)
        if not entry or entry.process.poll() is not None:
            return

        proc = entry.process
        self._logger.info(
            "Stopping local container",
            backend_id=backend_id,
            pid=proc.pid,
        )

        try:
            os.killpg(proc.pid, _signal.SIGTERM)
            try:
                proc.wait(timeout=grace_seconds)
            except subprocess.TimeoutExpired:
                self._logger.warning(
                    "SIGTERM timeout, sending SIGKILL",
                    backend_id=backend_id,
                )
                os.killpg(proc.pid, _signal.SIGKILL)
                proc.wait(timeout=5)
        except ProcessLookupError:
            pass

    def kill_container(self, backend_id: str) -> None:
        """Send SIGKILL to the tracked process group immediately."""

        entry = self._registry.get(backend_id)
        if not entry or entry.process.poll() is not None:
            return

        proc = entry.process
        self._logger.info("Killing local container", backend_id=backend_id, pid=proc.pid)
        try:
            os.killpg(proc.pid, _signal.SIGKILL)
            proc.wait(timeout=5)
        except ProcessLookupError:
            pass

    def remove_container(self, backend_id: str) -> None:
        """SIGTERM with a 5s grace, then SIGKILL; drop the registry entry."""

        entry = self._registry.pop(backend_id, None)
        if not entry:
            return

        proc = entry.process
        if proc.poll() is not None:
            return

        self._logger.info("Removing local container", backend_id=backend_id, pid=proc.pid)

        try:
            os.killpg(proc.pid, _signal.SIGTERM)
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._logger.warning("SIGTERM timeout, sending SIGKILL", backend_id=backend_id)
            os.killpg(proc.pid, _signal.SIGKILL)
            proc.wait(timeout=5)
        except ProcessLookupError:
            pass

    def create_network(self, name: str) -> None:
        """No-op — local processes share the host network."""

    @staticmethod
    def _find_free_port() -> int:
        """Find an available TCP port by binding to port 0."""

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            return s.getsockname()[1]
