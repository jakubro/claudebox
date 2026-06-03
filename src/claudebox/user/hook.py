"""Claude Code hook decorator and request/response types."""

import functools
import inspect
import os
import sys
import textwrap
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .request import Request
from ..core import serialization


class HookRequest(Request):
    """Request context for hook invocations with parsed hook data.

    Attributes:
        data: The raw hook payload dictionary from Claude Code.
        hook_event_name: Name of the hook event (e.g., 'PreToolUse', 'Stop').
        transcript_path: Path to the session transcript file.
    """

    def __init__(self, data: dict):
        super().__init__(session_id=data["session_id"])

        self.data = data
        self.hook_event_name = data["hook_event_name"]
        self.transcript_path = Path(data["transcript_path"])


class HookResponse:
    """Builder for hook JSON response with context, messages, and stop control.

    Supports adding context for the model, displaying messages to the user,
    setting environment variables, and stopping execution. Serialized to JSON
    via __str__.
    """

    def __init__(self, request: HookRequest):
        self._request = request
        self._message = []
        self._context = []
        self._stop = None
        self._stop_reason = None
        self._decision = None
        self._decision_reason = None

    def add_to_context(self, context: str) -> None:
        """Add text to additionalContext in hook response."""

        self._context.append(context)

    @classmethod
    def add_to_env(cls, name: str, value: str) -> None:
        """Export environment variable via CLAUDE_ENV_FILE."""

        env_file = os.environ["CLAUDE_ENV_FILE"]
        with open(env_file, "a") as f:
            f.write(f"export {name}={value}\n")

    def show(self, message: str) -> None:
        """Add text to systemMessage shown to user."""

        self._message.append(message)

    def stop(self, reason: str | None = None) -> None:
        """Signal Claude to stop processing."""

        self._stop = True
        self._stop_reason = reason

    def block(self, reason: str) -> None:
        """Block the current event with a reason."""

        self._decision = "block"
        self._decision_reason = reason

    def __str__(self) -> str:
        """Serialize response to JSON string for Claude Code consumption."""

        obj: dict[str, Any] = {}

        if self._request.hook_event_name not in ("Stop", "SubagentStop", "SessionEnd"):
            out = obj.setdefault("hookSpecificOutput", {})
            out["hookEventName"] = self._request.hook_event_name

        if self._stop:
            obj["continue"] = False
            obj["stopReason"] = self._stop_reason

        if self._message:
            obj["systemMessage"] = self._combine(self._message)

        if self._decision:
            obj["decision"] = self._decision
            obj["reason"] = self._decision_reason

        if self._context:
            out = obj.setdefault("hookSpecificOutput", {})
            out["additionalContext"] = self._combine(self._context)

        return serialization.dumps(obj)

    @classmethod
    def _combine(cls, messages: list[str] | None = None) -> str:
        """Join messages with double newlines after dedenting each."""

        return "\n\n".join(textwrap.dedent(s) for s in messages or [])


def hook(__fn, /) -> Callable:
    """Decorator for Claude Code hook functions.

    Reads JSON from stdin, creates HookRequest/HookResponse, calls the decorated
    function with 'request' and/or 'response' kwargs based on signature, and
    prints the response JSON.

    Example:
        @hook
        def my_hook(request: HookRequest, response: HookResponse):
            response.add_to_context("Additional context for Claude")
    """

    keys = list(inspect.signature(__fn).parameters.keys())

    @functools.wraps(__fn)
    def wrapper(data: dict | None = None):
        request = None
        try:
            data = data or serialization.load(sys.stdin)
            request = HookRequest(data)
            response = HookResponse(request)

            kwargs = {}

            if "request" in keys:
                kwargs["request"] = request

            if "response" in keys:
                kwargs["response"] = response

            request.logger.debug(
                "Received %s hook request: %s",
                request.hook_event_name,
                request.data,
            )

            __fn(**kwargs)

            request.logger.debug(
                "Sending %s hook response: %s",
                request.hook_event_name,
                request.data,
            )

            print(response)
        except Exception:
            if request:
                request.logger.exception("Unhandled exception in %s hook", request.hook_event_name)
            raise

    return wrapper
