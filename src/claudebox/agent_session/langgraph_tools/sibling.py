"""Sibling-session tools - spawn, message, read, stop and list sibling sessions.

Thin `@tool` bindings over `SiblingSessionClient`, which `runtime_claude.py` also wraps.
"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Annotated, Any

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext
from .._sibling_sessions import (
    SESSION_ASK_DESCRIPTION,
    SESSION_ASK_MESSAGE_DESCRIPTION,
    SESSION_ASK_SESSION_ID_DESCRIPTION,
    SESSION_ASK_TOOL_NAME,
    SESSION_LIST_DESCRIPTION,
    SESSION_LIST_TOOL_NAME,
    SESSION_READ_DEFAULT_LIMIT,
    SESSION_READ_DESCRIPTION,
    SESSION_READ_LIMIT_DESCRIPTION,
    SESSION_READ_SESSION_ID_DESCRIPTION,
    SESSION_READ_TOOL_NAME,
    SESSION_SPAWN_DESCRIPTION,
    SESSION_SPAWN_EFFORT_DESCRIPTION,
    SESSION_SPAWN_MODEL_DESCRIPTION,
    SESSION_SPAWN_NAME_DESCRIPTION,
    SESSION_SPAWN_PROMPT_DESCRIPTION,
    SESSION_SPAWN_TOOL_NAME,
    SESSION_STOP_DESCRIPTION,
    SESSION_STOP_SESSION_ID_DESCRIPTION,
    SESSION_STOP_TOOL_NAME,
    SiblingSessionError,
)


def make_sibling_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the five session tools; empty list with no client wired."""

    client = ctx.daemon_services.sessions if ctx.daemon_services else None

    if client is None:
        return []

    @tool(SESSION_SPAWN_TOOL_NAME, description=SESSION_SPAWN_DESCRIPTION)
    async def session_spawn(
        prompt: Annotated[str, SESSION_SPAWN_PROMPT_DESCRIPTION],
        name: Annotated[str | None, SESSION_SPAWN_NAME_DESCRIPTION] = None,
        model: Annotated[str | None, SESSION_SPAWN_MODEL_DESCRIPTION] = None,
        effort: Annotated[str | None, SESSION_SPAWN_EFFORT_DESCRIPTION] = None,
    ) -> dict:
        return await _tool_result(client.spawn(prompt, name=name, model=model, effort=effort))

    @tool(SESSION_ASK_TOOL_NAME, description=SESSION_ASK_DESCRIPTION)
    async def session_ask(
        session_id: Annotated[str, SESSION_ASK_SESSION_ID_DESCRIPTION],
        message: Annotated[str, SESSION_ASK_MESSAGE_DESCRIPTION],
    ) -> dict:
        return await _tool_result(client.ask(session_id, message))

    @tool(SESSION_READ_TOOL_NAME, description=SESSION_READ_DESCRIPTION)
    async def session_read(
        session_id: Annotated[str, SESSION_READ_SESSION_ID_DESCRIPTION],
        limit: Annotated[int, SESSION_READ_LIMIT_DESCRIPTION] = SESSION_READ_DEFAULT_LIMIT,
    ) -> list[dict]:
        return await _tool_result(client.read(session_id, limit))

    @tool(SESSION_STOP_TOOL_NAME, description=SESSION_STOP_DESCRIPTION)
    async def session_stop(
        session_id: Annotated[str, SESSION_STOP_SESSION_ID_DESCRIPTION],
    ) -> dict:
        return await _tool_result(client.stop(session_id))

    @tool(SESSION_LIST_TOOL_NAME, description=SESSION_LIST_DESCRIPTION)
    async def session_list() -> list[dict]:
        return await _tool_result(client.list_siblings())

    return [session_spawn, session_ask, session_read, session_stop, session_list]


async def _tool_result(call: Awaitable[Any]) -> Any:
    try:
        return await call
    except SiblingSessionError as exc:
        raise ToolException(str(exc)) from exc


__all__ = ["make_sibling_tools"]
