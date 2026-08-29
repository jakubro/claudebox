"""Container lifecycle and log-stream endpoints."""

from fastapi import APIRouter

from claudebox import BroadcastEventSourceResponse, SessionNotReady
from .. import logging, session


router = APIRouter(prefix="/api")


# Health


@router.get("/health")
async def container_health():
    """Return container health status for daemon polling.

    `session_id` is the primary; `live_session_ids` is every registered session, primary included.
    """

    registry = session.registry
    primary_id = registry.primary_id if registry else None
    live_session_ids = registry.live_ids() if registry else []

    return {
        "mode": "container",
        "status": "ok",
        "session_id": primary_id,
        "live_session_ids": live_session_ids,
    }


# Logs


@router.get("/logs")
async def stream_logs():
    """Stream container API log events via SSE, replaying log file history on connect."""

    if logging.log_broadcaster is None:
        raise SessionNotReady()

    return BroadcastEventSourceResponse(logging.log_broadcaster)
