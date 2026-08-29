"""Tests for the container API sessions handler - /current response shape."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from claudebox import SessionEntryNotFound
from claudebox.agent_session.orchestration.models import PublishedEvent, SessionSummary
from claudebox.agent_session.orchestration.persistence import EventLog
from claudebox.workspace import Workspace
from claudebox_container_api.handlers.sessions import (
    get_current_session,
    get_session_events,
    stop_session,
)


def _make_event(event_id: str, content: str) -> PublishedEvent:
    return PublishedEvent(
        type="assistant",
        subtype="text",
        content=content,
        primary=False,
        is_human=False,
        raw={},
        id=event_id,
        ts=datetime(2026, 3, 8, 12, 0, 0, tzinfo=UTC),
        turn_id=None,
    )


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


@pytest.mark.anyio
async def test_stop_session_stops_the_registry_entry():
    """The ordinary case: a live entry is stopped via the registry."""

    registry = MagicMock()
    registry.stop_session = AsyncMock()

    await stop_session(registry, "side-1")

    registry.stop_session.assert_awaited_once_with("side-1")


@pytest.mark.anyio
async def test_stop_session_is_idempotent_when_already_gone():
    """Promotion stops before forking without checking whether the turn already auto-stopped
    the session - a caller hitting an already-gone entry must see success, not a 404."""

    registry = MagicMock()
    registry.stop_session = AsyncMock(side_effect=SessionEntryNotFound(session_id="side-1"))

    await stop_session(registry, "side-1")  # must not raise


@pytest.mark.anyio
async def test_session_events_reads_the_persisted_log_with_no_live_session(tmp_workspace):
    """The whole point: a stopped side thread has no SessionDep entry, so this reads the
    directory directly rather than resolving through a live instance."""

    ws = Workspace(start_dir=tmp_workspace)
    log = EventLog("side-1", ws)
    await log.open()
    await log.append(_make_event("e1", "why this branch?"))
    await log.append(_make_event("e2", "because..."))
    await log.close()

    registry = MagicMock(workspace=ws)
    registry.live_ids.return_value = []

    body = await get_session_events(registry, "side-1")

    assert [e["content"] for e in body["events"]] == ["why this branch?", "because..."]
    assert body["running"] is False


@pytest.mark.anyio
async def test_session_events_reports_running_from_registry_membership(tmp_workspace):
    """The events alone can't say whether the exchange they end on is finished or still
    arriving - that comes from the registry's live set, the same one /api/health reports."""

    ws = Workspace(start_dir=tmp_workspace)
    log = EventLog("side-1", ws)
    await log.open()
    await log.append(_make_event("e1", "still going"))
    await log.close()

    registry = MagicMock(workspace=ws)
    registry.live_ids.return_value = ["side-1", "primary-1"]

    body = await get_session_events(registry, "side-1")

    assert body["running"] is True


@pytest.mark.anyio
async def test_session_events_empty_for_a_session_with_no_persisted_log(tmp_workspace):
    """No file on disk yet is not an error - an empty transcript, same as EventLog.read_all()."""

    ws = Workspace(start_dir=tmp_workspace)
    registry = MagicMock(workspace=ws)
    registry.live_ids.return_value = []

    body = await get_session_events(registry, "never-started")

    assert body == {"events": [], "running": False}
