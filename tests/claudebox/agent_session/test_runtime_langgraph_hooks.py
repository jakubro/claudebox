"""LangGraphRuntime hook synthesis - on_session_start at connect, compaction start and boundary."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.events import CompactBoundaryPayload, TextBlock, UserMessagePayload
from claudebox.agent_session.hooks import CompactStartPayload, HookCallbacks
from claudebox.agent_session.orchestration.conversion import agent_event_to_events
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


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
            _config(tmp_path, hooks=HookCallbacks(on_session_start=on_start)),
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


class TestCompactionReporting:
    """The runtime brackets each compaction the graph performs with a start and a boundary."""

    @pytest.mark.anyio
    async def test_start_fires_the_pre_compact_hook(self, tmp_path):
        on_pc = AsyncMock()
        runtime = LangGraphRuntime(_config(tmp_path, hooks=HookCallbacks(on_pre_compact=on_pc)))

        await runtime._compaction_started()

        on_pc.assert_awaited_once_with(CompactStartPayload(trigger="context_limit"))

    @pytest.mark.anyio
    async def test_start_without_a_registered_hook_is_a_no_op(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path, hooks=HookCallbacks()))

        await runtime._compaction_started()

        assert runtime._take_pending_events() == []

    @pytest.mark.anyio
    async def test_finish_queues_a_boundary_carrying_the_token_counts(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        await runtime._compaction_finished(pre_tokens=9000, post_tokens=1200, summary="", kept=[])

        events = runtime._take_pending_events()
        assert [e.kind for e in events] == ["compact_boundary"]
        payload = events[0].payload
        assert isinstance(payload, CompactBoundaryPayload)
        assert (payload.trigger, payload.pre_tokens, payload.post_tokens) == (
            "context_limit",
            9000,
            1200,
        )

    @pytest.mark.anyio
    async def test_finish_queues_the_summary_after_the_boundary(self, tmp_path):
        """The transcript reads the compacted context from what follows the boundary."""

        runtime = LangGraphRuntime(_config(tmp_path))

        await runtime._compaction_finished(
            pre_tokens=9000,
            post_tokens=1200,
            summary="Discussed the retry policy.",
            kept=[],
        )

        events = runtime._take_pending_events()
        assert [e.kind for e in events] == ["compact_boundary", "user_message"]
        assert isinstance(events[1].payload, UserMessagePayload)
        assert events[1].payload.content == [TextBlock(text="Discussed the retry policy.")]

    @pytest.mark.anyio
    async def test_summary_converts_to_a_non_human_event(self, tmp_path):
        """A summary read as human text would open a turn and leave the block empty."""

        runtime = LangGraphRuntime(_config(tmp_path))

        await runtime._compaction_finished(
            pre_tokens=9000,
            post_tokens=1200,
            summary="Here is a summary of the conversation to date:\n\nRetry policy.",
            kept=[],
        )

        summary_event = runtime._take_pending_events()[1]
        converted = list(agent_event_to_events(summary_event))

        assert [(e.subtype, e.is_human) for e in converted] == [("text", False)]

    @pytest.mark.anyio
    async def test_pending_events_are_handed_over_once(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        await runtime._compaction_finished(pre_tokens=10, post_tokens=5, summary="", kept=[])

        assert runtime._take_pending_events() != []
        assert runtime._take_pending_events() == []
