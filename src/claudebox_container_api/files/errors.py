"""File domain exceptions - typed errors with HTTP status codes."""

from __future__ import annotations

from claudebox import ApiError


class FileServiceNotReady(ApiError):
    """File service not yet initialized."""

    status_code = 503
    error_key = "file_service_not_ready"
