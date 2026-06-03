"""Daemon status: health check and SSE event stream."""

from fastapi import APIRouter

from claudebox import BroadcastEventSourceResponse
from ._shared import DaemonDep


router = APIRouter(prefix="/api/daemon")


@router.get("/health")
async def daemon_health():
    """Return daemon health."""

    return {"mode": "daemon", "status": "ok"}


@router.get("/stream")
async def daemon_stream(svc: DaemonDep):
    """Daemon-level SSE stream for workspace events (container status, etc.)."""

    return BroadcastEventSourceResponse(svc.events)
