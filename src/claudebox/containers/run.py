"""Container run orchestration."""

from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from ..constants import (
    CONTAINER_CLAUDE_DIR_MOUNT,
    CONTAINER_CLAUDE_JSON_MOUNT,
    CONTAINER_IMAGE_NAME,
    CONTAINER_LIB_MOUNT,
    CONTAINER_PROFILE_MOUNT,
    CONTAINER_SESSIONS_MOUNT,
    DEFAULT_LABELS,
    HOST_CLAUDE_DIR_SUBPATH,
    HOST_CLAUDE_JSON_SUBPATH,
    LIB_ROOT,
    LIB_RUN_DIR,
    SESSIONS_DIR_NAME,
)
from ..core.fs import resolve_path, touch_dir, touch_file


if TYPE_CHECKING:
    from .backend import ContainerBackend
    from ..config import Config


def run_container(
    args: Iterable = (),
    *,
    config: "Config",
    backend: "ContainerBackend",
    verbose: bool = False,
    kind: str = "agent",
) -> int:
    """Run the claudebox container interactively with TUI; return its exit code.

    The container is labeled ``kind={kind}`` so ``containers list`` can distinguish
    agent sessions from interactive shells.
    """

    args = get_container_run_args(
        config,
        interactive=True,
        verbose=verbose,
        labels={"kind": kind},
        cmd_args=args,
    )

    return backend.run_container(*args)  # ty: ignore[invalid-return-type]


def get_container_run_args(
    config: "Config",
    *,
    interactive: bool = False,
    verbose: bool = False,
    name: str | None = None,
    labels: dict[str, str] | None = None,
    network: str | None = None,
    publish_all: bool = False,
    env: dict[str, str] | None = None,
    extra_volumes: list[tuple[str | Path, str | Path, bool]] | None = None,
    run_args: Iterable = (),
    cmd_args: Iterable = (),
) -> Iterable:
    """Yield container run arguments from configuration.

    Shared builder for both interactive CLI and daemon-managed containers.
    Caller controls mode via parameters; config provides workspace-level defaults.

    Arguments before the image name (podman run flags) include dedicated parameters
    and ``run_args``.  Arguments after the image name (container CMD) come from
    ``cmd_args``.
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

    # Labels

    labels = labels or {}
    labels = {**labels, **DEFAULT_LABELS}

    for key, val in labels.items():
        yield "--label"
        yield f"{key}={val}"

    # Environment

    yield "--env"
    yield f"CLAUDEBOX_AGENT={config.agent}"

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

    for host_path, container_path in dict.fromkeys(get_volumes(config)):
        yield "--volume"
        yield f"{host_path}:{container_path}"

    if extra_volumes:
        for src, dst, is_dir in extra_volumes:
            src, dst = prepare_volume(src, dst, is_dir=is_dir)
            yield "--volume"
            yield f"{src}:{dst}"

    # Networking

    if publish_all:
        yield "--publish-all"
    elif config.ports:
        for host_port, container_port in config.ports.items():
            yield "--publish"
            yield f"{host_port}:{container_port}"

    effective_network = network or config.network_mode

    if effective_network:
        yield "--network"
        yield effective_network

    # Extra run flags (before image)

    yield from run_args

    # Image

    yield CONTAINER_IMAGE_NAME

    # Container CMD (after image)

    yield from cmd_args


def get_volumes(config: "Config") -> Iterable[tuple[str | Path, str | Path]]:
    """Yield volume mount tuples from configuration."""

    yield prepare_volume(config.work_dir, config.work_dir)

    # Add mounts from config files
    if config.mounts:
        for src, dst in config.mounts.items():
            yield prepare_volume(src, dst)

    # Add runtime overlay from claudebox library
    run_overlay_root = LIB_RUN_DIR / "fs"

    for src in run_overlay_root.glob("**/*"):
        if src.is_file():
            dst = Path("/") / src.relative_to(run_overlay_root)
            yield prepare_volume(src, dst, is_dir=False)

    # Add claudebox runtime library
    yield prepare_volume(LIB_ROOT, CONTAINER_LIB_MOUNT)

    # Add claudebox profile
    if config.profile:
        yield prepare_volume(config.profile, CONTAINER_PROFILE_MOUNT)

    # Add claudebox sessions from workspace/home
    yield prepare_volume(config.config_dir / SESSIONS_DIR_NAME, CONTAINER_SESSIONS_MOUNT)

    # Add claude configs from workspace/home
    if config.agent == "claude":
        yield prepare_volume(
            config.config_dir / HOST_CLAUDE_DIR_SUBPATH,
            CONTAINER_CLAUDE_DIR_MOUNT,
        )
        yield prepare_volume(
            config.config_dir / HOST_CLAUDE_JSON_SUBPATH,
            CONTAINER_CLAUDE_JSON_MOUNT,
            is_dir=False,
        )


def prepare_volume(src: str | Path, dst: str | Path, is_dir: bool = True) -> tuple[Path, Path]:
    """Resolve paths and create source directory or file if missing before mounting."""

    src = resolve_path(src)
    dst = resolve_path(dst)

    if is_dir:
        touch_dir(src)
    else:
        touch_file(src)

    return src, dst
