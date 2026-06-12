"""Tests for claudebox.agent_session.orchestration.models - event and session data models."""

from datetime import datetime
from pathlib import Path

from claudebox.agent_session.orchestration.models import Event, PublishedEvent, SessionSummary


class TestEvent:
    """Test base Event dataclass."""

    def test_asdict_roundtrip(self):
        event = Event(
            type="assistant",
            subtype="text",
            content="response",
            primary=True,
            is_human=False,
            raw={"message": {}},
        )
        data = event.asdict()
        restored = Event.fromdict(data)
        assert restored.type == event.type
        assert restored.content == event.content


class TestPublishedEvent:
    """Test PublishedEvent with timestamp coercion and optional fields."""

    def test_string_timestamp_coercion(self):
        pub = PublishedEvent(
            type="assistant",
            subtype="text",
            content="hello",
            primary=True,
            is_human=False,
            raw={},
            id="e1",
            ts="2026-03-06T12:00:00",  # ty: ignore[invalid-argument-type]  # Test verifies string->datetime coercion in PublishedEvent.__post_init__.
            turn_id="t1",
        )
        assert isinstance(pub.ts, datetime)
        assert pub.ts.year == 2026

    def test_datetime_timestamp_passthrough(self):
        dt = datetime(2026, 3, 6, 12, 0, 0)
        pub = PublishedEvent(
            type="assistant",
            subtype="text",
            content="hello",
            primary=True,
            is_human=False,
            raw={},
            id="e1",
            ts=dt,
            turn_id="t1",
        )
        assert pub.ts is dt


class TestSessionSummary:
    """Test SessionSummary with path and timestamp coercion."""

    def test_string_path_coercion(self):
        summary = SessionSummary(
            session_id="s1",
            fork_point_cost_usd=0.0,
            session_dir="/fake/sessions/abc",  # ty: ignore[invalid-argument-type]  # Test verifies string->Path coercion in SessionSummary.__post_init__.
            workspace="/fake/project",  # ty: ignore[invalid-argument-type]  # Test verifies string->Path coercion in SessionSummary.__post_init__.
        )
        assert isinstance(summary.session_dir, Path)
        assert isinstance(summary.workspace, Path)

    def test_string_timestamp_coercion(self):
        summary = SessionSummary(
            session_id="s1",
            fork_point_cost_usd=0.0,
            started_at="2026-03-06T12:00:00",  # ty: ignore[invalid-argument-type]  # Test verifies string->datetime coercion in SessionSummary.__post_init__.
            updated_at="2026-03-06T13:00:00",  # ty: ignore[invalid-argument-type]  # Test verifies string->datetime coercion in SessionSummary.__post_init__.
        )
        assert isinstance(summary.started_at, datetime)
        assert isinstance(summary.updated_at, datetime)
