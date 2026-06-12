"""File endpoints - path resolution."""

from fastapi import APIRouter

from ._models import ResolvePathsRequest
from ._shared import FilesDep, SessionDep


# FastAPI router for file browser API endpoints, mounted at /api/files prefix.
router = APIRouter(prefix="/api/files")


@router.post("/resolve-paths")
async def resolve_paths(files: FilesDep, svc: SessionDep, body: ResolvePathsRequest):
    """Resolve path candidates to absolute host paths via filesystem checks."""

    session = svc.base_session
    temp_dir = session.temp_dir if session else None
    resolved = await files.resolve_paths(body.candidates, temp_dir)

    return {"resolved": resolved}
