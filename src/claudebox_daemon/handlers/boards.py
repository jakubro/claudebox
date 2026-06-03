"""Board CRUD — workspace-scoped HTTP adapters for board management."""

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from ._models import (
    AssignTicketsRequest,
    CreateSwimlaneRequest,
    MoveTicketRequest,
    RenameBoardRequest,
    RenameStateRequest,
    RenameSwimlaneRequest,
    ReorderStatesRequest,
    ReorderSwimlanesRequest,
)
from ._shared import WorkspaceDep


router = APIRouter(prefix="/api/workspaces/{workspace_id}")


# Board CRUD
# ----------------------------------------------------------------------------------------------


@router.get("/boards")
async def list_boards(svc: WorkspaceDep):
    """List discovered boards in the workspace."""

    return {"boards": svc.board_service.list_all()}


@router.get("/boards/{board_id}")
async def get_board(svc: WorkspaceDep, board_id: str):
    """Get full board state with resolved ticket titles and session status."""

    return svc.board_service.get(board_id)


@router.patch("/boards/{board_id}")
async def rename_board(svc: WorkspaceDep, board_id: str, body: RenameBoardRequest):
    """Rename a board — set the name: field in its board.yaml."""

    return svc.board_service.rename(board_id, body.name)


# Tickets
# ----------------------------------------------------------------------------------------------


@router.get("/boards/{board_id}/tickets/{ticket_path:path}/content")
async def get_ticket_content(svc: WorkspaceDep, board_id: str, ticket_path: str):
    """Return raw markdown content of a ticket file."""

    content = svc.board_service.read_ticket_content(board_id, ticket_path)
    return PlainTextResponse(content, media_type="text/markdown")


@router.patch("/boards/{board_id}/tickets/{ticket_path:path}/move")
async def move_ticket(svc: WorkspaceDep, board_id: str, ticket_path: str, body: MoveTicketRequest):
    """Move a ticket between columns and/or swimlanes, optionally at a specific index."""

    return svc.board_service.move(
        board_id,
        ticket_path,
        column=body.column,
        swimlane=body.swimlane,
        index=body.index,
    )


@router.delete("/boards/{board_id}/tickets/{ticket_path:path}")
async def archive_ticket(svc: WorkspaceDep, board_id: str, ticket_path: str):
    """Archive a ticket — remove from YAML, file stays on disk."""

    svc.board_service.archive(board_id, ticket_path)
    return {"status": "archived"}


@router.post("/boards/{board_id}/assign")
async def assign_tickets(svc: WorkspaceDep, board_id: str, body: AssignTicketsRequest):
    """Batch assign tickets to new sessions."""

    sessions = await svc.board_service.assign(
        board_id,
        body.tickets,
        parallel=body.parallel,
    )
    return {"sessions": sessions}


# Swimlanes
# ----------------------------------------------------------------------------------------------


@router.post("/boards/{board_id}/swimlanes")
async def create_swimlane(svc: WorkspaceDep, board_id: str, body: CreateSwimlaneRequest):
    """Create a new swimlane."""

    return svc.board_service.create_swimlane(board_id, body.name)


@router.patch("/boards/{board_id}/swimlanes/{swimlane_id}")
async def rename_swimlane(
    svc: WorkspaceDep,
    board_id: str,
    swimlane_id: str,
    body: RenameSwimlaneRequest,
):
    """Rename an existing swimlane."""

    return svc.board_service.update_swimlane(board_id, swimlane_id, body.name)


@router.delete("/boards/{board_id}/swimlanes/{swimlane_id}")
async def delete_swimlane(svc: WorkspaceDep, board_id: str, swimlane_id: str):
    """Delete a swimlane. Tickets in it become unsorted."""

    svc.board_service.remove_swimlane(board_id, swimlane_id)
    return {"status": "deleted"}


@router.patch("/boards/{board_id}/swimlanes/reorder")
async def reorder_swimlanes(svc: WorkspaceDep, board_id: str, body: ReorderSwimlanesRequest):
    """Reorder swimlanes to match the given ID order."""

    return {"swimlanes": svc.board_service.reorder(board_id, body.ids)}


# States
# ----------------------------------------------------------------------------------------------


@router.patch("/boards/{board_id}/states/reorder")
async def reorder_states(svc: WorkspaceDep, board_id: str, body: ReorderStatesRequest):
    """Reorder columns/states to match the given key order."""

    return {"states": svc.board_service.reorder_columns(board_id, body.keys)}


@router.patch("/boards/{board_id}/states/{state_id}")
async def rename_state(svc: WorkspaceDep, board_id: str, state_id: str, body: RenameStateRequest):
    """Rename a state's display label. Folder and ID stay unchanged."""

    return await svc.board_service.rename_state(board_id, state_id, body.label)
