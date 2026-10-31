"""A stand-in for the agent CLI: echoes each message under its uuid (a fresh one when none is given),
answers it, announces the session only after its first message, and writes the CLI's transcript."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from claude_agent_sdk import AssistantMessage, ResultMessage, SystemMessage, UserMessage
from claude_agent_sdk.types import TextBlock

from claudebox.workspace import Workspace


PROJECT = "-workspace"


class ScriptedCli:
    def __init__(self, options):
        self._session_id = options.extra_args.get("session-id") or options.extra_args["resume"]
        self._out: asyncio.Queue = asyncio.Queue()
        self._started = False
        self._query = None
        projects = Workspace(start_dir=Path(options.cwd)).sdk_projects_root
        self.transcript = projects / PROJECT / f"{self._session_id}.jsonl"
        self.transcript.parent.mkdir(parents=True, exist_ok=True)

    async def connect(self) -> None:
        pass

    async def disconnect(self) -> None:
        pass

    async def query(self, prompt) -> None:
        if isinstance(prompt, str):
            message_uuid, content = str(uuid.uuid4()), prompt
        else:
            (message,) = [m async for m in prompt]
            message_uuid = message.get("uuid") or str(uuid.uuid4())
            content = message["message"]["content"]

        with self.transcript.open("a") as f:
            f.write(json.dumps({"type": "user", "uuid": message_uuid, "message": content}) + "\n")

        if not self._started:
            self._started = True
            await self._out.put(
                SystemMessage(subtype="init", data={"session_id": self._session_id, "uuid": "i"}),
            )

        echoed: str | list = (
            content
            if isinstance(content, str)
            else [TextBlock(text=b["text"]) for b in content if b.get("type") == "text"]
        )
        await self._out.put(UserMessage(echoed, uuid=message_uuid))

        for message in self.reply():
            await self._out.put(message)

    def reply(self) -> list:
        """Return what the CLI streams after the echo; a subclass scripts its own turn here."""

        return [AssistantMessage(content=[TextBlock(text="ok")], model="m"), self.result("ok")]

    def result(self, text: str, *, is_error: bool = False) -> ResultMessage:
        """Return the turn-ending result carrying `text`."""

        return ResultMessage(
            subtype="success",
            duration_ms=1,
            duration_api_ms=1,
            is_error=is_error,
            num_turns=1,
            session_id=self._session_id,
            result=text,
        )

    async def receive_response(self) -> AsyncIterator:
        while True:
            message = await self._out.get()
            yield message

            if isinstance(message, ResultMessage):
                return
