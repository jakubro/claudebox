"""LangGraphRuntime skeleton - capability matrix, Protocol stubs, factory dispatch."""

from pathlib import Path

import pytest

from claudebox.agent_session.config import (
    AgentSessionConfig,
    LangGraphAgentSessionConfig,
    RuntimeCapabilities,
)
from claudebox.agent_session.errors import UnknownRuntime
from claudebox.agent_session.protocol import AgentSession
from claudebox.agent_session.runtime_langgraph import CapabilityNotSupported, LangGraphRuntime
from claudebox.agent_session.session import make_agent_session


def _langgraph_config(tmp_path: Path) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model="ollama:llama3.2:3b",
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-1",
        resume_session_id=None,
        session_dir=tmp_path,
        provider_kwargs={"base_url": "http://127.0.0.1:11434"},
    )


class TestCapabilityDeclaration:
    """LangGraph runtime declares its capability profile up front."""

    def test_returns_expected_capability_matrix(self, tmp_path):
        runtime = LangGraphRuntime(_langgraph_config(tmp_path))

        assert runtime.capabilities == RuntimeCapabilities(
            supports_set_model_mid_session=False,
            supports_set_permission_mode=False,
            supports_set_effort_level=False,
            supports_pre_compact_hook=True,
            supports_mcp_delegation=False,
            supports_models=True,
            supports_effort_levels=False,
            supports_permission_modes=False,
            supports_skills=True,
            supports_context_usage=True,
            supports_cost_telemetry=True,
            supports_manual_compact=False,
            supports_session_resume=True,
            supports_session_fork=True,
            supports_session_rewind=True,
            supports_ask_user_question=True,
        )

    def test_runtime_name_is_langgraph(self, tmp_path):
        runtime = LangGraphRuntime(_langgraph_config(tmp_path))

        assert runtime.runtime_name == "LangGraph"


class TestUnsupportedCapabilities:
    """Protocol methods that remain unsupported under LangGraph v1.

    Methods with real implementations (connect, disconnect, query, interrupt,
    get_context_usage, receive_events, get_models, catalogs) are covered in
    their own test modules.
    """

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "method_name,args",
        [
            ("set_model", ()),
            ("set_permission_mode", ("default",)),
            ("set_effort_level", ("high",)),
            ("reconnect_mcp_server", ("ctx7",)),
            ("toggle_mcp_server", ("ctx7", True)),
            ("get_mcp_status", ()),
        ],
    )
    async def test_async_unsupported_method_raises(self, tmp_path, method_name, args):
        runtime = LangGraphRuntime(_langgraph_config(tmp_path))

        with pytest.raises(CapabilityNotSupported):
            await getattr(runtime, method_name)(*args)


class TestFactoryDispatch:
    """make_agent_session routes runtime='langgraph' to LangGraphRuntime."""

    def test_factory_returns_langgraph_runtime_instance(self, tmp_path):
        runtime = make_agent_session(_langgraph_config(tmp_path))

        assert isinstance(runtime, LangGraphRuntime)

    def test_factory_result_satisfies_agent_session_protocol(self, tmp_path):
        runtime = make_agent_session(_langgraph_config(tmp_path))

        assert isinstance(runtime, AgentSession)

    def test_unknown_runtime_string_raises(self, tmp_path):
        config = AgentSessionConfig(
            runtime="bogus",  # ty: ignore[invalid-argument-type]  # Literal narrowing bypassed for defensive test.
            model=None,
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id=None,
            resume_session_id=None,
            session_dir=tmp_path,
        )

        with pytest.raises(UnknownRuntime, match="bogus"):
            make_agent_session(config)
