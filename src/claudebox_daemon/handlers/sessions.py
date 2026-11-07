"""Session CRUD - workspace-scoped HTTP adapters for session management."""

from __future__ import annotations

import time

from fastapi import APIRouter
from fastapi.responses import Response

from claudebox import Config, serialization
from ._models import ForkSessionRequest, NewSessionRequest, PortAnswerRequest, UpdateSessionRequest
from ._shared import WorkspaceDep
from ..domain import resolve_link_messages


router = APIRouter(prefix="/api/workspaces/{workspace_id}")


@router.get("/sessions")
async def list_sessions(svc: WorkspaceDep):
    """List all sessions from workspace disk."""

    started_at = time.monotonic()
    listing = await svc.session_service.list_all()
    svc.session_service.log_listing_completed(
        session_count=listing.session_count,
        response_bytes=len(listing.body),
        total_seconds=time.monotonic() - started_at,
    )

    return Response(content=listing.body, media_type="application/json")


@router.get("/sessions/schedules")
async def list_session_schedules(svc: WorkspaceDep) -> Response:
    """List the schedule events of every running session that has scheduled a prompt."""

    started_at = time.monotonic()
    listing = await svc.session_service.list_schedules()
    svc.session_service.log_listing_completed(
        session_count=listing.session_count,
        response_bytes=len(listing.body),
        total_seconds=time.monotonic() - started_at,
        kind="schedule",
    )

    return Response(content=listing.body, media_type="application/json")


@router.post("/sessions/new")
async def new_session(svc: WorkspaceDep, body: NewSessionRequest | None = None):
    """Spawn container and start a new session; return the opening messages the browser sends."""

    config = Config.load(svc.workspace.path)
    _, blocked = resolve_link_messages(
        body.messages if body else [],
        config.links_allow or [],
    )

    bundle = body.bundle if body else None
    # Host-authored, so never link-filtered.
    bundle_messages = (config.bundles or {}).get(bundle, {}).get("messages", []) if bundle else []
    result = await svc.session_service.create(bundle=bundle)

    return {
        **serialization.serialize(result),
        "undelivered_messages": blocked,
        "bundle_messages": bundle_messages,
    }


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


@router.post("/sessions/{session_id}/ports")
async def answer_port_request(svc: WorkspaceDep, session_id: str, body: PortAnswerRequest):
    """Open or refuse a port an agent asked for, and tell the agent which."""

    return await svc.port_service.answer(session_id, body.port, approve=body.approve)
