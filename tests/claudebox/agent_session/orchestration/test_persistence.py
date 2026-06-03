"""Tests for claudebox.agent_session.orchestration.persistence — event log I/O."""

import pytest

from claudebox.agent_session.orchestration.models import PublishedEvent
from claudebox.agent_session.orchestration.persistence import EventLog
from claudebox.workspace import Workspace
from ._helpers import make_published_event


def _make_event(event_id: str = "e1", content: str = "hello") -> PublishedEvent:
    """Persistence-specific wrapper with positional event_id and content."""

    return make_published_event(id=event_id, content=content, primary=True, turn_id="t1")


# --- EventLog ---


class TestEventLog:
    """Test append-only event log backed by JSONL file."""

    @pytest.mark.anyio
    async def test_append_and_read_roundtrip(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        log = EventLog("test-session", ws)
        try:
            await log.open()
            event = _make_event()
            await log.append(event)
            events = list(log.read_all())
            assert len(events) == 1
            assert events[0].id == "e1"
            assert events[0].content == "hello"
        finally:
            await log.close()

    @pytest.mark.anyio
    async def test_multiple_appends(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        log = EventLog("test-session", ws)
        try:
            await log.open()
            await log.append(_make_event("e1", "first"))
            await log.append(_make_event("e2", "second"))
            events = list(log.read_all())
            assert len(events) == 2
            assert events[0].id == "e1"
            assert events[1].id == "e2"
        finally:
            await log.close()

    def test_read_all_empty_file(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        log = EventLog("test-session", ws)
        events = log.read_all()
        assert events == []

    @pytest.mark.anyio
    async def test_close_nullifies_handle(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        log = EventLog("test-session", ws)
        await log.open()
        await log.close()
        assert log._file is None

    @pytest.mark.anyio
    async def test_close_idempotent(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        log = EventLog("test-session", ws)
        await log.open()
        await log.close()
        await log.close()  # Should not raise
        assert log._file is None
