"""Sibling-session tools - spawn a sibling session, ask it something and wait, read its transcript.

Thin `@tool` bindings over `SiblingSessionClient`, which `runtime_claude.py` also wraps.
"""

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext
from .._sibling_sessions import SiblingSessionError


def make_sibling_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the session_spawn/session_ask/session_read tools; empty list with no client wired."""

    client = ctx.daemon_services.sessions if ctx.daemon_services else None

    if client is None:
        return []

    @tool
    async def session_spawn(prompt: str) -> dict:
        """Spawn a sibling session seeded with `prompt`; returns its session and container ids.

        The sibling is an ordinary session - it appears in the Sessions and Containers panels
        immediately, and either side can be opened in a tab at any time.
        """

        try:
            return await client.spawn(prompt)
        except SiblingSessionError as exc:
            raise ToolException(str(exc)) from exc

    @tool
    async def session_ask(session_id: str, message: str) -> dict:
        """Ask a sibling session something and wait for its turn to settle.

        Returns `{"state": "replied", "text": "..."}` once it answers, or
        `{"state": "asking", "text": "..."}` if it ends by asking a question instead - call this
        again with the answer to resume it. Fails with a readable error if the sibling is
        unreachable (e.g. its container was stopped).
        """

        try:
            return await client.ask(session_id, message)
        except SiblingSessionError as exc:
            raise ToolException(str(exc)) from exc

    @tool
    async def session_read(session_id: str, limit: int = 50) -> list[dict]:
        """Read a sibling session's transcript as `{role, content}` turns, oldest first.

        Works even while the sibling's container is stopped - reads its persisted log directly,
        no network call.
        """

        try:
            return await client.read(session_id, limit)
        except SiblingSessionError as exc:
            raise ToolException(str(exc)) from exc

    return [session_spawn, session_ask, session_read]


__all__ = ["make_sibling_tools"]
