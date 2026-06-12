"""LangGraphRuntime binds langgraph_tools/ factories into the compiled graph."""

from pathlib import Path
from unittest.mock import patch

import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


def _config(tmp_path: Path) -> LangGraphAgentSessionConfig:
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
    )


class TestBuildToolContext:
    def test_universal_fields_populated(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        ctx = runtime._build_tool_context()

        assert ctx.workspace_path == tmp_path
        assert ctx.session_id == "sess-1"
        assert ctx.session_dir == tmp_path
        assert ctx.config is runtime._config
        assert ctx.hooks is runtime._config.hooks
        assert ctx.tool_catalog is not None
        assert ctx.tool_catalog.tools == []


class TestMakeToolsAggregation:
    def test_all_simple_subagent_task_mgmt_question_skill_meta_and_mcp_tools_bound(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        from claudebox.agent_session.langgraph_tools import make_tools

        tools = make_tools(runtime._build_tool_context())

        names = {t.name for t in tools}
        assert names == {
            "read_file",
            "write_file",
            "edit_file",
            "glob",
            "grep",
            "bash",
            "notebook_edit",
            "web_fetch",
            "web_search",
            "task",
            "task_create",
            "task_get",
            "task_list",
            "task_output",
            "task_stop",
            "task_update",
            "ask_user_question",
            "skill",
            "tool_search",
            "list_mcp_resources",
            "read_mcp_resource",
        }

    def test_catalog_populated_after_aggregation(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        from claudebox.agent_session.langgraph_tools import make_tools

        ctx = runtime._build_tool_context()
        tools = make_tools(ctx)
        ctx.tool_catalog.tools.extend(tools)

        assert len(ctx.tool_catalog.tools) == 21
        assert ctx.tool_catalog.tools[0] in tools


class TestConnectBindsTools:
    @pytest.mark.anyio
    async def test_connect_passes_tools_to_create_agent(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        with (
            patch.object(runtime, "_build_chat_model", return_value=object()),
            patch("claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver") as mock_saver,
            patch("claudebox.agent_session.runtime_langgraph.create_agent") as mock_create_agent,
            patch("claudebox.agent_session.runtime_langgraph.SummarizationMiddleware"),
        ):
            saver_instance = mock_saver.from_conn_string.return_value
            saver_instance.__aenter__ = _async_return(object())
            saver_instance.__aexit__ = _async_return(None)
            mock_create_agent.return_value = object()

            await runtime.connect()

        bound_tools = mock_create_agent.call_args.kwargs["tools"]
        assert len(bound_tools) == 21

    @pytest.mark.anyio
    async def test_connect_degrades_to_chat_only_when_bind_tools_unsupported(self, tmp_path):
        """When create_agent raises NotImplementedError (model can't bind_tools),
        connect() completes with a chat-only graph (tools=[]) instead of propagating.
        """

        runtime = LangGraphRuntime(_config(tmp_path))

        degraded_graph = object()
        call_log: list[list] = []

        def _create(**kwargs):
            call_log.append(kwargs["tools"])

            if len(call_log) == 1:
                raise NotImplementedError("model does not support bind_tools")

            return degraded_graph

        with (
            patch.object(runtime, "_build_chat_model", return_value=object()),
            patch("claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver") as mock_saver,
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                side_effect=_create,
            ),
            patch("claudebox.agent_session.runtime_langgraph.SummarizationMiddleware"),
        ):
            saver_instance = mock_saver.from_conn_string.return_value
            saver_instance.__aenter__ = _async_return(object())
            saver_instance.__aexit__ = _async_return(None)

            await runtime.connect()

        assert runtime._graph is degraded_graph
        assert runtime.ready.is_set()
        # First attempt had the full toolset; rebuild used empty tools=[].
        assert len(call_log) == 2
        assert len(call_log[0]) == 21
        assert call_log[1] == []


def _async_return(value):
    """Build a tiny async return helper for AsyncMock context-manager stubs."""

    async def _cm(*_args, **_kwargs):
        return value

    return _cm
