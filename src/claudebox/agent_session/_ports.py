"""Ports an agent asks to open to the user's computer - the texts and logic both runtimes share.

No claude_agent_sdk or langgraph import belongs here - see GUIDELINES "SDK Containment".
"""

from __future__ import annotations

from pathlib import Path

from ._sibling_sessions import CLAUDEBOX_MCP_SERVER_NAME, SiblingSessionClient
from ..constants import SESSION_METADATA_FILE
from ..core.io import read_json


PORT_OPEN_TOOL_NAME = "port_open"
PORT_CLOSE_TOOL_NAME = "port_close"

PORT_OPEN_CLAUDE_TOOL_NAME = f"mcp__{CLAUDEBOX_MCP_SERVER_NAME}__{PORT_OPEN_TOOL_NAME}"
PORT_CLOSE_CLAUDE_TOOL_NAME = f"mcp__{CLAUDEBOX_MCP_SERVER_NAME}__{PORT_CLOSE_TOOL_NAME}"
PORT_OPEN_TOOL_NAMES = frozenset({PORT_OPEN_TOOL_NAME, PORT_OPEN_CLAUDE_TOOL_NAME})

PORT_OPEN_DESCRIPTION = (
    "Ask the user to make one of this session's TCP ports reachable from their computer while the "
    "session keeps running - a dev server, a preview. A card in the conversation asks them to approve "
    "or reject it, so end your turn after calling this: their answer - the address to use, or that "
    "they rejected it - arrives as their next message. An opened port stays open until port_close "
    "closes it, and opens again each time this session runs. Only a session the user started can ask."
)

PORT_CLOSE_DESCRIPTION = (
    "Close a port this session opened to the user's computer; it stays closed, also when this "
    "session runs again."
)

PORT_ARGUMENT_DESCRIPTION = "The port inside this session, from 1 to 65535."

PORT_REFUSAL_PREFIX = "Not asked:"


def port_open_reply(session_dir: Path, port: int) -> str:
    """Return the tool's result text: the ask is made, or it is refused and the agent told where to ask."""

    data = read_json(session_dir / SESSION_METADATA_FILE, default=None) or {}

    if not is_port(port):
        return f"{PORT_REFUSAL_PREFIX} the port must be from 1 to 65535."
    elif data.get("spawned_from_session_id"):
        return (
            f"{PORT_REFUSAL_PREFIX} a session another session started cannot open a port to the "
            "user's computer. Ask the session that started it to open one in its own session instead."
        )
    elif data.get("is_side_thread"):
        return (
            f"{PORT_REFUSAL_PREFIX} a reply thread cannot open a port. Ask in the conversation's main "
            "session instead."
        )
    else:
        return (
            f"Asked the user to open port {port} to their computer. End your turn now; their "
            "answer arrives as their next message."
        )


async def close_port(session_id: str, port: int) -> dict:
    """Close a port the session opened; a port it never opened raises SiblingSessionError."""

    await SiblingSessionClient.daemon_request(
        PORT_CLOSE_TOOL_NAME,
        {"verb": "port_close", "caller_session_id": session_id, "port": port},
    )

    return {"port": port, "state": "closed"}


def is_port(value: object) -> bool:
    """Whether `value` is a TCP port number, 1 to 65535."""

    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 65535


def port_answer(port: int, address: str | None) -> str:
    """The user's answer to a port request, as the message the agent receives."""

    if address is None:
        body = f"Rejected: port {port} stays closed."
    else:
        body = f"Approved: port {port} is reachable at {address}."

    return f'<response:port_open port="{port}">{body}</response:port_open>'
