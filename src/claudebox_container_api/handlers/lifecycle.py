"""Container lifecycle and log-stream endpoints."""

from fastapi import APIRouter

from claudebox import BroadcastEventSourceResponse, SessionNotReady
from .. import logging, session


router = APIRouter(prefix="/api")


# Health
# ----------------------------------------------------------------------------------------------


@router.get("/health")
async def container_health():
    """Return container health status for daemon polling."""

    session_id = None
    if session.current and session.current.base_session:
        session_id = session.current.base_session.id

    return {"mode": "container", "status": "ok", "session_id": session_id}


# Logs
# ----------------------------------------------------------------------------------------------


@router.get("/logs")
async def stream_logs():
    """Stream container API log events via SSE, replaying log file history on connect."""

    if logging.log_broadcaster is None:
        raise SessionNotReady()

    return BroadcastEventSourceResponse(logging.log_broadcaster)
