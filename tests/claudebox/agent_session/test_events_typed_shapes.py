"""Construction + equality tests for typed init/usage shapes - no escape-hatch dicts."""

import pytest

from claudebox.agent_session.events import (
    McpServerInit,
    ResultPayload,
    ResultUsage,
    SystemInitData,
    SystemInitPayload,
)


class TestSystemInitData:
    def test_constructs_with_defaults(self):
        data = SystemInitData()

        assert data.agents == []
        assert data.analytics_disabled is False
        assert data.apiKeySource is None
        assert data.mcp_servers == []
        assert data.slash_commands == []
        assert data.tools == []

    def test_constructs_with_known_fields(self):
        data = SystemInitData(
            slash_commands=["/help"],
            permissionMode="default",
            cwd="/repo",
            mcp_servers=[McpServerInit(name="jina", status="connected")],
        )

        assert data.slash_commands == ["/help"]
        assert data.permissionMode == "default"
        assert data.cwd == "/repo"
        assert data.mcp_servers[0].name == "jina"
        assert data.mcp_servers[0].status == "connected"


class TestMcpServerInit:
    def test_constructs(self):
        server = McpServerInit(name="ref", status="connected")

        assert server.name == "ref"
        assert server.status == "connected"

    def test_equality_supports_frozen_dataclass_semantics(self):
        a = McpServerInit(name="ref", status="connected")
        b = McpServerInit(name="ref", status="connected")

        assert a == b


class TestResultUsage:
    def test_constructs(self):
        usage = ResultUsage(used_tokens=100, max_tokens=128_000)

        assert usage.used_tokens == 100
        assert usage.max_tokens == 128_000

    def test_immutable(self):
        usage = ResultUsage(used_tokens=10, max_tokens=100)

        with pytest.raises((AttributeError, Exception)):
            usage.used_tokens = 20  # ty: ignore[invalid-assignment]

    def test_equality(self):
        a = ResultUsage(used_tokens=10, max_tokens=100)
        b = ResultUsage(used_tokens=10, max_tokens=100)

        assert a == b


class TestResultPayloadWithUsage:
    def test_carries_typed_usage(self):
        payload = ResultPayload(
            subtype="success", usage=ResultUsage(used_tokens=10, max_tokens=100)
        )

        assert payload.usage is not None
        assert payload.usage.used_tokens == 10
        assert payload.usage.max_tokens == 100

    def test_usage_none_default(self):
        payload = ResultPayload(subtype="success")

        assert payload.usage is None


class TestSystemInitPayloadWithTypedData:
    def test_carries_typed_data(self):
        payload = SystemInitPayload(
            subtype="init",
            session_id="sess-1",
            model="claude-opus",
            data=SystemInitData(slash_commands=["/help"]),
        )

        assert payload.data.slash_commands == ["/help"]
        assert payload.data.permissionMode is None

    def test_data_defaults_to_empty_init_data(self):
        payload = SystemInitPayload(subtype="init", session_id="sess-1")

        assert isinstance(payload.data, SystemInitData)
        assert payload.data.slash_commands == []
