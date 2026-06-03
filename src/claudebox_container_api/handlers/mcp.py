"""MCP server management endpoints — reconnect, toggle, status."""

from fastapi import APIRouter

from ._models import ReconnectMcpServerRequest, ToggleMcpServerRequest
from ._shared import SessionDep


router = APIRouter(prefix="/api/mcp")


@router.post("/reconnect")
async def reconnect_mcp_server(svc: SessionDep, body: ReconnectMcpServerRequest):
    """Reconnect a disconnected/failed MCP server and return fresh status."""

    return await svc.reconnect_mcp_server(body.server_name)


@router.post("/toggle")
async def toggle_mcp_server(svc: SessionDep, body: ToggleMcpServerRequest):
    """Toggle an MCP server enabled/disabled and return fresh status."""

    return await svc.toggle_mcp_server(body.server_name, enabled=body.enabled)


@router.get("/status")
async def get_mcp_status(svc: SessionDep):
    """Return current MCP server status."""

    return await svc.get_mcp_status()
