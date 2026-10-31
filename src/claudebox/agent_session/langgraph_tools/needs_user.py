"""needs_user - mark the session as needing the user.

Thin `@tool` binding over `_needs_user.py`, which `runtime_claude.py` also wraps.
"""

from __future__ import annotations

from typing import Annotated

from langchain_core.tools import BaseTool, tool

from ._context import ToolContext
from .._needs_user import (
    NEEDS_USER_DESCRIPTION,
    NEEDS_USER_REPLIES_DESCRIPTION,
    NEEDS_USER_TOOL_NAME,
    needs_user_replies,
    needs_user_reply,
)


def make_needs_user_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the needs_user tool against this session's own directory."""

    session_dir = ctx.config.session_dir

    @tool(NEEDS_USER_TOOL_NAME, description=NEEDS_USER_DESCRIPTION)
    def needs_user(
        reason: str,
        replies: Annotated[list[str] | None, NEEDS_USER_REPLIES_DESCRIPTION] = None,
    ) -> str:
        _ = reason  # read by the projection from the tool-use event, not here
        _, dropped = needs_user_replies(replies)

        return needs_user_reply(session_dir, dropped)

    return [needs_user]


__all__ = ["make_needs_user_tools"]
