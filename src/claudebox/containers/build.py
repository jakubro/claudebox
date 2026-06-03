"""Build container images for claudebox."""

import shutil
from collections.abc import Iterable
from pathlib import Path
from typing import TYPE_CHECKING

from .models import ImageBuildMode
from ..constants import (
    CONTAINER_IMAGE_NAME,
    HOST_TEMP_BUILD_DIR,
    LIB_BUILD_DIR,
    LIB_ROOT,
    PROFILE_BUILD_HOOK_PATH,
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
    config: "Config",
    backend: "ContainerBackend",
) -> None:
    """Build a claudebox container image.

    Copies the container build context to a temporary directory, then copies
    Python package files (pyproject.toml) from the source tree. If a profile is
    configured with an image-build hook script, it is included in the build.
    Finally, invokes the container backend to build the image.
    """

    with make_temp_dir(dir=HOST_TEMP_BUILD_DIR, prefix=make_timestamped_dir_prefix()) as build_dir:
        # Copy to temporary build directory
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

        # Build image
        args = get_image_build_args(build_dir, mode)
        backend.build_image(*args)


def get_image_build_args(path: Path, mode: ImageBuildMode | None) -> Iterable:
    """Generate container build command arguments.

    Yields command-line arguments including the Containerfile path, image tag,
    and mode-specific options. UPDATE mode forces agent update; REBUILD mode
    disables layer caching.
    """

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
