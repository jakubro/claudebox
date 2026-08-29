"""Session handlers - CRUD, restart, attachments."""

import contextlib
import dataclasses

from fastapi import APIRouter
from fastapi.responses import FileResponse

from claudebox import EventLog, SessionEntryNotFound, serialize_event
from ._models import UpdateSessionPromptRequest
from ._shared import RegistryDep, SessionDep


router = APIRouter(prefix="/api/sessions")


# Creation & restart


@router.post("/new")
async def create_session(registry: RegistryDep, primary: bool = True):
    """Create a new session and return its pre-generated session ID.

    primary=false starts it as a member of the container instead of replacing the primary.
    """

    session_id = await registry.start(None, primary=primary)

    return {"session_id": session_id}


@router.post("/{session_id}/resume")
async def restart_session(registry: RegistryDep, session_id: str, primary: bool = True):
    """Restart with a previous session's history.

    primary=false starts it as a member of the container instead of replacing the primary.
    """

    await registry.start(session_id, primary=primary)


@router.post("/{session_id}/stop")
async def stop_session(registry: RegistryDep, session_id: str):
    """Stop one non-primary session and remove it from the registry.

    Idempotent - a session already auto-stopped is a no-op success, not a 404.
    """

    with contextlib.suppress(SessionEntryNotFound):
        await registry.stop_session(session_id)


@router.post("/{session_id}/promote")
async def promote_session(registry: RegistryDep, session_id: str):
    """Cancel a member session's turn-complete auto-stop - it runs until stopped like any other.

    Unlike stop, a missing session id is a 404: promotion has nothing to cancel and must say so.
    """

    registry.promote_session(session_id)


@router.get("/{session_id}/events")
async def get_session_events(registry: RegistryDep, session_id: str):
    """Read a session's persisted events without starting anything (unlike /api/stream).

    Reads the directory directly, not through SessionDep; `running` reports registry membership.
    """

    events = EventLog(session_id=session_id, workspace=registry.workspace).read_all()

    return {
        "events": [serialize_event(event) for event in events],
        "running": session_id in registry.live_ids(),
    }


# Current session metadata


@router.get("/current")
async def get_current_session(svc: SessionDep):
    """Get the currently active session metadata + capability surface."""

    if not (summary := svc.get()):
        return {}

    body = dataclasses.asdict(summary)
    body["capabilities"] = svc.get_capabilities()
    body["runtime_name"] = svc.runtime_name
    body["rate_limits"] = svc.get_rate_limits()

    return body


@router.get("/current/capabilities")
async def get_session_capabilities(svc: SessionDep):
    """Return capability matrix + runtime name + per-capability catalogs (null when flag is False)."""

    caps = svc.get_capabilities()
    runtime = svc._sdk_client

    models = runtime.get_models() if caps.supports_models else None
    effort_levels = runtime.get_effort_levels() if caps.supports_effort_levels else None
    permission_modes = runtime.get_permission_modes() if caps.supports_permission_modes else None
    skills = runtime.get_skills() if caps.supports_skills else None

    return {
        "capabilities": caps,
        "runtime_name": runtime.runtime_name,
        "models": models,
        "effort_levels": effort_levels,
        "permission_modes": permission_modes,
        "skills": skills,
    }


@router.patch("/current/prompt")
async def update_session_prompt(svc: SessionDep, body: UpdateSessionPromptRequest):
    """Update the current session prompt text."""

    prompt = body.session_prompt

    if isinstance(prompt, str) and not prompt.strip():
        prompt = None

    session_id = svc.current_session_id
    assert session_id is not None, "no active session"

    return svc.update(session_id, session_prompt=prompt)


# Attachments & tool output


@router.get("/current/attachments/{filename}")
async def get_attachment(svc: SessionDep, filename: str):
    """Serve a stored attachment file from the current session directory."""

    session_id = svc.current_session_id
    assert session_id is not None, "no active session"

    info = svc.get_attachment(session_id, filename)

    return FileResponse(path=info.path, media_type=info.media_type)


@router.get("/current/tool-output/{tool_use_id}")
async def get_tool_output(svc: SessionDep, tool_use_id: str):
    """Get the content of a tool's output from the current session."""

    session_id = svc.current_session_id
    assert session_id is not None, "no active session"

    result = svc.get_tool_output(session_id, tool_use_id)

    return {
        "content": result.content,
        "truncated": result.truncated,
        "total_size": result.total_size,
    }


@router.get("/current/tool-output/{tool_use_id}/download")
async def download_tool_output(svc: SessionDep, tool_use_id: str):
    """Download a tool's output as a file from the current session."""

    session_id = svc.current_session_id
    assert session_id is not None, "no active session"

    path = svc.get_tool_output_path(session_id, tool_use_id)

    return FileResponse(path=path, filename=path.name, media_type="text/plain")
