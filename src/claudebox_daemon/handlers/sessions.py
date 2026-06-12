"""Session CRUD - workspace-scoped HTTP adapters for session management."""

from fastapi import APIRouter

from ._models import ForkSessionRequest, UpdateSessionRequest
from ._shared import WorkspaceDep


router = APIRouter(prefix="/api/workspaces/{workspace_id}")


@router.get("/sessions")
async def list_sessions(svc: WorkspaceDep):
    """List all sessions from workspace disk."""

    return {"sessions": await svc.session_service.list_all()}


@router.post("/sessions/new")
async def new_session(svc: WorkspaceDep):
    """Spawn container and start a new session."""

    return await svc.session_service.create()


@router.patch("/sessions/{session_id}")
async def update_session(svc: WorkspaceDep, session_id: str, body: UpdateSessionRequest):
    """Update session metadata on disk."""

    return await svc.session_service.update(session_id, **body.model_dump(exclude_unset=True))


@router.post("/sessions/{session_id}/resume")
async def resume_session(svc: WorkspaceDep, session_id: str):
    """Resolve or spawn container, then resume the session."""

    return await svc.session_service.resume(session_id)


@router.post("/sessions/{session_id}/fork")
async def fork_session(svc: WorkspaceDep, session_id: str, body: ForkSessionRequest):
    """Fork a session, optionally truncating at a specific turn."""

    return await svc.session_service.fork(
        session_id,
        body.turn_id,
        reuse_container=body.reuse_container,
    )
