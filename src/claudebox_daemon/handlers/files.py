"""Workspace file serving - the image endpoint relative and /tmp images in messages load from."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from ._shared import WorkspaceDep


router = APIRouter(prefix="/api/workspaces/{workspace_id}")

# Opened directly in a tab, an SVG must not run script on the app's origin.
IMAGE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
}


@router.get("/files/image")
async def get_image(svc: WorkspaceDep, path: str, session: str | None = None):
    """Return an image from the workspace root, or from a session's temp dir for /tmp/ paths."""

    file_path, media_type = await svc.file_service.resolve_image(path, session)

    return FileResponse(file_path, media_type=media_type, headers=IMAGE_HEADERS)
