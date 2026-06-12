"""UI state persistence - workspace-scoped HTTP adapters."""

from fastapi import APIRouter

from claudebox import JSONResponse
from ._models import PatchUIStateRequest
from ._shared import WorkspaceDep


router = APIRouter(prefix="/api/workspaces/{workspace_id}")


@router.get("/ui-state")
async def get_ui_state(svc: WorkspaceDep, session_id: str | None = None):
    """Retrieve UI state for global and session-specific data."""

    return JSONResponse(content=svc.ui_state.get(session_id))


@router.patch("/ui-state")
async def patch_ui_state(
    svc: WorkspaceDep,
    body: PatchUIStateRequest,
    session_id: str | None = None,
):
    """Apply patch operations to global and session-specific UI state."""

    return JSONResponse(
        content=svc.ui_state.patch(
            session_id,
            **body.model_dump(by_alias=True, exclude_none=True),
        ),
    )
