"""Session CRUD - workspace-scoped HTTP adapters for session management."""

import time

from fastapi import APIRouter

from claudebox import Config, JSONResponse, serialization
from ._models import ForkSessionRequest, NewSessionRequest, UpdateSessionRequest
from ._shared import WorkspaceDep
from ..domain import resolve_link_messages


router = APIRouter(prefix="/api/workspaces/{workspace_id}")


@router.get("/sessions")
async def list_sessions(svc: WorkspaceDep):
    """List all sessions from workspace disk."""

    started_at = time.monotonic()
    sessions = await svc.session_service.list_all()
    response = JSONResponse(content={"sessions": sessions})
    svc.session_service.log_listing_completed(
        session_count=len(sessions),
        response_bytes=len(response.body),
        total_seconds=time.monotonic() - started_at,
    )

    return response


@router.post("/sessions/new")
async def new_session(svc: WorkspaceDep, body: NewSessionRequest | None = None):
    """Spawn container and start a new session, delivering any allowlisted messages."""

    config = Config.load(svc.workspace.path)
    delivered, blocked = resolve_link_messages(
        body.messages if body else [],
        config.links_allow or [],
    )

    if delivered:
        result = await svc.session_service.create_with_prompts(delivered)
    else:
        result = await svc.session_service.create()

    return {**serialization.serialize(result), "undelivered_messages": blocked}


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
        share_container=body.share_container,
        parent_session_id=body.parent_session_id,
    )
