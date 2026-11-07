"""Build container images for claudebox."""

from __future__ import annotations

import contextlib
import fcntl
import shutil
from collections.abc import Generator, Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from .models import ImageBuildMode
from ..constants import (
    CONTAINER_IMAGE_NAME,
    HOST_TEMP_BUILD_DIR,
    LIB_BUILD_DIR,
    LIB_ROOT,
    PROFILE_BUILD_HOOK_PATH,
    build_lock_path,
)
from ..core.fs import find_files, make_temp_dir, touch_dir
from ..core.time import get_timestamp
from ..paths import make_timestamped_dir_prefix


if TYPE_CHECKING:
    from .backend import ContainerBackend
    from ..config import Config


def build_image(
    mode: ImageBuildMode | None = None,
    *,
    config: Config,
    backend: ContainerBackend,
) -> None:
    """Build a claudebox container image.

    Copies the build context to a temp dir, adds pyproject.toml files for uv sync
    and the profile image-build hook if configured, then invokes the backend.
    """

    with make_temp_dir(dir=HOST_TEMP_BUILD_DIR, prefix=make_timestamped_dir_prefix()) as build_dir:
        build_dir = Path(build_dir)
        shutil.copytree(
            LIB_BUILD_DIR,
            build_dir,
            symlinks=True,
            ignore_dangling_symlinks=True,
            dirs_exist_ok=True,
        )

        # Copy pyproject.toml files for uv sync (preserving source structure)
        for source in find_files(LIB_ROOT, "pyproject.toml"):
            target = build_dir / source.relative_to(LIB_ROOT)
            touch_dir(target.parent)
            shutil.copy2(source, target)

        # Handle profile install script
        if config.profile:
            source_script = config.profile / PROFILE_BUILD_HOOK_PATH
            target_script = build_dir / "fs/install_profile.sh"

            if source_script.exists():
                shutil.copy2(source_script, target_script)
                target_script.chmod(0o775)

        args = get_image_build_args(build_dir, mode)

        with holding_build_lock() as lock_fd:
            backend.build_image(*args, pass_fds=(lock_fd,))


@contextlib.contextmanager
def holding_build_lock() -> Generator[int]:
    """Hold the build lock shared, so concurrent builds still run; yield its fd for the build to inherit.

    The build process must inherit it: a build that outlives a killed claudebox keeps the lock.
    """

    with _open_build_lock() as fd:
        fcntl.flock(fd, fcntl.LOCK_SH)
        yield fd


@contextlib.contextmanager
def no_build_running() -> Generator[bool]:
    """Hold the build lock exclusively when no build holds it; yield whether it was taken."""

    with _open_build_lock() as fd:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False

            return

        yield True


def get_image_build_args(path: Path, mode: ImageBuildMode | None) -> Iterable:
    """Yield build args; UPDATE forces an agent update, REBUILD disables layer caching."""

    yield "--file"
    yield path / "Containerfile"

    yield "--tag"
    yield CONTAINER_IMAGE_NAME

    if mode == ImageBuildMode.UPDATE:
        yield "--build-arg"
        yield f"CLAUDEBOX_FORCE_AGENT_UPDATE={get_timestamp(posix=True)}"
    elif mode == ImageBuildMode.REBUILD:
        yield "--no-cache"

    yield path


@contextlib.contextmanager
def _open_build_lock() -> Generator[int]:
    path = build_lock_path()
    touch_dir(path.parent)

    with path.open("a", encoding="utf-8") as lock_file:
        yield lock_file.fileno()
