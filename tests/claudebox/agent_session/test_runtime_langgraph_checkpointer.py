"""LangGraphRuntime persistent checkpointer - SqliteSaver per session_dir."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


def _ok_httpx_client_for_checkpointer() -> MagicMock:
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


def _config(tmp_path: Path) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model="ollama:llama3.2:3b",
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-ckpt",
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=HookCallbacks(),
        provider_kwargs={"base_url": "http://127.0.0.1:11434"},
    )


class TestCheckpointerWiring:
    @pytest.mark.anyio
    async def test_connect_opens_async_sqlite_saver_at_session_dir(self, tmp_path):
        """The from_conn_string path must point at {session_dir}/checkpoints.sqlite."""

        runtime = LangGraphRuntime(_config(tmp_path))
        captured: list[str] = []

        async def _fake_aenter(self):
            return MagicMock()

        async def _fake_aexit(self, *args):
            return None

        def _from_conn_string(path):
            captured.append(path)
            mock_cm = MagicMock()
            mock_cm.__aenter__ = _fake_aenter
            mock_cm.__aexit__ = _fake_aexit

            return mock_cm

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
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                side_effect=_from_conn_string,
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_for_checkpointer(),
            ),
        ):
            await runtime.connect()

        assert captured == [str(tmp_path / "checkpoints.sqlite")]

    @pytest.mark.anyio
    async def test_disconnect_closes_checkpointer_context_manager(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        aexit_calls = []

        async def _fake_aenter(self):
            return MagicMock()

        async def _fake_aexit(self, *args):
            aexit_calls.append(args)

            return None

        mock_cm = MagicMock()
        mock_cm.__aenter__ = _fake_aenter
        mock_cm.__aexit__ = _fake_aexit

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
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                return_value=mock_cm,
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_for_checkpointer(),
            ),
        ):
            await runtime.connect()
            await runtime.disconnect()

        assert len(aexit_calls) == 1

    @pytest.mark.anyio
    async def test_session_id_pins_thread_id_for_resume(self, tmp_path):
        """Pinning thread_id to session_id is how cross-restart resume works."""

        runtime = LangGraphRuntime(_config(tmp_path))

        assert runtime._thread_id == "sess-ckpt"


class TestSessionDirIsolation:
    @pytest.mark.anyio
    async def test_two_sessions_get_distinct_checkpoint_paths(self, tmp_path):
        """Different session_dirs -> different checkpoint files (fork-safe)."""

        s1 = tmp_path / "s1"
        s1.mkdir()
        s2 = tmp_path / "s2"
        s2.mkdir()

        captured: list[str] = []

        async def _fake_aenter(self):
            return MagicMock()

        async def _fake_aexit(self, *args):
            return None

        def _from_conn_string(path):
            captured.append(path)
            mock_cm = MagicMock()
            mock_cm.__aenter__ = _fake_aenter
            mock_cm.__aexit__ = _fake_aexit

            return mock_cm

        config1 = LangGraphAgentSessionConfig(
            runtime="langgraph",
            model="ollama:llama3.2:3b",
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id="sess-1",
            resume_session_id=None,
            session_dir=s1,
            hooks=HookCallbacks(),
            provider_kwargs={"base_url": "http://127.0.0.1:11434"},
        )
        config2 = LangGraphAgentSessionConfig(
            runtime="langgraph",
            model="ollama:llama3.2:3b",
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id="sess-2",
            resume_session_id=None,
            session_dir=s2,
            hooks=HookCallbacks(),
            provider_kwargs={"base_url": "http://127.0.0.1:11434"},
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
                "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
                side_effect=_from_conn_string,
            ),
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_for_checkpointer(),
            ),
        ):
            await LangGraphRuntime(config1).connect()
            await LangGraphRuntime(config2).connect()

        assert captured == [str(s1 / "checkpoints.sqlite"), str(s2 / "checkpoints.sqlite")]
