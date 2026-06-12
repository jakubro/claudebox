"""mcp.py @tool tests - list_mcp_resources + read_mcp_resource defensive routing."""

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.documents.base import Blob
from langchain_core.tools import ToolException

from claudebox.agent_session.langgraph_tools.mcp import make_mcp_tools


def _blob(uri: str, name: str, description: str = "", data: str = "content") -> Blob:
    """Build a Blob with the metadata shape MCP servers usually emit."""

    return Blob(
        data=data,
        mimetype="text/plain",
        metadata={"uri": uri, "name": name, "description": description},
    )


def _client(server_blobs: dict, *, get_tools_failures: dict | None = None):
    """Build a fake MultiServerMCPClient with connections + scripted get_resources.

    `server_blobs` maps server_name -> {"resources": [Blob...], "error": Exception | None}.
    When `error` is set, get_resources raises that exception for that server.
    """

    failures = get_tools_failures or {}

    async def fake_get_resources(server_name=None, uris=None):
        entry = server_blobs.get(server_name, {})

        if entry.get("error"):
            raise entry["error"]

        blobs = entry.get("resources", [])

        if uris is not None:
            wanted = [uris] if isinstance(uris, str) else list(uris)

            return [b for b in blobs if b.metadata.get("uri") in wanted]

        return blobs

    async def fake_get_tools(server_name=None):
        if server_name in failures:
            raise failures[server_name]

        return server_blobs.get(server_name, {}).get("tools", [])

    return SimpleNamespace(
        connections=dict.fromkeys(server_blobs),
        get_resources=fake_get_resources,
        get_tools=fake_get_tools,
    )


def _ctx_with_client(tool_ctx, client):
    """Return tool_ctx with mcp_client populated."""

    return replace(tool_ctx, mcp_client=client)


class TestMakeMcpTools:
    def test_returns_two_tools_when_client_present(self, tool_ctx):
        client = _client({"alpha": {"resources": []}})
        tools = make_mcp_tools(_ctx_with_client(tool_ctx, client))

        assert [t.name for t in tools] == ["list_mcp_resources", "read_mcp_resource"]

    def test_returns_two_tools_even_when_client_absent(self, tool_ctx):
        tools = make_mcp_tools(tool_ctx)

        assert [t.name for t in tools] == ["list_mcp_resources", "read_mcp_resource"]


class TestListMcpResources:
    @pytest.mark.anyio
    async def test_returns_empty_when_client_absent(self, tool_ctx):
        list_tool = make_mcp_tools(tool_ctx)[0]

        assert await list_tool.ainvoke({}) == []

    @pytest.mark.anyio
    async def test_aggregates_across_servers_with_server_tag(self, tool_ctx):
        client = _client(
            {
                "context7": {"resources": [_blob("ctx://a", "Resource A", "first")]},
                "filesystem": {
                    "resources": [
                        _blob("fs://b", "Resource B", "second"),
                        _blob("fs://c", "Resource C", "third"),
                    ]
                },
            }
        )
        list_tool = make_mcp_tools(_ctx_with_client(tool_ctx, client))[0]

        result = await list_tool.ainvoke({})

        servers = [r["server"] for r in result]
        assert sorted(servers) == ["context7", "filesystem", "filesystem"]
        uris = {r["uri"] for r in result}
        assert uris == {"ctx://a", "fs://b", "fs://c"}

    @pytest.mark.anyio
    async def test_one_bad_server_does_not_poison_others(self, tool_ctx):
        client = _client(
            {
                "good": {"resources": [_blob("g://1", "Good")]},
                "bad": {"error": RuntimeError("server unreachable")},
            }
        )
        list_tool = make_mcp_tools(_ctx_with_client(tool_ctx, client))[0]

        result = await list_tool.ainvoke({})

        names_by_server = {r["server"]: r for r in result}
        assert "good" in names_by_server
        assert names_by_server["good"]["uri"] == "g://1"
        assert "bad" in names_by_server
        assert "server unreachable" in names_by_server["bad"]["error"]


class TestReadMcpResource:
    @pytest.mark.anyio
    async def test_raises_when_client_absent(self, tool_ctx):
        read_tool = make_mcp_tools(tool_ctx)[1]

        with pytest.raises(ToolException, match="no MCP servers configured"):
            await read_tool.ainvoke({"uri": "x://y"})

    @pytest.mark.anyio
    async def test_returns_first_matching_servers_content(self, tool_ctx):
        client = _client(
            {
                "a": {"resources": [_blob("found://x", "X", data="alpha body")]},
                "b": {"resources": [_blob("other://y", "Y", data="beta body")]},
            }
        )
        read_tool = make_mcp_tools(_ctx_with_client(tool_ctx, client))[1]

        result = await read_tool.ainvoke({"uri": "found://x"})

        assert result == "alpha body"

    @pytest.mark.anyio
    async def test_falls_through_failing_servers(self, tool_ctx):
        client = _client(
            {
                "broken": {"error": RuntimeError("down")},
                "working": {"resources": [_blob("ok://z", "Z", data="payload")]},
            }
        )
        read_tool = make_mcp_tools(_ctx_with_client(tool_ctx, client))[1]

        result = await read_tool.ainvoke({"uri": "ok://z"})

        assert result == "payload"

    @pytest.mark.anyio
    async def test_raises_when_no_server_resolves_uri(self, tool_ctx):
        client = _client(
            {
                "a": {"resources": [_blob("known://1", "K1")]},
                "b": {"resources": []},
            }
        )
        read_tool = make_mcp_tools(_ctx_with_client(tool_ctx, client))[1]

        with pytest.raises(ToolException, match="no server resolved 'gone://x'"):
            await read_tool.ainvoke({"uri": "gone://x"})


class TestRuntimeMcpServerToolsBinding:
    @pytest.mark.anyio
    async def test_initialises_client_from_config(self, tmp_path):
        from claudebox.agent_session.config import LangGraphAgentSessionConfig
        from claudebox.agent_session.hooks import HookCallbacks
        from claudebox.agent_session.runtime_langgraph import LangGraphRuntime

        config = LangGraphAgentSessionConfig(
            runtime="langgraph",
            model="ollama:llama3.2:3b",
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id="sess",
            resume_session_id=None,
            session_dir=tmp_path,
            hooks=HookCallbacks(),
            mcp_servers={
                "context7": {
                    "transport": "stdio",
                    "command": "npx",
                    "args": ["-y", "@upstash/context7-mcp"],
                },
            },
        )
        runtime = LangGraphRuntime(config)

        client = runtime._build_mcp_client()

        assert client is not None
        assert "context7" in client.connections

    def test_no_servers_returns_none_client(self, tmp_path):
        from claudebox.agent_session.config import LangGraphAgentSessionConfig
        from claudebox.agent_session.hooks import HookCallbacks
        from claudebox.agent_session.runtime_langgraph import LangGraphRuntime

        config = LangGraphAgentSessionConfig(
            runtime="langgraph",
            model="ollama:llama3.2:3b",
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id="sess",
            resume_session_id=None,
            session_dir=tmp_path,
            hooks=HookCallbacks(),
            mcp_servers={},
        )
        runtime = LangGraphRuntime(config)

        assert runtime._build_mcp_client() is None

    @pytest.mark.anyio
    async def test_one_bad_server_does_not_poison_other_server_tools(self, tmp_path):
        from claudebox.agent_session.config import LangGraphAgentSessionConfig
        from claudebox.agent_session.hooks import HookCallbacks
        from claudebox.agent_session.runtime_langgraph import LangGraphRuntime

        config = LangGraphAgentSessionConfig(
            runtime="langgraph",
            model="ollama:llama3.2:3b",
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id="sess",
            resume_session_id=None,
            session_dir=tmp_path,
            hooks=HookCallbacks(),
            mcp_servers={
                "good": {"transport": "stdio", "command": "true", "args": []},
                "bad": {"transport": "stdio", "command": "true", "args": []},
            },
        )
        runtime = LangGraphRuntime(config)

        good_tool = MagicMock(name="good_tool")
        client = SimpleNamespace(
            connections={"good": {}, "bad": {}},
            get_tools=AsyncMock(
                side_effect=lambda server_name=None: (
                    [good_tool]
                    if server_name == "good"
                    else (_ for _ in ()).throw(RuntimeError("bad-server-down"))
                )
            ),
        )

        loaded = await runtime._load_mcp_server_tools(client)  # ty: ignore[invalid-argument-type]

        assert loaded == [good_tool]
        assert "bad" in runtime._mcp_failures
        assert "bad-server-down" in runtime._mcp_failures["bad"]
        assert "good" not in runtime._mcp_failures
