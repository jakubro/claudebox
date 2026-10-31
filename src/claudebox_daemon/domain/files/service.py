"""Resolve an image a message names to a file inside the workspace root or a session's temp dir."""

from __future__ import annotations

import asyncio
from pathlib import Path

from claudebox import InvalidSessionId, find_session_dir
from .errors import FileNotFound, InvalidPath, UnsupportedMediaType
from ..executors import ObservedPool
from ..workspaces.models import RegisteredWorkspace


IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
}

TMP_PREFIX = "/tmp/"


class FileService:
    """Resolves image paths for one workspace; the disk work runs on the listing pool."""

    def __init__(self, workspace: RegisteredWorkspace, *, executor: ObservedPool):
        self._workspace = workspace
        self._executor = executor

    async def resolve_image(self, path: str, session_id: str | None) -> tuple[Path, str]:
        """Return the image file and its media type; raise a typed error for anything else."""

        loop = asyncio.get_running_loop()

        return await loop.run_in_executor(self._executor, self._resolve, path, session_id)

    def _resolve(self, path: str, session_id: str | None) -> tuple[Path, str]:
        if not path or "\x00" in path:
            raise InvalidPath()

        if path.startswith(TMP_PREFIX):
            if not session_id:
                raise InvalidPath()

            root = self._session_temp_dir(session_id)
            relative = path[len(TMP_PREFIX) :]
        elif path.startswith("/"):
            raise InvalidPath()
        else:
            root = self._workspace.path
            relative = path

        # Symlinks are followed before the check: the workspace is writable from inside the container.
        try:
            root = root.resolve(strict=True)
            target = (root / relative).resolve(strict=True)
        except OSError as exc:
            raise FileNotFound() from exc

        if not (target.is_relative_to(root) and target.is_file()):
            raise FileNotFound()

        if (media_type := IMAGE_TYPES.get(target.suffix.lower())) is None:
            raise UnsupportedMediaType()

        return target, media_type

    def _session_temp_dir(self, session_id: str) -> Path:
        try:
            session_dir = find_session_dir(self._workspace.path, session_id)
        except InvalidSessionId as exc:
            raise FileNotFound() from exc

        if session_dir is None:
            raise FileNotFound()

        return session_dir / "tmp"
