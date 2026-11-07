"""The sandboxing each shipped systemd unit sets: the watchdog all it can, the two that run podman none."""

from __future__ import annotations

from pathlib import Path

import pytest


UNITS = Path(__file__).resolve().parents[2] / "etc" / "systemd"

PODMAN_UNSAFE = (
    "NoNewPrivileges",
    "PrivateTmp",
    "PrivateUsers",
    "PrivateDevices",
    "PrivateMounts",
    "ProtectSystem",
    "ProtectHome",
    "ProtectProc",
    "ProcSubset",
    "ProtectKernelTunables",
    "ProtectKernelModules",
    "ProtectKernelLogs",
    "ProtectControlGroups",
    "ProtectClock",
    "ProtectHostname",
    "ReadOnlyPaths",
    "ReadWritePaths",
    "InaccessiblePaths",
    "TemporaryFileSystem",
    "BindPaths",
    "BindReadOnlyPaths",
    "SystemCallFilter",
    "SystemCallArchitectures",
    "RestrictAddressFamilies",
    "RestrictNamespaces",
    "RestrictRealtime",
    "RestrictSUIDSGID",
    "MemoryDenyWriteExecute",
    "LockPersonality",
    "CapabilityBoundingSet",
    "AmbientCapabilities",
)


def _service_keys(unit: str) -> dict[str, list[str]]:
    keys: dict[str, list[str]] = {}
    section = ""

    for line in (UNITS / unit).read_text(encoding="utf-8").splitlines():
        line = line.strip()

        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
        elif section == "Service" and "=" in line and not line.startswith("#"):
            key, value = line.split("=", 1)
            keys.setdefault(key.strip(), []).append(value.strip())

    return keys


def test_the_watchdog_runs_sandboxed():
    keys = _service_keys("claudebox-watchdog.service")

    assert {
        k: keys.get(k) for k in ("NoNewPrivileges", "PrivateTmp", "ProtectSystem", "ProtectHome")
    } == {
        "NoNewPrivileges": ["yes"],
        "PrivateTmp": ["yes"],
        "ProtectSystem": ["strict"],
        "ProtectHome": ["read-only"],
    }


@pytest.mark.parametrize("unit", ["claudebox-daemon.service", "claudebox-maintenance.service"])
def test_a_unit_that_runs_podman_sets_no_sandboxing(unit):
    keys = _service_keys(unit)
    present = [option for option in PODMAN_UNSAFE if option in keys]

    assert present == [], (
        f"{unit} sets {present}; read ARCHITECTURE.md section 6.6 (Sandboxing) first - each breaks rootless podman "
        "or reaches every container the unit starts"
    )


def test_the_daemon_keeps_the_lines_its_containers_rely_on():
    keys = _service_keys("claudebox-daemon.service")

    assert (keys.get("KillMode"), keys.get("Delegate")) == (["process"], ["yes"])
