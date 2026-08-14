"""ClaudeboxToolHookMiddleware unit tests."""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import ToolMessage
from langchain_core.tools import ToolException

from claudebox.agent_session.hooks import (
    HookCallbacks,
    PostToolUsePayload,
    PreToolUsePayload,
)
from claudebox.agent_session.langgraph_tools._middleware import (
    ClaudeboxToolHookMiddleware,
    content_reports_nonzero_exit,
)


@dataclass
class _FakeRequest:
    """Minimal ToolCallRequest stand-in."""

    tool_call: dict[str, Any]


def _make_middleware(hooks: HookCallbacks, tool_ctx) -> ClaudeboxToolHookMiddleware:
    from dataclasses import replace

    swap_ctx = replace(tool_ctx, hooks=hooks)

    return ClaudeboxToolHookMiddleware(swap_ctx)


def _request(
    *,
    name: str = "read_file",
    args: dict | None = None,
    tool_id: str = "tool_001",
) -> _FakeRequest:
    return _FakeRequest(tool_call={"name": name, "args": args or {"path": "/x"}, "id": tool_id})


class TestPreCallbackFires:
    @pytest.mark.anyio
    async def test_pre_callback_fired_with_payload(self, tool_ctx):
        pre = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_pre_tool_use=pre), tool_ctx)

        async def handler(_request):
            return ToolMessage(content="ok", tool_call_id="tool_001")

        await mw.awrap_tool_call(_request(), handler)

        pre.assert_awaited_once_with(
            PreToolUsePayload(
                tool_use_id="tool_001",
                tool_name="read_file",
                tool_input={"path": "/x"},
            ),
        )

    @pytest.mark.anyio
    async def test_pre_fires_before_handler(self, tool_ctx):
        order: list[str] = []

        async def pre(_p):
            order.append("pre")

        async def handler(_request):
            order.append("handler")

            return ToolMessage(content="ok", tool_call_id="tool_001")

        mw = _make_middleware(HookCallbacks(on_pre_tool_use=pre), tool_ctx)

        await mw.awrap_tool_call(_request(), handler)

        assert order == ["pre", "handler"]


class TestPostCallbackFires:
    @pytest.mark.anyio
    async def test_post_callback_payload_on_success(self, tool_ctx):
        post = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_post_tool_use=post), tool_ctx)

        async def handler(_request):
            return ToolMessage(content="hello", tool_call_id="tool_001")

        await mw.awrap_tool_call(_request(), handler)

        post.assert_awaited_once()
        assert post.await_args is not None
        payload = post.await_args.args[0]
        assert isinstance(payload, PostToolUsePayload)
        assert payload.tool_use_id == "tool_001"
        assert payload.tool_name == "read_file"
        assert payload.tool_input == {"path": "/x"}
        assert payload.tool_use_result == "hello"
        assert payload.is_error is False
        assert payload.duration_ms >= 0

    @pytest.mark.anyio
    async def test_post_is_error_when_tool_message_status_error(self, tool_ctx):
        post = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_post_tool_use=post), tool_ctx)

        async def handler(_request):
            return ToolMessage(content="boom", tool_call_id="tool_001", status="error")

        await mw.awrap_tool_call(_request(), handler)

        assert post.await_args is not None
        assert post.await_args.args[0].is_error is True

    @pytest.mark.anyio
    async def test_post_fires_after_handler(self, tool_ctx):
        order: list[str] = []

        async def post(_p):
            order.append("post")

        async def handler(_request):
            order.append("handler")

            return ToolMessage(content="ok", tool_call_id="tool_001")

        mw = _make_middleware(HookCallbacks(on_post_tool_use=post), tool_ctx)

        await mw.awrap_tool_call(_request(), handler)

        assert order == ["handler", "post"]


class TestNonzeroExitCodeReportsAsError:
    @pytest.mark.anyio
    async def test_post_is_error_when_json_content_carries_a_nonzero_exit_code(self, tool_ctx):
        post = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_post_tool_use=post), tool_ctx)

        async def handler(_request):
            content = '{"stdout": "", "stderr": "not found", "exit_code": 127}'

            return ToolMessage(content=content, tool_call_id="tool_001")

        await mw.awrap_tool_call(_request(), handler)

        assert post.await_args is not None
        assert post.await_args.args[0].is_error is True

    @pytest.mark.anyio
    async def test_post_is_not_error_when_exit_code_is_zero(self, tool_ctx):
        post = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_post_tool_use=post), tool_ctx)

        async def handler(_request):
            content = '{"stdout": "ok", "stderr": "", "exit_code": 0}'

            return ToolMessage(content=content, tool_call_id="tool_001")

        await mw.awrap_tool_call(_request(), handler)

        assert post.await_args is not None
        assert post.await_args.args[0].is_error is False


class TestContentReportsNonzeroExit:
    def test_json_string_with_nonzero_exit_code(self):
        assert content_reports_nonzero_exit('{"exit_code": 1}') is True

    def test_json_string_with_zero_exit_code(self):
        assert content_reports_nonzero_exit('{"exit_code": 0}') is False

    def test_dict_with_nonzero_exit_code(self):
        assert content_reports_nonzero_exit({"exit_code": 2}) is True

    def test_plain_string_content_is_not_an_error(self):
        assert content_reports_nonzero_exit("just some text") is False

    def test_non_object_json_is_not_an_error(self):
        assert content_reports_nonzero_exit("[1, 2, 3]") is False

    def test_non_int_exit_code_is_not_an_error(self):
        assert content_reports_nonzero_exit('{"exit_code": "boom"}') is False

    def test_none_content_is_not_an_error(self):
        assert content_reports_nonzero_exit(None) is False


class TestExceptionPath:
    @pytest.mark.anyio
    async def test_post_fires_with_is_error_true_and_reraises(self, tool_ctx):
        post = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_post_tool_use=post), tool_ctx)

        async def handler(_request):
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError, match="boom"):
            await mw.awrap_tool_call(_request(), handler)

        post.assert_awaited_once()
        assert post.await_args is not None
        payload = post.await_args.args[0]
        assert payload.is_error is True
        assert payload.tool_use_result is None

    @pytest.mark.anyio
    async def test_pre_fires_even_when_handler_raises(self, tool_ctx):
        pre = AsyncMock()
        post = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_pre_tool_use=pre, on_post_tool_use=post), tool_ctx)

        async def handler(_request):
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError):
            await mw.awrap_tool_call(_request(), handler)

        pre.assert_awaited_once()
        post.assert_awaited_once()


class TestToolExceptionConverted:
    @pytest.mark.anyio
    async def test_tool_exception_returns_an_error_tool_message_instead_of_raising(self, tool_ctx):
        mw = _make_middleware(HookCallbacks(), tool_ctx)

        async def handler(_request):
            raise ToolException("unknown skill 'fruit' - available: deploy, test")

        result = await mw.awrap_tool_call(_request(), handler)

        assert isinstance(result, ToolMessage)
        assert result.status == "error"
        assert result.content == "unknown skill 'fruit' - available: deploy, test"
        assert result.tool_call_id == "tool_001"

    @pytest.mark.anyio
    async def test_post_fires_once_with_is_error_true_for_a_tool_exception(self, tool_ctx):
        pre = AsyncMock()
        post = AsyncMock()
        mw = _make_middleware(HookCallbacks(on_pre_tool_use=pre, on_post_tool_use=post), tool_ctx)

        async def handler(_request):
            raise ToolException("boom")

        await mw.awrap_tool_call(_request(), handler)

        pre.assert_awaited_once()
        post.assert_awaited_once()
        assert post.await_args is not None
        payload = post.await_args.args[0]
        assert payload.is_error is True
        assert payload.tool_use_result == "boom"

    @pytest.mark.anyio
    async def test_a_non_tool_exception_still_raises_and_never_becomes_a_tool_result(
        self,
        tool_ctx,
    ):
        mw = _make_middleware(HookCallbacks(), tool_ctx)

        async def handler(_request):
            raise RuntimeError("a genuine bug, not a tool-reported failure")

        with pytest.raises(RuntimeError, match="genuine bug"):
            await mw.awrap_tool_call(_request(), handler)


class TestNoneCallbacks:
    @pytest.mark.anyio
    async def test_unregistered_callbacks_do_not_raise(self, tool_ctx):
        mw = _make_middleware(HookCallbacks(), tool_ctx)

        async def handler(_request):
            return ToolMessage(content="ok", tool_call_id="tool_001")

        result = await mw.awrap_tool_call(_request(), handler)

        assert isinstance(result, ToolMessage)
        assert result.content == "ok"


class TestPassthrough:
    @pytest.mark.anyio
    async def test_handler_return_value_preserved(self, tool_ctx):
        mw = _make_middleware(HookCallbacks(), tool_ctx)
        expected = ToolMessage(content="payload", tool_call_id="tool_001")

        async def handler(_request):
            return expected

        result = await mw.awrap_tool_call(_request(), handler)

        assert result is expected
