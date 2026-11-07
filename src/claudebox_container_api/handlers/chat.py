"""Chat handlers - prompt submission, SSE streaming, interrupts, model and effort selection."""

from __future__ import annotations

from fastapi import APIRouter

from claudebox import BroadcastEventSourceResponse, SiblingMessage
from ._models import (
    SendRequest,
    SetEffortLevelRequest,
    SetModelRequest,
    SetPermissionModeRequest,
    SiblingMessageRequest,
)
from ._shared import SessionDep


router = APIRouter(prefix="/api")


@router.post("/send", response_model=None)
async def send(svc: SessionDep, body: SendRequest):
    """Queue a user prompt with optional attachments, inline replies, and a note for the assistant."""

    await svc.send(body.prompt, body.attachments, body.inline_replies, body.note)


@router.post("/sibling-message", response_model=None)
async def sibling_message(svc: SessionDep, body: SiblingMessageRequest):
    """Queue a turn end of a session this one spawned, behind any running turn."""

    await svc.deliver_sibling_message(SiblingMessage(**body.model_dump()))


@router.get("/stream")
async def chat_stream(svc: SessionDep, replay: bool = True):
    """Stream session events via SSE, replaying history on connect by default.

    `replay=false` re-attaches without it, for a caller that already read the persisted log.
    """

    # Checked here, not in subscribe(): the body is a lazy generator, so subscribe() runs after headers are sent.
    # A raise inside subscribe() would arrive too late to become this typed response.
    svc.ensure_ready()

    return BroadcastEventSourceResponse(svc, subscribe_kwargs=None if replay else {"replay": False})


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
