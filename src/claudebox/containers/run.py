"""Container run orchestration."""

from __future__ import annotations

import errno
import os
import socket
import sys
import uuid
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import TYPE_CHECKING

from .. import temp
from ..constants import (
    CLAUDEBOX_SETTINGS_FILE,
    CONTAINER_CLAUDE_DIR_MOUNT,
    CONTAINER_CLAUDE_JSON_MOUNT,
    CONTAINER_IMAGE_NAME,
    CONTAINER_LIB_MOUNT,
    CONTAINER_NESTED_FUSE_DEVICE,
    CONTAINER_NESTED_GRAPHROOT,
    CONTAINER_NESTED_GRAPHROOT_TMPFS_SIZE,
    CONTAINER_PROFILE_MOUNT,
    CONTAINER_SESSIONS_MOUNT,
    DEFAULT_LABELS,
    HOST_CLAUDE_DIR_SUBPATH,
    HOST_CLAUDE_JSON_SUBPATH,
    LABEL_RUN,
    LIB_ROOT,
    LIB_RUN_DIR,
    SESSIONS_DIR_NAME,
    WEB_CONTAINER_PORT,
)
from ..core.fs import resolve_path, touch_dir, touch_file


if TYPE_CHECKING:
    from .backend import ContainerBackend
    from ..config import Config


_LOGIN_ENV_KEYS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
)


def run_container(
    args: Iterable = (),
    *,
    config: Config,
    backend: ContainerBackend,
    verbose: bool = False,
    kind: str = "agent",
) -> int:
    """Run the claudebox container interactively with TUI; return its exit code.

    Labeled ``kind={kind}`` so ``containers list`` can distinguish agent sessions from shells, and
    with a run id its session's hooks record, so prune can tell that session still runs.
    """

    substitutes = (
        substitute_held_ports(config.ports) if network_mode_publishes(config.network_mode) else {}
    )

    for held, free in substitutes.items():
        container_port = _container_port(config.ports, held)
        print(
            f"claudebox: host port {held} is in use; container port {container_port} "
            f"is published on host port {free} instead",
            file=sys.stderr,
        )

    run_id = uuid.uuid4().hex
    args = get_container_run_args(
        config,
        interactive=True,
        verbose=verbose,
        labels={"kind": kind, LABEL_RUN: run_id},
        env={"CLAUDEBOX_RUN_ID": run_id},
        port_substitutes=substitutes,
        cmd_args=args,
    )

    return backend.run_container(*args)  # ty: ignore[invalid-return-type]


def get_container_run_args(
    config: Config,
    *,
    interactive: bool = False,
    verbose: bool = False,
    name: str | None = None,
    labels: dict[str, str] | None = None,
    network: str | None = None,
    publish_all: bool = False,
    env: dict[str, str] | None = None,
    extra_volumes: list[tuple[str | Path, str | Path, bool]] | None = None,
    port_substitutes: Mapping[int, int] | None = None,
    run_args: Iterable = (),
    cmd_args: Iterable = (),
) -> Iterable:
    """Yield container run arguments from configuration.

    Shared by interactive CLI and daemon-managed containers; config gives defaults, caller picks mode.
    Flags before the image come from dedicated params and ``run_args``; ``cmd_args`` becomes the container CMD.
    A ``[ports]`` host port named in ``port_substitutes`` is published on the port it maps to.
    """

    if interactive:
        yield "--interactive"
        yield "--tty"

    if name:
        yield "--name"
        yield name

    yield "--workdir"
    yield config.work_dir

    yield "--security-opt"
    yield "label=disable"

    yield "--ulimit"
    yield "host"

    yield "--pids-limit"
    yield "-1"

    if config.containers_nested:
        yield "--device"
        yield CONTAINER_NESTED_FUSE_DEVICE

        # Tmpfs-mounts the inner podman graphroot so it never persists past the session.
        yield "--tmpfs"
        yield f"{CONTAINER_NESTED_GRAPHROOT}:size={CONTAINER_NESTED_GRAPHROOT_TMPFS_SIZE}"

    # Labels

    labels = labels or {}
    labels = {**labels, **DEFAULT_LABELS}

    for key, val in labels.items():
        yield "--label"
        yield f"{key}={val}"

    # Environment

    yield "--env"
    yield f"CLAUDEBOX_AGENT={config.agent}"

    if config.bundle:
        yield "--env"
        yield f"CLAUDEBOX_BUNDLE={config.bundle}"

    yield "--env"
    yield f"CLAUDEBOX_VERBOSE={int(verbose)}"

    if env:
        for key, val in env.items():
            yield "--env"
            yield f"{key}={val}"

    if config.env:
        for key, val in config.env.items():
            yield "--env"
            yield f"{key}={val}"

    # Volumes

    for host_path, container_path, read_only in dict.fromkeys(get_volumes(config)):
        yield "--volume"
        yield f"{host_path}:{container_path}:ro" if read_only else f"{host_path}:{container_path}"

    if extra_volumes:
        for src, dst, is_dir in extra_volumes:
            src, dst = prepare_volume(src, dst, is_dir=is_dir)
            yield "--volume"
            yield f"{src}:{dst}"

    # Networking

    if publish_all:
        yield "--publish"
        yield f"127.0.0.1::{WEB_CONTAINER_PORT}"

    if config.ports:
        for host_port, container_port in config.ports.items():
            published = (port_substitutes or {}).get(int(host_port), host_port)
            yield "--publish"
            yield f"{published}:{container_port}"

    effective_network = config.network_mode or network

    if effective_network:
        yield "--network"
        yield effective_network

    # Extra run flags (before image)

    yield from run_args

    # Image

    yield CONTAINER_IMAGE_NAME

    # Container CMD (after image)

    yield from cmd_args


def network_mode_publishes(mode: str | None) -> bool:
    """Whether podman keeps port mappings under `mode`; host, none and joined namespaces drop them."""

    return mode not in ("host", "none") and not (mode or "").startswith(("container:", "ns:"))


def substitute_held_ports(ports: Mapping[int, int] | None) -> dict[int, int]:
    """Map each fixed host port in `ports` that something on this host already holds to a free one."""

    held = [int(port) for port in (ports or {}) if int(port) and _port_in_use(int(port))]

    return {port: _free_port() for port in held}


def tmp_mount_conflicts(config: Config, extra: Iterable[Path] = ()) -> list[Path]:
    """Return the container paths at or under /tmp that would block the /tmp remap."""

    if str((config.env or {}).get("CLAUDEBOX_NO_TMP_REMAP")) == "1":
        return []

    tmp = resolve_path(temp.TMP_PATH)
    targets = [config.work_dir, *(config.mounts or {}).values(), *extra]

    return [
        Path(target)
        for target in targets
        if (resolved := resolve_path(target)) == tmp or tmp in resolved.parents
    ]


def agent_logged_in(config: Config) -> bool | None:
    """Return whether a new session's agent has a login; None when the agent is not Claude."""

    if config.agent != "claude":
        return None
    elif any((config.env or {}).get(key) for key in _LOGIN_ENV_KEYS):
        return True
    else:
        return (_session_claude_dir(config) / ".credentials.json").is_file()


def get_volumes(config: Config) -> Iterable[tuple[str | Path, str | Path, bool]]:
    """Yield (host path, container path, read-only) mount triples from configuration.

    The library carries the code the host itself runs, so a container reads it and never writes it.
    """

    yield (*prepare_volume(config.work_dir, config.work_dir), False)

    # The file configuring the next container is whatever the loader reads for this work_dir,
    # marker or not; the directory bind changes no permission, it just blocks a rename around it.
    settings = config.work_dir / CLAUDEBOX_SETTINGS_FILE

    yield (*prepare_volume(settings.parent, settings.parent), False)
    yield (*prepare_volume(settings, settings, is_dir=False), True)

    # Add mounts from config files
    if config.mounts:
        for src, dst in config.mounts.items():
            yield (*prepare_volume(src, dst), False)

    # Add runtime overlay from claudebox library
    run_overlay_root = LIB_RUN_DIR / "fs"

    for src in run_overlay_root.glob("**/*"):
        if src.is_file():
            dst = Path("/") / src.relative_to(run_overlay_root)
            yield (*prepare_volume(src, dst, is_dir=False), True)

    # Add claudebox runtime library
    yield (*prepare_volume(LIB_ROOT, CONTAINER_LIB_MOUNT), True)

    # Add claudebox profile
    if config.profile:
        yield (*prepare_volume(config.profile, CONTAINER_PROFILE_MOUNT), True)

    # Add claudebox sessions from workspace/home
    yield (*prepare_volume(config.config_dir / SESSIONS_DIR_NAME, CONTAINER_SESSIONS_MOUNT), False)

    # Add claude configs from workspace/home
    if config.agent == "claude":
        yield (
            *prepare_volume(_session_claude_dir(config), CONTAINER_CLAUDE_DIR_MOUNT),
            False,
        )
        # The agent refuses to start on an empty config file, which is not valid JSON.
        yield (
            *prepare_volume(
                config.config_dir / HOST_CLAUDE_JSON_SUBPATH,
                CONTAINER_CLAUDE_JSON_MOUNT,
                is_dir=False,
                content="{}",
            ),
            False,
        )


def prepare_volume(
    src: str | Path,
    dst: str | Path,
    is_dir: bool = True,
    content: str = "",
) -> tuple[Path, Path]:
    """Resolve paths and create source directory or file if missing before mounting."""

    src = resolve_path(src)
    dst = resolve_path(dst)

    if is_dir:
        touch_dir(src)
    else:
        touch_file(src, content)

    return src, dst


def _session_claude_dir(config: Config) -> Path:
    """Local backend mounts nothing: its sessions read the daemon's own agent config directory."""

    if config.backend == "local":
        return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")

    return config.config_dir / HOST_CLAUDE_DIR_SUBPATH


def _container_port(ports: Mapping[int, int] | None, host_port: int) -> int | None:
    return next((c for h, c in (ports or {}).items() if int(h) == host_port), None)


def _port_in_use(port: int) -> bool:
    # A wildcard bind also fails for a listener on 127.0.0.1 alone; only EADDRINUSE means held.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("0.0.0.0", port))
        except OSError as exc:
            return exc.errno == errno.EADDRINUSE

    return False


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("0.0.0.0", 0))

        return probe.getsockname()[1]
