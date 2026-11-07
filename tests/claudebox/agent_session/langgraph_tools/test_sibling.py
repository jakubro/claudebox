"""sibling.py @tool tests - the five session tools' thin bindings.

Binding-layer only: delegation and SiblingSessionError -> ToolException translation.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from langchain_core.tools import ToolException

from claudebox.agent_session import _sibling_sessions as texts
from claudebox.agent_session._daemon_services import DaemonServiceBundle
from claudebox.agent_session._sibling_sessions import SiblingSessionError
from claudebox.agent_session.langgraph_tools.sibling import make_sibling_tools


class _FakeClient:
    """Duck-types SiblingSessionClient's public surface; records calls for assertion."""

    def __init__(
        self,
        *,
        spawn_result=None,
        ask_result=None,
        read_result=None,
        stop_result=None,
        list_result=None,
        fail=None,
    ):
        self.calls: list[tuple] = []
        self._spawn_result = spawn_result
        self._ask_result = ask_result
        self._read_result = read_result
        self._stop_result = stop_result
        self._list_result = list_result
        self._fail = fail

    async def spawn(self, prompt, *, name=None, model=None, effort=None):
        self.calls.append(("spawn", prompt, name, model, effort))

        if self._fail:
            raise self._fail

        return self._spawn_result

    async def stop(self, session_id):
        self.calls.append(("stop", session_id))

        if self._fail:
            raise self._fail

        return self._stop_result

    async def list_siblings(self):
        self.calls.append(("list",))

        if self._fail:
            raise self._fail

        return self._list_result

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

    def test_returns_the_five_session_tools(self, tool_ctx):
        tools = _tools(tool_ctx, _FakeClient())

        assert set(tools) == {
            "session_spawn",
            "session_ask",
            "session_read",
            "session_stop",
            "session_list",
        }

    def test_each_tool_carries_the_shared_description(self, tool_ctx):
        tools = _tools(tool_ctx, _FakeClient())

        assert {name: tool.description for name, tool in tools.items()} == {
            "session_spawn": texts.SESSION_SPAWN_DESCRIPTION,
            "session_ask": texts.SESSION_ASK_DESCRIPTION,
            "session_read": texts.SESSION_READ_DESCRIPTION,
            "session_stop": texts.SESSION_STOP_DESCRIPTION,
            "session_list": texts.SESSION_LIST_DESCRIPTION,
        }


class TestSessionSpawn:
    @pytest.mark.anyio
    async def test_delegates_and_returns_client_result(self, tool_ctx):
        client = _FakeClient(spawn_result={"session_id": "s1", "container_id": "c1"})
        tools = _tools(tool_ctx, client)

        result = await tools["session_spawn"].ainvoke({"prompt": "do the thing"})

        assert result == {"session_id": "s1", "container_id": "c1"}
        assert client.calls == [("spawn", "do the thing", None, None, None)]

    @pytest.mark.anyio
    async def test_settings_forwarded(self, tool_ctx):
        client = _FakeClient(spawn_result={})
        tools = _tools(tool_ctx, client)

        await tools["session_spawn"].ainvoke(
            {"prompt": "x", "name": "lint-fix", "model": "m", "effort": "low"},
        )

        assert client.calls == [("spawn", "x", "lint-fix", "m", "low")]

    @pytest.mark.anyio
    async def test_sibling_error_becomes_tool_exception(self, tool_ctx):
        client = _FakeClient(fail=SiblingSessionError("depth cap reached"))
        tools = _tools(tool_ctx, client)

        with pytest.raises(ToolException, match="depth cap reached"):
            await tools["session_spawn"].ainvoke({"prompt": "x"})


class TestSessionAsk:
    @pytest.mark.anyio
    async def test_delegates_and_returns_client_result(self, tool_ctx):
        client = _FakeClient(ask_result={"session_id": "s1", "delivered": True})
        tools = _tools(tool_ctx, client)

        result = await tools["session_ask"].ainvoke({"session_id": "s1", "message": "hi"})

        assert result == {"session_id": "s1", "delivered": True}
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


class TestSessionStopAndList:
    @pytest.mark.anyio
    async def test_stop_delegates(self, tool_ctx):
        client = _FakeClient(stop_result={"session_id": "s1", "state": "stopped"})
        tools = _tools(tool_ctx, client)

        result = await tools["session_stop"].ainvoke({"session_id": "s1"})

        assert result == {"session_id": "s1", "state": "stopped"}
        assert client.calls == [("stop", "s1")]

    @pytest.mark.anyio
    async def test_list_delegates(self, tool_ctx):
        listing = [{"session_id": "s1", "name": "n", "state": "idle"}]
        client = _FakeClient(list_result=listing)
        tools = _tools(tool_ctx, client)

        assert await tools["session_list"].ainvoke({}) == listing
        assert client.calls == [("list",)]

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("tool", "args"),
        [("session_stop", {"session_id": "s1"}), ("session_list", {})],
    )
    async def test_sibling_error_becomes_tool_exception(self, tool_ctx, tool, args):
        client = _FakeClient(fail=SiblingSessionError("not started by this session"))
        tools = _tools(tool_ctx, client)

        with pytest.raises(ToolException, match="not started by this session"):
            await tools[tool].ainvoke(args)
