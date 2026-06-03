"""Structural Protocol satisfaction tests for AgentSession.

The static type checker (`ty`, run by `just lint`) is the primary structural
validator: the seam `_sdk_client: AgentSession = ClaudeRuntime(...)` in
`container_api/session/session.py` only type-checks if `ClaudeRuntime`
structurally satisfies the Protocol. These runtime tests are defense-in-depth.
"""

import inspect

from claudebox.agent_session.protocol import AgentSession
from claudebox.agent_session.runtime_claude import ClaudeRuntime


PROTOCOL_COROUTINE_METHODS = (
    "connect",
    "disconnect",
    "query",
    "interrupt",
    "set_model",
    "set_permission_mode",
    "set_effort_level",
    "reconnect_mcp_server",
    "toggle_mcp_server",
    "get_mcp_status",
    "get_context_usage",
)


PROTOCOL_CATALOG_METHODS = (
    "get_models",
    "get_effort_levels",
    "get_permission_modes",
    "get_skills",
)


def test_agent_session_protocol_declares_expected_methods():
    """AgentSession declares the lifecycle/control + catalog methods + capabilities + runtime_name."""

    for name in PROTOCOL_COROUTINE_METHODS:
        assert hasattr(AgentSession, name), f"Protocol missing method: {name}"

    for name in PROTOCOL_CATALOG_METHODS:
        assert hasattr(AgentSession, name), f"Protocol missing catalog method: {name}"

    assert hasattr(AgentSession, "receive_events"), "Protocol missing: receive_events"
    assert "runtime_name" in AgentSession.__annotations__, "Protocol missing: runtime_name"
    assert "ready" in AgentSession.__annotations__, "Protocol missing: ready"
    assert hasattr(AgentSession, "capabilities"), "Protocol missing: capabilities"


def test_claude_runtime_method_coverage():
    """Every Protocol method exists on ClaudeRuntime with correct async-ness.

    The static type checker enforces structural assignment compatibility from
    ClaudeRuntime to AgentSession; this signature-aware check catches a method
    renamed without Protocol update or one declared with the wrong async-ness.
    """

    for name in PROTOCOL_COROUTINE_METHODS:
        method = getattr(ClaudeRuntime, name, None)
        assert method is not None, f"missing method: {name}"
        assert inspect.iscoroutinefunction(method), f"{name} should be a coroutine function"

    receive_events = getattr(ClaudeRuntime, "receive_events", None)
    assert receive_events is not None, "missing method: receive_events"
    assert inspect.isasyncgenfunction(receive_events), (
        "receive_events should be an async generator function"
    )

    for name in PROTOCOL_CATALOG_METHODS:
        method = getattr(ClaudeRuntime, name, None)
        assert method is not None, f"missing catalog method: {name}"
        assert callable(method), f"{name} should be callable"

    assert ClaudeRuntime.runtime_name == "Claude"
    assert hasattr(ClaudeRuntime, "capabilities"), "ClaudeRuntime missing: capabilities"
    assert hasattr(ClaudeRuntime, "CAPABILITIES"), (
        "ClaudeRuntime missing: CAPABILITIES class constant"
    )
