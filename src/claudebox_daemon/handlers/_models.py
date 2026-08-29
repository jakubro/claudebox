"""Pydantic request models for daemon HTTP endpoints."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class UpdateSessionRequest(BaseModel):
    """Body for PATCH /sessions/{session_id}."""

    name: str | None = None


class NewSessionRequest(BaseModel):
    """Body for POST /sessions/new."""

    messages: list[str] = []


class ForkSessionRequest(BaseModel):
    """Body for POST /sessions/{session_id}/fork."""

    turn_id: str | None = None
    reuse_container: bool = False
    share_container: bool = False
    parent_session_id: str | None = None


class StopContainerRequest(BaseModel):
    """Body for POST /containers/{container_id}/stop."""

    grace_seconds: int = 10


class UIStateOperation(BaseModel):
    """Single UI state patch operation."""

    op: Literal["set", "unset", "add", "remove"]
    path: str
    value: Any = None


class PatchUIStateRequest(BaseModel):
    """Body for PATCH /ui-state."""

    model_config = ConfigDict(populate_by_name=True)

    global_ops: list[UIStateOperation] | None = Field(None, alias="global")
    session_ops: list[UIStateOperation] | None = Field(None, alias="session")


class RenameBoardRequest(BaseModel):
    """Body for PATCH /boards/{board_id}."""

    name: str


class MoveTicketRequest(BaseModel):
    """Body for PATCH /boards/{board_id}/tickets/{ticket_path}/move."""

    column: str | None = None
    swimlane: str | None = None
    index: int | None = None


class AssignTicketsRequest(BaseModel):
    """Body for POST /boards/{board_id}/assign."""

    tickets: list[str]
    parallel: bool = True


class CreateSwimlaneRequest(BaseModel):
    """Body for POST /boards/{board_id}/swimlanes."""

    name: str


class RenameSwimlaneRequest(BaseModel):
    """Body for PATCH /boards/{board_id}/swimlanes/{swimlane_id}."""

    name: str


class ReorderSwimlanesRequest(BaseModel):
    """Body for PATCH /boards/{board_id}/swimlanes/reorder."""

    ids: list[str]


class ReorderStatesRequest(BaseModel):
    """Body for PATCH /boards/{board_id}/states/reorder."""

    keys: list[str]


class RenameStateRequest(BaseModel):
    """Body for PATCH /boards/{board_id}/states/{state_id}."""

    label: str


class FrontendErrorReport(BaseModel):
    """Body for POST /api/daemon/report - a narrow failure report, never conversation content."""

    kind: str
    message: str
    stack_trace: str | None = None
    app_version: str | None = None
    client_timestamp: str
