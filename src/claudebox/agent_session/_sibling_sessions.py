"""Sibling-session tool logic and texts - spawn, ask, read, stop, list - shared by both runtimes.

No claude_agent_sdk or langgraph import belongs here - see GUIDELINES "SDK Containment".
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import get_args

import httpx

from .catalogs import EffortLevelId
from .orchestration.conversion import serialize_event
from .orchestration.persistence import EventLog
from .orchestration.sibling_turns import SiblingTurnEnd
from ..constants import (
    CONTAINER_SESSIONS_MOUNT,
    SPAWN_SOCKET_CONNECT_TIMEOUT_SECONDS,
    SPAWN_SOCKET_NAME,
    WEB_CONTAINER_PORT,
)
from ..core.logging import get_logger
from ..paths import find_session_dir
from ..workspace import Workspace


_logger = get_logger(__name__)


# Claudebox's own in-process MCP server under Claude, carrying the sibling tools and needs_user -
# the same string the runtime matches on to keep the server out of MCP status reporting.
CLAUDEBOX_MCP_SERVER_NAME = "claudebox"

SESSION_SPAWN_TOOL_NAME = "session_spawn"
SESSION_ASK_TOOL_NAME = "session_ask"
SESSION_READ_TOOL_NAME = "session_read"
SESSION_STOP_TOOL_NAME = "session_stop"
SESSION_LIST_TOOL_NAME = "session_list"

SESSION_READ_CLAUDE_TOOL_NAME = f"mcp__{CLAUDEBOX_MCP_SERVER_NAME}__{SESSION_READ_TOOL_NAME}"
SESSION_LIST_CLAUDE_TOOL_NAME = f"mcp__{CLAUDEBOX_MCP_SERVER_NAME}__{SESSION_LIST_TOOL_NAME}"

SESSION_READ_DEFAULT_LIMIT = 50

EFFORT_LEVELS = get_args(EffortLevelId)

CLAUDEBOX_MCP_INSTRUCTIONS = (
    "The session tools run a second, full session beside this one, which the user sees in the "
    "Sessions panel. A subagent fits a bounded job whose answer is needed inside this turn with no "
    "follow-up; a sibling session fits work that runs long, needs its own context and tools, or "
    "will get follow-ups while this session carries on. Each time a sibling's turn ends, everything "
    "it wrote in that turn arrives here as a message, so never wait, poll or read to learn its "
    "answer. Siblings share the workspace read-write, so give each its own files or branch. List "
    "them with session_list and stop each with session_stop once its work is done. A session "
    "started by another session asks by ending its turn with the question in plain text. In a "
    "reply thread, session_spawn, session_list and session_stop act for the conversation's main "
    "session."
)

SESSION_SPAWN_DESCRIPTION = (
    "Start a second session in this workspace on `prompt` and return at once with its ids. The "
    "sibling is an ordinary session the user sees in the Sessions panel. It gets only `prompt` and a "
    "short brief from claudebox - none of this conversation - so put everything it needs in the "
    "prompt. It shares this workspace read-write and runs under this session's settings bundle and "
    "runtime; `name`, `model` and `effort` are optional. Nesting stops at 3 levels. Each time its "
    "turn ends, everything it wrote in that turn arrives here as a message - there is no need to "
    "wait, poll or read its transcript. Send it more with session_ask, and stop it with "
    "session_stop when its work is done. From a reply thread it is started for the conversation's "
    "main session."
)

SESSION_SPAWN_PROMPT_DESCRIPTION = (
    "The work to hand over, with everything the sibling needs - it sees none of this conversation."
)

SESSION_SPAWN_NAME_DESCRIPTION = "The sibling's name in the Sessions panel, one line."

SESSION_SPAWN_MODEL_DESCRIPTION = (
    "The model the sibling runs on - an alias such as `haiku` or a full model id; "
    "the workspace's default when left out."
)

SESSION_SPAWN_EFFORT_DESCRIPTION = (
    f"The sibling's effort level, one of {', '.join(EFFORT_LEVELS)}; "
    "the workspace's default when left out."
)

SESSION_ASK_DESCRIPTION = (
    "Send a message to a session this one started and return once it is delivered; a stopped "
    "sibling is resumed first. Its reply arrives here as a message when its turn ends. Refused for "
    "any session this one did not start."
)

SESSION_ASK_SESSION_ID_DESCRIPTION = "The id of a session this one started."

SESSION_ASK_MESSAGE_DESCRIPTION = "The message to send."

SESSION_READ_DESCRIPTION = (
    "Read the transcript of any session in this workspace, stopped ones included, as "
    "{role, content} turns, oldest first: the last `limit` turns, 50 by default and at least 1 - a "
    "large `limit` reads it all. Tool calls and their results are left out."
)

SESSION_READ_SESSION_ID_DESCRIPTION = "The id of any session in this workspace."

SESSION_READ_LIMIT_DESCRIPTION = (
    "How many of the latest turns to return, at least 1; 50 by default."
)

SESSION_STOP_DESCRIPTION = (
    "Stop the container of a session this one started, and of every session it started in turn. "
    "The session stays listed as stopped, and session_ask resumes it. Refused for any session this "
    "one did not start, and while a reply thread the user opened runs in a session the stop would "
    "reach. From a reply thread it stops the conversation's main session's siblings."
)

SESSION_STOP_SESSION_ID_DESCRIPTION = "The id of a session this one started."

SESSION_LIST_DESCRIPTION = (
    "List every session this one started, oldest first, each with its id, name and state - "
    "working, idle or stopped - also after this session restarts. From a reply thread it lists the "
    "conversation's main session's siblings."
)

SIBLING_REPLY_NOTE = (
    "Its reply arrives in this conversation as a message when its turn ends; there is no need to "
    "wait, poll or read its transcript."
)

# Both runtimes' question-tool names, so a sibling running either one is recognized the same.
_QUESTION_TOOL_NAMES = frozenset({"AskUserQuestion", "ask_user_question"})

_ANSWER_ENVELOPE = "<response:AskUserQuestion>{text}</response:AskUserQuestion>"

_SEND_TIMEOUT_SECONDS = 30.0

_SETTING_NAMES = {"model": "model", "effort": "effort level"}

_TURN_END_RETRY_DELAYS = (1.0, 2.0, 4.0, 8.0, 15.0, 30.0)


class SiblingSessionError(Exception):
    """A sibling-session tool call failed in a way the calling model can read and act on.

    The message is the whole payload - adapters surface it verbatim as the tool's error text.
    """


class SiblingSessionClient:
    """Spawn, message, read, stop and list the sibling sessions of one agent session.

    Holds no sibling state of its own: the daemon's records name each sibling and where it runs.
    """

    def __init__(self, *, session_id: str, workspace_path: Path) -> None:
        self._session_id = session_id
        self._workspace_path = workspace_path

    async def spawn(
        self,
        prompt: str,
        *,
        name: str | None = None,
        model: str | None = None,
        effort: str | None = None,
    ) -> dict:
        """Start a sibling on `prompt`; a prompt that never arrived is reported, not raised."""

        response = await self.daemon_request(
            SESSION_SPAWN_TOOL_NAME,
            {
                "verb": "spawn",
                "caller_session_id": self._session_id,
                "prompt": prompt,
                "name": name,
                "model": model,
                "effort": effort,
            },
        )
        result = {"session_id": response["session_id"], "container_id": response["container_id"]}
        notes = []

        if response.get("prompt_delivered") is not True:
            result["prompt_delivered"] = False
            notes.append(
                f"Session {name or response['session_id']} was created, but your prompt did not "
                "reach it. Send it again with session_ask, or stop it with session_stop.",
            )
        else:
            notes.append(SIBLING_REPLY_NOTE)

        if unapplied := response.get("unapplied"):
            result["unapplied"] = unapplied
            settings = " and ".join(_SETTING_NAMES.get(key, key) for key in unapplied)
            notes.append(
                f"This runtime cannot set the {settings}; the sibling runs on its default.",
            )

        result["note"] = " ".join(notes)

        return result

    async def ask(self, session_id: str, message: str) -> dict:
        """Deliver `message` to a sibling this session started, resuming it first when stopped."""

        resumed = await self.daemon_request(
            SESSION_ASK_TOOL_NAME,
            {"verb": "resume", "caller_session_id": self._session_id, "session_id": session_id},
        )
        prompt = _ANSWER_ENVELOPE.format(text=message) if self._is_asking(session_id) else message
        base_url = f"http://{resumed['container_id']}:{WEB_CONTAINER_PORT}"

        try:
            async with self._build_http_client() as client:
                response = await client.post(
                    f"{base_url}/api/send",
                    params={"session_id": session_id},
                    json={"prompt": prompt},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise SiblingSessionError(
                f"session_ask: sibling {session_id!r} is unreachable ({exc})",
            ) from exc

        return {
            "session_id": session_id,
            "delivered": True,
            "resumed": bool(resumed.get("resumed")),
            "note": SIBLING_REPLY_NOTE,
        }

    async def read(
        self,
        session_id: str,
        limit: int = SESSION_READ_DEFAULT_LIMIT,
    ) -> list[dict[str, str]]:
        """Read a session's transcript as `{role, content}` turns, oldest first, the last `limit`.

        A file read through the bind-mounted sessions tree - it works while the session is stopped.
        """

        if limit < 1:
            raise SiblingSessionError("session_read: limit must be at least 1")

        events = self._read_events(session_id)

        if events is None:
            raise SiblingSessionError(f"session_read: no session found for {session_id!r}")

        return self._turns_from_events(events, limit)

    async def stop(self, session_id: str) -> dict:
        """Stop a sibling this session started, and every session below it."""

        response = await self.daemon_request(
            SESSION_STOP_TOOL_NAME,
            {"verb": "stop", "caller_session_id": self._session_id, "session_id": session_id},
        )

        return {"session_id": response["session_id"], "state": response["state"]}

    async def list_siblings(self) -> list[dict]:
        """Every session this one started, oldest first, with its name and state."""

        response = await self.daemon_request(
            SESSION_LIST_TOOL_NAME,
            {"verb": "list", "caller_session_id": self._session_id},
        )

        return response["sessions"]

    @classmethod
    async def daemon_request(cls, tool: str, request: dict) -> dict:
        """Send one request to the daemon's spawn socket; a refusal raises SiblingSessionError."""

        try:
            response = await cls._exchange(request)
        except OSError as exc:
            # An unbound listener leaves nothing on the path - dialing it fails immediately in
            # practice; the timeout is a backstop, not the common case.
            raise SiblingSessionError(
                f"{tool}: could not reach the daemon's spawn socket ({exc})",
            ) from exc

        if response is None:
            raise SiblingSessionError(f"{tool}: the daemon closed the connection with no reply")

        if "error" in response:
            raise SiblingSessionError(cls._format_refusal(tool, request, response))

        return response

    @classmethod
    async def _exchange(cls, request: dict) -> dict | None:
        reader, writer = await asyncio.wait_for(
            cls._open_spawn_socket(CONTAINER_SESSIONS_MOUNT / SPAWN_SOCKET_NAME),
            timeout=SPAWN_SOCKET_CONNECT_TIMEOUT_SECONDS,
        )

        try:
            writer.write((json.dumps(request) + "\n").encode())
            await writer.drain()
            writer.write_eof()

            line = await reader.readline()
        finally:
            writer.close()

        return json.loads(line) if line else None

    @staticmethod
    def _format_refusal(tool: str, request: dict, response: dict) -> str:
        error = response["error"]
        target = response.get("session_id") or request.get("session_id")

        if error == "spawn_depth_exceeded":
            return (
                f"{tool}: recursion cap ({response.get('cap')}) reached at depth "
                f"{response.get('depth')}; refusing to spawn another nested session."
            )
        elif error == "not_own_sibling":
            return f"{tool}: {target!r} was not started by this session"
        elif error == "hosts_your_thread":
            return (
                f"{tool}: refused - the user's reply thread {target!r} runs in a session this stop "
                "would reach; nothing was stopped"
            )
        elif error == "invalid_name":
            return f"{tool}: name must be a single non-blank line"
        elif error == "invalid_model":
            return f"{tool}: model must be a non-blank name without spaces"
        elif error == "invalid_effort":
            return f"{tool}: effort must be one of {', '.join(EFFORT_LEVELS)}"
        elif error == "port_not_open":
            return f"{tool}: port {request.get('port')} is not open"
        elif error == "invalid_port":
            return f"{tool}: the port must be from 1 to 65535"
        else:
            return f"{tool}: refused ({error})"

    @staticmethod
    async def _open_spawn_socket(socket_path: Path):
        """Isolated for tests to substitute a fake pair of streams."""

        return await asyncio.open_unix_connection(path=str(socket_path))

    @staticmethod
    def _build_http_client() -> httpx.AsyncClient:
        """Isolated for tests to inject an `httpx.MockTransport` in place of a real socket."""

        return httpx.AsyncClient(timeout=_SEND_TIMEOUT_SECONDS)

    def _read_events(self, session_id: str) -> list | None:
        if find_session_dir(self._workspace_path, session_id) is None:
            return None

        workspace = Workspace(self._workspace_path)

        return list(EventLog(session_id=session_id, workspace=workspace).read_all())

    def _is_asking(self, session_id: str) -> bool:
        for event in reversed(self._read_events(session_id) or []):
            if event.parent_tool_use_id is not None:
                continue
            elif event.type == "user" and event.is_human:
                return False
            elif event.subtype == "tool_use" and event.tool_name in _QUESTION_TOOL_NAMES:
                return True

        return False

    @staticmethod
    def _turns_from_events(events, limit: int) -> list[dict[str, str]]:
        """Segment persisted events into user/assistant turns."""

        turns: list[dict[str, str]] = []

        for raw in events:
            event = serialize_event(raw)

            if event.get("is_human") and event.get("content"):
                turns.append({"role": "user", "content": event["content"]})
            elif (
                event.get("type") == "assistant"
                and event.get("subtype") == "text"
                and event.get("content")
            ):
                if turns and turns[-1]["role"] == "assistant":
                    turns[-1]["content"] += event["content"]
                else:
                    turns.append({"role": "assistant", "content": event["content"]})

        return turns[-limit:]


async def report_sibling_turn_end(session_id: str, turn: SiblingTurnEnd) -> None:
    """Hand a spawned session's turn end to the daemon for its parent, never raising.

    Retried for about a minute while the parent is unreachable, then dropped and logged.
    """

    request = {
        "verb": "turn_ended",
        "caller_session_id": session_id,
        "delivery_id": turn.delivery_id,
        "outcome": turn.outcome,
        "text": turn.text,
    }
    context = {"session_id": session_id, "delivery_id": turn.delivery_id, "outcome": turn.outcome}

    for delay in (*_TURN_END_RETRY_DELAYS, None):
        try:
            response = await SiblingSessionClient._exchange(request)
        except OSError as exc:
            response, failure = None, str(exc)
        else:
            failure = (response or {}).get("error", "no reply")

        if response is not None and response.get("error") != "parent_unreachable":
            if "error" in response:
                _logger.error("Sibling turn end refused", error=response["error"], **context)

            return

        if delay is None:
            _logger.error(
                "Sibling turn end dropped - its parent stayed unreachable",
                error=failure,
                **context,
            )

            return

        await asyncio.sleep(delay)
