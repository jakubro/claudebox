"""needs_user - the tool an agent calls to mark its session as needing the user, in both runtimes.

No claude_agent_sdk or langgraph import belongs here - see GUIDELINES "SDK Containment".
"""

from __future__ import annotations

from pathlib import Path

from ._sibling_sessions import CLAUDEBOX_MCP_SERVER_NAME
from ..constants import SESSION_METADATA_FILE
from ..core.io import read_json


NEEDS_USER_TOOL_NAME = "needs_user"

# Claude prefixes the tool with its MCP server; LangGraph uses the bare name.
NEEDS_USER_CLAUDE_TOOL_NAME = f"mcp__{CLAUDEBOX_MCP_SERVER_NAME}__{NEEDS_USER_TOOL_NAME}"
NEEDS_USER_TOOL_NAMES = frozenset({NEEDS_USER_TOOL_NAME, NEEDS_USER_CLAUDE_TOOL_NAME})

NEEDS_USER_DESCRIPTION = (
    "Mark this session as needing the user, with a one-line reason saying what they must do, "
    "e.g. 'Decide: where retry state lives'. Returns at once and does not end the turn; the "
    "user's next message clears it. Still state the ask itself in your reply."
)

MAX_NEEDS_USER_REPLIES = 5

NEEDS_USER_REPLIES_DESCRIPTION = (
    "Pass whenever the ask has a closed answer set - a decision, an approval, a yes/no: up to "
    f"{MAX_NEEDS_USER_REPLIES} short replies the user is likely to send, e.g. ['Go', 'Hold']. They "
    "show as one-click buttons, the first as the primary and so the recommendation; a click sends "
    "the reply verbatim as the user's message. Omit only for an open-ended ask."
)

_SIGNALLED = "The user has been told this session needs them."

_IGNORED_SPAWNED = (
    "Ignored: this session was started by another session, and only that session reads what you "
    "write - the user is not watching it. End your turn with your question in plain text; the "
    "session that started it receives it and answers."
)

_IGNORED_SIDE_THREAD = "Ignored: a reply thread never signals the user. Ask in your reply instead."


def needs_user_reply(session_dir: Path, dropped: int = 0) -> str:
    """Return the tool's result text; a spawned session or a reply thread is told it was ignored."""

    data = read_json(session_dir / SESSION_METADATA_FILE, default=None) or {}

    if data.get("spawned_from_session_id"):
        return _IGNORED_SPAWNED
    elif data.get("is_side_thread"):
        return _IGNORED_SIDE_THREAD
    elif dropped:
        return (
            f"{_SIGNALLED} Only the first {MAX_NEEDS_USER_REPLIES} replies show; "
            f"{dropped} more were dropped."
        )
    else:
        return _SIGNALLED


def needs_user_replies(raw: object) -> tuple[list[str], int]:
    """Return each string's first non-blank line, deduplicated and capped, and how many were cut."""

    if not isinstance(raw, list):
        return [], 0

    replies = list(dict.fromkeys(line for entry in raw if (line := first_line(entry))))

    return replies[:MAX_NEEDS_USER_REPLIES], max(0, len(replies) - MAX_NEEDS_USER_REPLIES)


def first_line(value: object) -> str | None:
    """Return the first non-blank line of a string, stripped; None for anything else."""

    if not isinstance(value, str):
        return None

    return next((line.strip() for line in value.splitlines() if line.strip()), None)
