"""sibling.py @tool tests - session_spawn/session_ask/session_read thin bindings.

Binding-layer only: delegation and SiblingSessionError -> ToolException translation.
"""

from dataclasses import replace

import pytest
from langchain_core.tools import ToolException

from claudebox.agent_session._daemon_services import DaemonServiceBundle
from claudebox.agent_session._sibling_sessions import SiblingSessionError
from claudebox.agent_session.langgraph_tools.sibling import make_sibling_tools


class _FakeClient:
    """Duck-types SiblingSessionClient's public surface; records calls for assertion."""

    def __init__(self, *, spawn_result=None, ask_result=None, read_result=None, fail=None):
        self.calls: list[tuple] = []
        self._spawn_result = spawn_result
        self._ask_result = ask_result
        self._read_result = read_result
        self._fail = fail

    async def spawn(self, prompt):
        self.calls.append(("spawn", prompt))

        if self._fail:
            raise self._fail

        return self._spawn_result

    async def ask(self, session_id, message):
        self.calls.append(("ask", session_id, message))

        if self._fail:
            raise self._fail

        return self._ask_result

    async def read(self, session_id, limit):
        self.calls.append(("read", session_id, limit))

        if self._fail:
            raise self._fail

        return self._read_result


def _tools(tool_ctx, client):
    ctx = replace(tool_ctx, daemon_services=DaemonServiceBundle(sessions=client))

    return {t.name: t for t in make_sibling_tools(ctx)}


class TestMakeSiblingTools:
    def test_returns_empty_when_daemon_services_missing(self, tool_ctx):
        ctx = replace(tool_ctx, daemon_services=None)

        assert make_sibling_tools(ctx) == []

    def test_returns_empty_when_sessions_slot_missing(self, tool_ctx):
        ctx = replace(tool_ctx, daemon_services=DaemonServiceBundle(sessions=None))

        assert make_sibling_tools(ctx) == []

    def test_returns_three_tools(self, tool_ctx):
        tools = _tools(tool_ctx, _FakeClient())

        assert set(tools) == {"session_spawn", "session_ask", "session_read"}


class TestSessionSpawn:
    @pytest.mark.anyio
    async def test_delegates_and_returns_client_result(self, tool_ctx):
        client = _FakeClient(spawn_result={"session_id": "s1", "container_id": "c1"})
        tools = _tools(tool_ctx, client)

        result = await tools["session_spawn"].ainvoke({"prompt": "do the thing"})

        assert result == {"session_id": "s1", "container_id": "c1"}
        assert client.calls == [("spawn", "do the thing")]

    @pytest.mark.anyio
    async def test_sibling_error_becomes_tool_exception(self, tool_ctx):
        client = _FakeClient(fail=SiblingSessionError("depth cap reached"))
        tools = _tools(tool_ctx, client)

        with pytest.raises(ToolException, match="depth cap reached"):
            await tools["session_spawn"].ainvoke({"prompt": "x"})


class TestSessionAsk:
    @pytest.mark.anyio
    async def test_delegates_and_returns_client_result(self, tool_ctx):
        client = _FakeClient(ask_result={"state": "replied", "text": "done"})
        tools = _tools(tool_ctx, client)

        result = await tools["session_ask"].ainvoke({"session_id": "s1", "message": "hi"})

        assert result == {"state": "replied", "text": "done"}
        assert client.calls == [("ask", "s1", "hi")]

    @pytest.mark.anyio
    async def test_sibling_error_becomes_tool_exception(self, tool_ctx):
        client = _FakeClient(fail=SiblingSessionError("unreachable"))
        tools = _tools(tool_ctx, client)

        with pytest.raises(ToolException, match="unreachable"):
            await tools["session_ask"].ainvoke({"session_id": "s1", "message": "hi"})


class TestSessionRead:
    @pytest.mark.anyio
    async def test_delegates_and_returns_client_result(self, tool_ctx):
        client = _FakeClient(read_result=[{"role": "user", "content": "hi"}])
        tools = _tools(tool_ctx, client)

        result = await tools["session_read"].ainvoke({"session_id": "s1"})

        assert result == [{"role": "user", "content": "hi"}]
        assert client.calls == [("read", "s1", 50)]

    @pytest.mark.anyio
    async def test_limit_forwarded(self, tool_ctx):
        client = _FakeClient(read_result=[])
        tools = _tools(tool_ctx, client)

        await tools["session_read"].ainvoke({"session_id": "s1", "limit": 5})

        assert client.calls == [("read", "s1", 5)]

    @pytest.mark.anyio
    async def test_sibling_error_becomes_tool_exception(self, tool_ctx):
        client = _FakeClient(fail=SiblingSessionError("no session found"))
        tools = _tools(tool_ctx, client)

        with pytest.raises(ToolException, match="no session found"):
            await tools["session_read"].ainvoke({"session_id": "s1"})
