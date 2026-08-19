"""Chat handlers - prompt submission, SSE streaming, interrupts, model and effort selection."""

from fastapi import APIRouter

from claudebox import BroadcastEventSourceResponse
from ._models import SendRequest, SetEffortLevelRequest, SetModelRequest, SetPermissionModeRequest
from ._shared import SessionDep


router = APIRouter(prefix="/api")


@router.post("/send", response_model=None)
async def send(svc: SessionDep, body: SendRequest):
    """Queue a user prompt with optional attachments, inline replies, and a note for the assistant."""

    await svc.send(body.prompt, body.attachments, body.inline_replies, body.note)


@router.get("/stream")
async def chat_stream(svc: SessionDep):
    """Stream session events via SSE, replaying history on connect."""

    # Checked here, not in subscribe(): the body is a lazy generator, so subscribe() runs after headers are sent.
    # A raise inside subscribe() would arrive too late to become this typed response.
    svc.ensure_ready()

    return BroadcastEventSourceResponse(svc)


@router.post("/interrupt")
async def interrupt(svc: SessionDep):
    """Interrupt the current assistant processing."""

    await svc.interrupt()


@router.post("/model")
async def set_model(svc: SessionDep, body: SetModelRequest):
    """Set the model for subsequent messages."""

    await svc.set_model(body.model)


@router.post("/permission-mode")
async def set_permission_mode(svc: SessionDep, body: SetPermissionModeRequest):
    """Set the active permission mode."""

    await svc.set_permission_mode(body.permission_mode)


@router.post("/effort-level")
async def set_effort_level(svc: SessionDep, body: SetEffortLevelRequest):
    """Set the effort level for subsequent messages."""

    await svc.set_effort_level(body.effort_level)
