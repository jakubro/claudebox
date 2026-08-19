"""Tests for the container API sessions handler - /current response shape."""

from unittest.mock import MagicMock

import pytest

from claudebox.agent_session.orchestration.models import SessionSummary
from claudebox_container_api.handlers.sessions import get_current_session


@pytest.mark.anyio
async def test_current_session_returns_empty_dict_when_no_summary():
    """No active session yet - the welcome-screen probe gets `{}`, not a capability crash."""

    svc = MagicMock()
    svc.get.return_value = None

    body = await get_current_session(svc)

    assert body == {}


@pytest.mark.anyio
async def test_current_session_includes_rate_limits_beside_capabilities():
    """rate_limits rides the response as a sibling field, same pattern as capabilities/runtime_name."""

    svc = MagicMock()
    svc.get.return_value = SessionSummary(session_id="s1", fork_point_cost_usd=0.0)
    svc.get_capabilities.return_value = {"supports_models": True}
    svc.runtime_name = "Claude"
    svc.get_rate_limits.return_value = [
        {
            "rate_limit_type": "five_hour",
            "status": "allowed_warning",
            "resets_at": None,
            "utilization": 0.86,
        },
    ]

    body = await get_current_session(svc)

    assert body["capabilities"] == {"supports_models": True}
    assert body["runtime_name"] == "Claude"
    assert body["rate_limits"] == svc.get_rate_limits.return_value


@pytest.mark.anyio
async def test_current_session_rate_limits_empty_when_store_has_nothing():
    """No plan-limit window is being approached - an empty list, not an absent field."""

    svc = MagicMock()
    svc.get.return_value = SessionSummary(session_id="s1", fork_point_cost_usd=0.0)
    svc.get_capabilities.return_value = {}
    svc.runtime_name = "Claude"
    svc.get_rate_limits.return_value = []

    body = await get_current_session(svc)

    assert body["rate_limits"] == []
