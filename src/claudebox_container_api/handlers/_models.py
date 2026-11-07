"""Request models - Pydantic schemas for HTTP endpoints."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from claudebox import EffortLevelId, PermissionModeId


class SendRequest(BaseModel):
    """Body for POST /api/send."""

    prompt: str = ""
    attachments: list[dict] | None = None
    # list[dict], not typed: `from` is a keyword, needing Field(alias="from") + populate_by_name.
    inline_replies: list[dict] | None = None
    # Message typed alongside an AskUserQuestion/ExitPlanMode answer.
    note: str | None = None


class SiblingMessageRequest(BaseModel):
    """Body for POST /api/sibling-message - a turn end of a session this one spawned."""

    from_session_id: str
    from_name: str | None = None
    delivery_id: str
    outcome: Literal["ended", "asking", "interrupted", "failed"]
    text: str


class SetModelRequest(BaseModel):
    """Body for POST /api/model."""

    model: str


class SetPermissionModeRequest(BaseModel):
    """Body for POST /api/permission-mode."""

    permission_mode: PermissionModeId


class SetEffortLevelRequest(BaseModel):
    """Body for POST /api/effort-level."""

    effort_level: EffortLevelId


class UpdateSessionPromptRequest(BaseModel):
    """Body for PATCH /api/sessions/current/prompt."""

    session_prompt: str | None = None


class ReconnectMcpServerRequest(BaseModel):
    """Body for POST /api/mcp/reconnect."""

    server_name: str


class ToggleMcpServerRequest(BaseModel):
    """Body for POST /api/mcp/toggle."""

    server_name: str
    enabled: bool


class ResolvePathsRequest(BaseModel):
    """Body for POST /api/files/resolve-paths."""

    candidates: list[str] = []
