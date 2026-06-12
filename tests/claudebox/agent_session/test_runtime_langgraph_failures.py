"""LangGraphRuntime failure modes - J1 (Ollama unreachable), J2 (model not pulled), J3 (tool error), J6 (compaction)."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest
from langchain_core.messages import ToolMessage

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.errors import OllamaModelNotPulled, OllamaUnreachable
from claudebox.agent_session.events import ToolResultBlock, UserMessagePayload
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


def _config(tmp_path: Path) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model="ollama:llama3.2:3b",
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-fm",
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=HookCallbacks(),
        provider_kwargs={"base_url": "http://127.0.0.1:11434"},
    )


def _httpx_client_mock(*, version_ok=True, model_404=False, raise_on_get=None, raise_on_post=None):
    response = MagicMock()
    response.status_code = 200 if not model_404 else 404
    response.json.return_value = {}
    response.raise_for_status = MagicMock()

    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)

    if raise_on_get is not None:
        client.get.side_effect = raise_on_get
    else:
        client.get.return_value = response

    if raise_on_post is not None:
        client.post.side_effect = raise_on_post
    else:
        client.post.return_value = response

    return client


class TestJ1OllamaUnreachable:
    @pytest.mark.anyio
    async def test_connect_raises_on_connect_error(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        client_mock = _httpx_client_mock(raise_on_get=httpx.ConnectError("conn refused"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable, match="11434"):
                await runtime.connect()

    @pytest.mark.anyio
    async def test_connect_raises_on_timeout(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        client_mock = _httpx_client_mock(raise_on_get=httpx.TimeoutException("timeout"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable):
                await runtime.connect()


class TestJ2ModelNotPulled:
    @pytest.mark.anyio
    async def test_connect_raises_on_show_404(self, tmp_path):
        """Ollama /api/show returns 404 -> OllamaModelNotPulled."""

        runtime = LangGraphRuntime(_config(tmp_path))
        client_mock = _httpx_client_mock(model_404=True)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaModelNotPulled, match="llama3.2:3b"):
                await runtime.connect()

    @pytest.mark.anyio
    async def test_probe_timeout_raises_unreachable_not_not_pulled(self, tmp_path):
        """Network timeout on /api/show -> OllamaUnreachable (not the wrong NotPulled diagnosis)."""

        runtime = LangGraphRuntime(_config(tmp_path))
        client_mock = _httpx_client_mock(raise_on_post=httpx.TimeoutException("timeout"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable):
                await runtime.connect()

    @pytest.mark.anyio
    async def test_probe_500_raises_unreachable_not_not_pulled(self, tmp_path):
        """Server 5xx on /api/show -> OllamaUnreachable (server misbehaving, not catalogue)."""

        runtime = LangGraphRuntime(_config(tmp_path))
        response_500 = MagicMock()
        response_500.status_code = 500
        response_500.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server error", request=MagicMock(), response=response_500
        )

        client_mock = _httpx_client_mock()
        client_mock.post.return_value = response_500

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable):
                await runtime.connect()

    @pytest.mark.anyio
    async def test_probe_connect_error_raises_unreachable(self, tmp_path):
        """Connect error on /api/show -> OllamaUnreachable."""

        runtime = LangGraphRuntime(_config(tmp_path))
        client_mock = _httpx_client_mock(raise_on_post=httpx.ConnectError("refused"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable):
                await runtime.connect()


class TestJ3ToolErrorPropagation:
    """Tool errors propagate through ToolMessage(status='error') -> tool_result.is_error=true."""

    def test_tool_result_event_marks_is_error(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        tm = ToolMessage(content="ConnectError", tool_call_id="tu-x", status="error")

        evt = runtime._tool_result_event(tm)

        assert evt is not None
        assert isinstance(evt.payload, UserMessagePayload)
        assert isinstance(evt.payload.content, list)
        block = evt.payload.content[0]
        assert isinstance(block, ToolResultBlock)
        assert block.is_error is True
        assert block.tool_use_id == "tu-x"


class TestJ6SummarizationMiddleware:
    @pytest.mark.anyio
    async def test_connect_wires_summarization_middleware(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        captured_middleware = []

        def _capture(**kwargs):
            captured_middleware.append(kwargs.get("middleware"))

            return MagicMock()

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.init_chat_model",
                return_value=MagicMock(),
            ),
            patch("claudebox.agent_session.runtime_langgraph.create_agent", side_effect=_capture),
            patch(
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=_async_cm_mock(),
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_httpx_client_mock(),
            ),
        ):
            await runtime.connect()

        # Middleware list non-empty and contains SummarizationMiddleware.
        # Order: ClaudeboxToolHookMiddleware (outermost) -> SummarizationMiddleware.
        from langchain.agents.middleware import SummarizationMiddleware

        assert captured_middleware
        assert any(isinstance(m, SummarizationMiddleware) for m in captured_middleware[0])


def _async_cm_mock():
    async def _aenter(self):
        return MagicMock()

    async def _aexit(self, *args):
        return None

    cm = MagicMock()
    cm.__aenter__ = _aenter
    cm.__aexit__ = _aexit

    return cm
