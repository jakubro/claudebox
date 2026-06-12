"""ClaudeboxToolHookMiddleware - fires PreToolUse / PostToolUse around every tool.

LangGraph v1 `AgentMiddleware.awrap_tool_call` is the async seam: the middleware
sits between the LLM-emitted tool call and the @tool function. Composing this
middleware first in the runtime's middleware list makes it the outermost layer,
so its observations cover any retry / modification logic added by inner
middleware.

The pre-callback fires before the handler runs, then the handler executes, then
the post-callback fires with the result, duration, and an `is_error` flag. If
the handler raises, the post-callback STILL fires with `is_error=True` and a
None result before the exception is re-raised - consumers always observe a
matched pair.
"""

import time
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
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
        except Exception:
            duration_ms = int((time.monotonic() - started) * 1000)
            post_payload = self._make_post_payload(
                request, result=None, is_error=True, duration_ms=duration_ms
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
        request, *, result: Any, is_error: bool, duration_ms: int
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


def _is_error_result(result: Any) -> bool:
    """Derive is_error from a handler return value."""

    if isinstance(result, ToolMessage):
        return getattr(result, "status", "success") == "error"

    return False


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
