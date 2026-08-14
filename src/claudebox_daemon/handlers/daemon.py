"""Daemon status: health check, SSE event stream, and frontend error reports."""

from fastapi import APIRouter

from claudebox import BroadcastEventSourceResponse
from ._models import FrontendErrorReport
from ._shared import DaemonDep


router = APIRouter(prefix="/api/daemon")


@router.get("/health")
async def daemon_health(svc: DaemonDep):
    """Return daemon health - degraded when the event loop lags or the blocking pools stop serving."""

    return svc.health()


@router.get("/stream")
async def daemon_stream(svc: DaemonDep):
    """Daemon-level SSE stream for workspace events (container status, etc.)."""

    return BroadcastEventSourceResponse(svc.events)


@router.post("/report")
async def report_error(body: FrontendErrorReport, svc: DaemonDep):
    """Accept a frontend-originated failure report and log it to the daemon log."""

    svc.report_frontend_error(**body.model_dump())

    return {"status": "ok"}
