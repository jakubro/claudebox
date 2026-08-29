"""Sibling-session tool logic - spawn, ask, read - shared verbatim by both runtimes.

No claude_agent_sdk or langgraph import belongs here - see GUIDELINES "SDK Containment".
"""

import asyncio
import json
from pathlib import Path

import httpx

from .orchestration.conversion import serialize_event
from .orchestration.persistence import EventLog
from ..constants import (
    CONTAINER_SESSIONS_MOUNT,
    SPAWN_SOCKET_CONNECT_TIMEOUT_SECONDS,
    SPAWN_SOCKET_NAME,
    WEB_CONTAINER_PORT,
)
from ..paths import find_session_dir
from ..workspace import Workspace


# The in-process MCP server name under Claude, and this module's own identity for logging -
# the same string the runtime matches on to keep the server out of MCP status reporting.
SIBLING_MCP_SERVER_NAME = "claudebox"

# Bounds the ask-and-wait round trip (connect, send, stream until settled) - a sibling stuck in
# a long-running tool call must eventually report back rather than hang the parent's own turn.
SIBLING_ASK_TIMEOUT_SECONDS = 300.0

# Both runtimes' question-tool names, so a sibling running either one is recognized the same.
_QUESTION_TOOL_NAMES = frozenset({"AskUserQuestion", "ask_user_question"})

_ANSWER_ENVELOPE = "<response:AskUserQuestion>{text}</response:AskUserQuestion>"


class SiblingSessionError(Exception):
    """A sibling-session tool call failed in a way the calling model can read and act on.

    The message is the whole payload - adapters surface it verbatim as the tool's error text.
    """


class SiblingSessionClient:
    """Spawn/ask/read sibling sessions for one agent session.

    `_containers` maps siblings this instance spawned; `_asking` holds those awaiting an answer.
    """

    def __init__(self, *, session_id: str, workspace_path: Path) -> None:
        self._session_id = session_id
        self._workspace_path = workspace_path
        self._containers: dict[str, str] = {}
        self._asking: set[str] = set()

    async def spawn(self, prompt: str) -> dict[str, str]:
        """Spawn a sibling session seeded with `prompt`; returns its session and container ids."""

        socket_path = CONTAINER_SESSIONS_MOUNT / SPAWN_SOCKET_NAME
        request = {"verb": "spawn", "caller_session_id": self._session_id, "prompt": prompt}

        try:
            reader, writer = await asyncio.wait_for(
                self._open_spawn_socket(socket_path),
                timeout=SPAWN_SOCKET_CONNECT_TIMEOUT_SECONDS,
            )
        except OSError as exc:
            # An unbound listener leaves nothing on the path - dialing it fails immediately in
            # practice; the timeout is a backstop, not the common case.
            raise SiblingSessionError(
                f"session_spawn: could not reach the daemon's spawn socket ({exc})",
            ) from exc

        try:
            writer.write((json.dumps(request) + "\n").encode())
            await writer.drain()
            writer.write_eof()

            line = await reader.readline()
        finally:
            writer.close()

        if not line:
            raise SiblingSessionError(
                "session_spawn: the daemon closed the connection with no reply",
            )

        response = json.loads(line)

        if "error" in response:
            raise SiblingSessionError(self._format_spawn_error(response))

        self._containers[response["session_id"]] = response["container_id"]

        return {"session_id": response["session_id"], "container_id": response["container_id"]}

    @staticmethod
    def _format_spawn_error(response: dict) -> str:
        """Name the cap and the depth reached, so the model reads a bound and stops retrying."""

        if response["error"] == "spawn_depth_exceeded":
            return (
                f"session_spawn: recursion cap ({response.get('cap')}) reached at depth "
                f"{response.get('depth')}; refusing to spawn another nested session."
            )

        return f"session_spawn: refused ({response['error']})"

    @staticmethod
    async def _open_spawn_socket(socket_path: Path):
        """Isolated for tests to substitute a fake pair of streams."""

        return await asyncio.open_unix_connection(path=str(socket_path))

    @staticmethod
    def _build_http_client() -> httpx.AsyncClient:
        """Isolated for tests to inject an `httpx.MockTransport` in place of a real socket."""

        return httpx.AsyncClient(timeout=SIBLING_ASK_TIMEOUT_SECONDS)

    async def ask(self, session_id: str, message: str) -> dict[str, str]:
        """Ask a sibling something and wait for its turn to settle.

        Subscribes before sending, so an earlier turn's replayed result can never settle this one.
        """

        container_id = self._containers.get(session_id)

        if container_id is None:
            raise SiblingSessionError(
                f"session_ask: unknown sibling {session_id!r} - spawn it, or ask it once "
                "before following up",
            )

        prompt = _ANSWER_ENVELOPE.format(text=message) if session_id in self._asking else message
        base_url = f"http://{container_id}:{WEB_CONTAINER_PORT}"

        try:
            async with (
                self._build_http_client() as client,
                client.stream(
                    "GET",
                    f"{base_url}/api/stream",
                    params={"replay": "false"},
                ) as stream,
            ):
                stream.raise_for_status()

                send_response = await client.post(f"{base_url}/api/send", json={"prompt": prompt})
                send_response.raise_for_status()

                return await self._consume_until_settled(stream, session_id)
        except httpx.HTTPError as exc:
            raise SiblingSessionError(
                f"session_ask: sibling {session_id!r} is unreachable ({exc})",
            ) from exc

    async def _consume_until_settled(
        self,
        stream: httpx.Response,
        session_id: str,
    ) -> dict[str, str]:
        """Read SSE frames until the sibling's turn asks a question or produces a result."""

        reply_text = ""
        data_lines: list[str] = []

        async for line in stream.aiter_lines():
            if line == "":
                event = self._parse_sse_data(data_lines)
                data_lines = []

                if event is None:
                    continue

                settled = self._apply_event(event, session_id, reply_text)

                if settled is not None:
                    return settled

                if event.get("type") == "assistant" and event.get("subtype") == "text":
                    reply_text += event.get("content") or ""

                continue

            if line.startswith("data:"):
                data_lines.append(line[len("data:") :].lstrip())

        raise SiblingSessionError(f"session_ask: {session_id}'s stream ended with no result")

    def _apply_event(self, event: dict, session_id: str, reply_text: str) -> dict[str, str] | None:
        """Return a settled result if `event` ends the wait, else None to keep consuming."""

        if event.get("type") == "assistant" and event.get("tool_name") in _QUESTION_TOOL_NAMES:
            questions = (event.get("tool_input") or {}).get("questions") or []
            self._asking.add(session_id)

            return {"state": "asking", "text": json.dumps(questions)}
        elif event.get("type") == "result":
            self._asking.discard(session_id)

            return {"state": "replied", "text": reply_text}
        else:
            return None

    @staticmethod
    def _parse_sse_data(data_lines: list[str]) -> dict | None:
        """Join a frame's `data:` lines and parse as JSON; None on an empty or malformed frame."""

        if not data_lines:
            return None

        try:
            return json.loads("\n".join(data_lines))
        except ValueError:
            return None

    async def read(self, session_id: str, limit: int = 50) -> list[dict[str, str]]:
        """Read a sibling's transcript as `{role, content}` turns, oldest first, capped at `limit`.

        A file read through the bind-mounted sessions tree - it works while the sibling is stopped.
        """

        session_dir = find_session_dir(self._workspace_path, session_id)

        if session_dir is None:
            raise SiblingSessionError(f"session_read: no session found for {session_id!r}")

        workspace = Workspace(self._workspace_path)
        events = EventLog(session_id=session_id, workspace=workspace).read_all()

        return self._turns_from_events(events, limit)

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

        return turns[-limit:] if limit > 0 else turns
