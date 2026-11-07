"""port_open / port_close - ask the user to open one of the session's ports, and close it again.

Thin `@tool` bindings over `_ports.py`, which `runtime_claude.py` also wraps.
"""

from __future__ import annotations

from typing import Annotated

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext
from .._ports import (
    PORT_ARGUMENT_DESCRIPTION,
    PORT_CLOSE_DESCRIPTION,
    PORT_CLOSE_TOOL_NAME,
    PORT_OPEN_DESCRIPTION,
    PORT_OPEN_TOOL_NAME,
    close_port,
    port_open_reply,
)
from .._sibling_sessions import SiblingSessionError


def make_port_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind port_open and port_close against this session."""

    session_dir = ctx.config.session_dir
    session_id = ctx.config.session_id or ""

    @tool(PORT_OPEN_TOOL_NAME, description=PORT_OPEN_DESCRIPTION, return_direct=True)
    def port_open(port: Annotated[int, PORT_ARGUMENT_DESCRIPTION]) -> str:
        return port_open_reply(session_dir, port)

    @tool(PORT_CLOSE_TOOL_NAME, description=PORT_CLOSE_DESCRIPTION)
    async def port_close(port: Annotated[int, PORT_ARGUMENT_DESCRIPTION]) -> dict:
        try:
            return await close_port(session_id, port)
        except SiblingSessionError as exc:
            raise ToolException(str(exc)) from exc

    return [port_open, port_close]


__all__ = ["make_port_tools"]
