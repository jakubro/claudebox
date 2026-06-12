"""LangGraphRuntime hook synthesis - on_session_start at connect, on_pre_compact at threshold."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.hooks import CompactStartPayload, HookCallbacks
from claudebox.agent_session.runtime_langgraph import (
    MODEL_CONTEXT_WINDOW,
    LangGraphRuntime,
)


def _ok_httpx_client() -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {}
    response.raise_for_status = MagicMock()
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)
    client.get.return_value = response
    client.post.return_value = response

    return client


def _async_sqlite_cm() -> MagicMock:
    async def _aenter(self):
        return MagicMock()

    async def _aexit(self, *args):
        return None

    cm = MagicMock()
    cm.__aenter__ = _aenter
    cm.__aexit__ = _aexit

    return cm


def _config(tmp_path: Path, *, hooks: HookCallbacks | None = None) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model="ollama:llama3.2:3b",
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-hooks",
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=hooks or HookCallbacks(),
        provider_kwargs={"base_url": "http://127.0.0.1:11434"},
    )


class TestSessionStart:
    @pytest.mark.anyio
    async def test_fires_after_connect(self, tmp_path):
        on_start = AsyncMock()
        runtime = LangGraphRuntime(
            _config(tmp_path, hooks=HookCallbacks(on_session_start=on_start))
        )

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.init_chat_model",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=_async_sqlite_cm(),
            ),
        ):
            await runtime.connect()

        on_start.assert_awaited_once()

    @pytest.mark.anyio
    async def test_skipped_if_unregistered(self, tmp_path):
        """No on_session_start callback registered - connect() must not crash."""

        runtime = LangGraphRuntime(_config(tmp_path, hooks=HookCallbacks()))

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.init_chat_model",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                return_value=MagicMock(),
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client(),
            ),
            patch(
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=_async_sqlite_cm(),
            ),
        ):
            await runtime.connect()

        assert runtime.ready.is_set()


class TestPreCompact:
    @pytest.mark.anyio
    async def test_fires_when_threshold_crossed(self, tmp_path):
        on_pc = AsyncMock()
        runtime = LangGraphRuntime(_config(tmp_path, hooks=HookCallbacks(on_pre_compact=on_pc)))
        # Push used_tokens above 85% of llama3.2:3b context window (128_000).
        runtime._used_tokens = int(MODEL_CONTEXT_WINDOW["llama3.2:3b"] * 0.9)

        await runtime._maybe_fire_pre_compact()

        on_pc.assert_awaited_once_with(CompactStartPayload(trigger="context_limit"))

    @pytest.mark.anyio
    async def test_below_threshold_does_not_fire(self, tmp_path):
        on_pc = AsyncMock()
        runtime = LangGraphRuntime(_config(tmp_path, hooks=HookCallbacks(on_pre_compact=on_pc)))
        runtime._used_tokens = int(MODEL_CONTEXT_WINDOW["llama3.2:3b"] * 0.5)

        await runtime._maybe_fire_pre_compact()

        on_pc.assert_not_awaited()

    @pytest.mark.anyio
    async def test_fires_once_per_session(self, tmp_path):
        on_pc = AsyncMock()
        runtime = LangGraphRuntime(_config(tmp_path, hooks=HookCallbacks(on_pre_compact=on_pc)))
        runtime._used_tokens = int(MODEL_CONTEXT_WINDOW["llama3.2:3b"] * 0.95)

        await runtime._maybe_fire_pre_compact()
        await runtime._maybe_fire_pre_compact()
        await runtime._maybe_fire_pre_compact()

        on_pc.assert_awaited_once()

    @pytest.mark.anyio
    async def test_skipped_if_callback_unregistered(self, tmp_path):
        """No on_pre_compact callback - no crash even when threshold crossed."""

        runtime = LangGraphRuntime(_config(tmp_path, hooks=HookCallbacks()))
        runtime._used_tokens = int(MODEL_CONTEXT_WINDOW["llama3.2:3b"] * 0.95)

        await runtime._maybe_fire_pre_compact()

        assert runtime._fired_pre_compact is False
