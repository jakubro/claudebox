"""A stand-in for podman's port and network semantics, enough to spawn and inspect a container."""

from __future__ import annotations

import json
import subprocess
from contextlib import contextmanager
from unittest.mock import patch


class FakePodman:
    """Holds a table of bound host ports; refuses a run whose fixed host port is held, drops publishes
    under host and none, and answers `inspect` with the mapping it made."""

    _NO_PUBLISH = ("host", "none")

    def __init__(self):
        self.held: set[int] = set()
        self.containers: dict[str, dict] = {}
        self.bound: dict[str, set[int]] = {}
        self.runs: list[list[str]] = []
        self._next_free = 40000

    def free_port(self) -> int:
        self._next_free += 1

        return self._next_free

    def __call__(self, argv, **kwargs):
        verb, args = argv[1], argv[2:]

        if verb == "run":
            return self._run(args)

        if verb == "inspect":
            data = [{"NetworkSettings": {"Ports": self.containers[args[0]]}}]

            return subprocess.CompletedProcess(argv, 0, json.dumps(data).encode(), b"")

        if verb == "rm":
            for cid in args:
                self.held -= self.bound.pop(cid, set())

        return subprocess.CompletedProcess(argv, 0, b"", b"")

    def _run(self, args):
        self.runs.append(list(args))
        pubs = [args[i + 1] for i, a in enumerate(args) if a == "--publish"]
        nets = [args[i + 1] for i, a in enumerate(args) if a == "--network"]

        if nets and nets[0] in self._NO_PUBLISH:
            pubs = []

        mapped, wanted = {}, []

        for spec in pubs:
            host, container = spec.rsplit(":", 1)
            host_port = host.split(":")[-1]

            if host_port and host_port != "0":
                if int(host_port) in self.held:
                    err = f"listen tcp 0.0.0.0:{host_port}: bind: address already in use"

                    return subprocess.CompletedProcess(["podman"], 126, b"", err.encode())

                wanted.append(int(host_port))
                port = int(host_port)
            else:
                port = self.free_port()

            mapped[f"{container}/tcp"] = [{"HostIp": "", "HostPort": str(port)}]

        self.held.update(wanted)
        cid = f"backend-{len(self.containers) + 1}"
        self.containers[cid] = mapped
        self.bound[cid] = set(wanted)

        return subprocess.CompletedProcess(["podman"], 0, cid.encode(), b"")


def publishes(run: list[str]) -> list[str]:
    return [run[i + 1] for i, a in enumerate(run) if a == "--publish"]


@contextmanager
def on_fake_podman(podman: FakePodman):
    """Route podman calls and the host-port probes through `podman`'s table."""

    with (
        patch("claudebox.containers.backend.subprocess.run", podman),
        patch(
            "claudebox.containers.run._port_in_use",
            lambda port, _mapping: port in podman.held,
            create=True,
        ),
        patch(
            "claudebox.containers.run._free_port",
            lambda _mapping: podman.free_port(),
            create=True,
        ),
    ):
        yield
