"""Claude Code statusline decorator and request type."""

import functools
import inspect
import sys
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

from .request import Request
from ..core import serialization


class StatuslineRequest(Request):
    """Request context for statusline with model, cost, and timing data.

    Attributes:
        data: The raw statusline payload dictionary from Claude Code.
        model: Display name of the current model (e.g., 'Claude Sonnet 4').
        output_style: Name of the current output style (e.g., 'concise').
        total_cost: Total cost in USD for the conversation so far.
        conversation_duration: Total wall-clock time since conversation started.
        api_duration: Total time spent waiting for API responses.
        current_dir: Absolute path to the current working directory.
        relative_dir: Current directory path relative to the workspace root.
    """

    def __init__(self, data: dict):
        super().__init__(session_id=data["session_id"])

        self.data = data

        self.model = data["model"]["display_name"]
        self.output_style = data["output_style"]["name"]

        self.total_cost = data["cost"]["total_cost_usd"]

        total_duration_ms = 1000 * int(data["cost"]["total_duration_ms"] / 1000)
        self.conversation_duration = timedelta(milliseconds=total_duration_ms)

        total_api_duration_ms = 1000 * int(data["cost"]["total_api_duration_ms"] / 1000)
        self.api_duration = timedelta(milliseconds=total_api_duration_ms)

        self.current_dir = Path(data["workspace"]["current_dir"])
        self.relative_dir = self.current_dir.relative_to(self.workspace.path)


def statusline(__fn, /) -> Callable:
    """Decorator for Claude Code statusline functions.

    Reads JSON from stdin, creates StatuslineRequest, calls decorated function
    with optional 'request' kwarg, and prints returned string to stdout.

    Example:
        @statusline
        def my_statusline(request: StatuslineRequest) -> str:
            return f"{request.model} | ${request.total_cost:.4f}"
    """

    keys = list(inspect.signature(__fn).parameters.keys())

    @functools.wraps(__fn)
    def wrapper(data: dict | None = None):
        request = None
        try:
            data = data or serialization.load(sys.stdin)
            request = StatuslineRequest(data)

            kwargs = {}

            if "request" in keys:
                kwargs["request"] = request

            response = __fn(**kwargs)
            print(response)
        except Exception:
            if request:
                request.logger.exception("Unhandled exception in statusline")
            raise

    return wrapper
