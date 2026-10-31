"""File domain exceptions."""

from __future__ import annotations

from ..errors import DaemonError


class FileNotFound(DaemonError):
    """No readable file at the path inside its root - also what a path leading outside it gets."""

    status_code = 404
    error_key = "file_not_found"


class InvalidPath(DaemonError):
    """The path is empty, holds a NUL, or is absolute other than a session's /tmp."""

    status_code = 400
    error_key = "invalid_path"


class UnsupportedMediaType(DaemonError):
    """The file's extension is not an image type this endpoint serves."""

    status_code = 415
    error_key = "unsupported_media_type"
