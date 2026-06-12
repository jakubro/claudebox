"""Tests for claudebox.session.models - shared session metadata model."""

import json
from dataclasses import dataclass
from datetime import datetime

from claudebox import serialization
from claudebox.session.models import SessionMetadata, SessionNotFound


class TestSessionMetadata:
    """Test SessionMetadata dataclass behavior."""

    def test_fromdict_roundtrip(self):
        meta = SessionMetadata(
            session_id="sid",
            fork_point_cost_usd=0.0,
            name="test",
            started_at=datetime.fromisoformat("2026-01-15T10:30:00"),
            num_turns=3,
        )

        # Round-trip through JSON (as happens via io.write_json/read_json)
        data = json.loads(serialization.dumps(meta.asdict()))

        restored = SessionMetadata.fromdict(data)
        assert restored.session_id == "sid"
        assert restored.name == "test"
        assert restored.num_turns == 3
        assert restored.started_at == datetime.fromisoformat("2026-01-15T10:30:00")

    def test_fromdict_ignores_unknown_fields(self):
        data = {
            "session_id": "sid",
            "fork_point_cost_usd": 0.0,
            "name": "test",
            "unknown_field": "should be ignored",
            "permission_mode": "auto",
        }
        meta = SessionMetadata.fromdict(data)
        assert meta.session_id == "sid"
        assert not hasattr(meta, "unknown_field")


class TestSessionMetadataInheritance:
    """Test that SessionMetadata works as a base for extension."""

    def test_child_extends_with_extra_field(self):
        @dataclass(kw_only=True)
        class ChildMeta(SessionMetadata):
            extra_field: str | None = None

        child = ChildMeta(session_id="sid", fork_point_cost_usd=0.0, extra_field="value")
        assert child.session_id == "sid"
        assert child.extra_field == "value"

    def test_child_fromdict_includes_parent_fields(self):
        @dataclass(kw_only=True)
        class ChildMeta(SessionMetadata):
            extra_field: str | None = None

        data = {
            "session_id": "sid",
            "fork_point_cost_usd": 0.0,
            "name": "test",
            "extra_field": "val",
        }
        child = ChildMeta.fromdict(data)
        assert child.session_id == "sid"
        assert child.name == "test"
        assert child.extra_field == "val"

    def test_child_asdict_includes_parent_fields(self):
        @dataclass(kw_only=True)
        class ChildMeta(SessionMetadata):
            extra_field: str | None = None

        child = ChildMeta(session_id="sid", fork_point_cost_usd=0.0, name="test", extra_field="val")
        d = child.asdict()
        assert d["session_id"] == "sid"
        assert d["name"] == "test"
        assert d["extra_field"] == "val"


class TestSessionNotFound:
    """Test SessionNotFound exception."""

    def test_stores_session_id(self):
        exc = SessionNotFound("missing-id")
        assert exc.session_id == "missing-id"

    def test_str_message(self):
        exc = SessionNotFound("missing-id")
        assert "missing-id" in str(exc)
