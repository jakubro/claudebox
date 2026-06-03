"""Request models — Pydantic schemas for HTTP endpoints."""

from pydantic import BaseModel

from claudebox import EffortLevelId, PermissionModeId


class SendRequest(BaseModel):
    """Body for POST /api/send."""

    prompt: str = ""
    attachments: list[dict] | None = None


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
