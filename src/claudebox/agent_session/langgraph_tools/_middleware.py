"""ClaudeboxToolHookMiddleware - fires PreToolUse / PostToolUse around every tool.

LangGraph v1 `AgentMiddleware.awrap_tool_call` is the async seam between the LLM-emitted tool
call and the @tool function. Composing this middleware first in the runtime's middleware list
makes it outermost, so its observations cover retry/modification logic added by inner middleware.

If the handler raises, the post-callback still fires with `is_error=True` and a None result
before the exception propagates - consumers always observe a matched pre/post pair.

A `ToolException` converts to an error `ToolMessage` here instead of re-raising, since `ToolNode`
re-raises everything by default (ending the turn instead of letting the model recover, same as
the Claude runtime). Any other exception - a genuine bug, or a `GraphInterrupt` - still re-raises.
"""

import json
import time
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langchain_core.tools import ToolException
from langgraph.types import Command

from ._context import ToolContext
from ..hooks import PostToolUsePayload, PreToolUsePayload


class ClaudeboxToolHookMiddleware(AgentMiddleware):
    """AgentMiddleware that bridges tool invocations to HookCallbacks."""

    def __init__(self, ctx: ToolContext) -> None:
        super().__init__()
        self._hooks = ctx.hooks
        self._logger = ctx.logger

    async def awrap_tool_call(self, request, handler):
        """Observe the tool call: pre -> handler -> post; always emit a matched pair."""

        pre_payload = self._make_pre_payload(request)

        if self._hooks.on_pre_tool_use is not None:
            await self._hooks.on_pre_tool_use(pre_payload)

        started = time.monotonic()

        try:
            result = await handler(request)
        except ToolException as exc:
            result = ToolMessage(
                content=str(exc),
                tool_call_id=request.tool_call.get("id") or "",
                status="error",
            )
        except Exception:
            duration_ms = int((time.monotonic() - started) * 1000)
            post_payload = self._make_post_payload(
                request,
                result=None,
                is_error=True,
                duration_ms=duration_ms,
            )

            if self._hooks.on_post_tool_use is not None:
                await self._hooks.on_post_tool_use(post_payload)

            raise

        duration_ms = int((time.monotonic() - started) * 1000)
        post_payload = self._make_post_payload(
            request,
            result=result,
            is_error=_is_error_result(result),
            duration_ms=duration_ms,
        )

        if self._hooks.on_post_tool_use is not None:
            await self._hooks.on_post_tool_use(post_payload)

        return result

    @staticmethod
    def _make_pre_payload(request) -> PreToolUsePayload:
        """Project the request's tool_call dict into the typed pre payload."""

        call = request.tool_call

        return PreToolUsePayload(
            tool_use_id=call.get("id") or "",
            tool_name=call.get("name") or "",
            tool_input=call.get("args") or {},
        )

    @staticmethod
    def _make_post_payload(
        request,
        *,
        result: Any,
        is_error: bool,
        duration_ms: int,
    ) -> PostToolUsePayload:
        """Project the tool call + handler result into the typed post payload."""

        call = request.tool_call

        return PostToolUsePayload(
            tool_use_id=call.get("id") or "",
            tool_name=call.get("name") or "",
            tool_input=call.get("args") or {},
            tool_use_result=_extract_result_content(result),
            is_error=is_error,
            duration_ms=duration_ms,
        )


def content_reports_nonzero_exit(content: Any) -> bool:
    """True when tool-result content is a JSON object carrying a non-zero `exit_code`.

    `bash` reports failure this way instead of raising, and `ToolNode` JSON-serializes that dict
    into the message content while still marking it `status="success"` - so this parses content
    back rather than trusting `status`. Shared with `LangGraphRuntime._tool_result_event`.
    """

    if isinstance(content, dict):
        payload: Any = content
    elif isinstance(content, str):
        try:
            payload = json.loads(content)
        except ValueError:
            return False
    else:
        return False

    if not isinstance(payload, dict):
        return False

    exit_code = payload.get("exit_code")

    return isinstance(exit_code, int) and exit_code != 0


def _is_error_result(result: Any) -> bool:
    """Derive is_error from a handler return value."""

    if not isinstance(result, ToolMessage):
        return False

    return getattr(result, "status", "success") == "error" or content_reports_nonzero_exit(
        result.content,
    )


def _extract_result_content(result: Any) -> str | dict[str, Any] | None:
    """Project the handler result into the payload's `tool_use_result` slot."""

    if result is None:
        return None
    elif isinstance(result, ToolMessage):
        content = result.content

        if isinstance(content, str):
            return content
        elif isinstance(content, dict):
            return content
        elif isinstance(content, list):
            return str(content)
        else:
            return str(content)
    elif isinstance(result, Command):
        return None
    else:
        return str(result)
