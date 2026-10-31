"""Tests for claudebox.agent_session.orchestration.persistence - event log I/O."""

from __future__ import annotations

import pytest

from claudebox.agent_session.orchestration.models import PublishedEvent
from claudebox.agent_session.orchestration.persistence import EventLog
from claudebox.constants import SESSION_EVENTS_FILE
from claudebox.core import serialization
from claudebox.workspace import Workspace
from ._helpers import make_published_event


def _make_event(event_id: str = "e1", content: str = "hello") -> PublishedEvent:
    """Persistence-specific wrapper with positional event_id and content."""

    return make_published_event(id=event_id, content=content, primary=True, turn_id="t1")


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
        await log.close()
        assert log._file is None


class TestReopenAfterATornTail:
    """A log a killed writer left mid-record is repaired on open, so the next record survives."""

    @staticmethod
    def _log_over(tmp_workspace, monkeypatch, content: bytes) -> EventLog:
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        (ws.ensure_session("test-session").path / SESSION_EVENTS_FILE).write_bytes(content)

        return EventLog("test-session", ws)

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        ("tail", "expected_ids"),
        [
            (b'{"id": "e2", "content": "hal', ["e1", "e3"]),
            (b"COMPLETE", ["e1", "e2", "e3"]),
        ],
        ids=["torn-record", "newline-lost"],
    )
    async def test_the_first_new_record_lands_on_its_own_line(
        self,
        tmp_workspace,
        monkeypatch,
        tail,
        expected_ids,
    ):
        first = serialization.dumps(_make_event("e1", "first")).encode() + b"\n"

        if tail == b"COMPLETE":
            tail = serialization.dumps(_make_event("e2", "second")).encode()

        log = self._log_over(tmp_workspace, monkeypatch, first + tail)

        try:
            await log.open()
            await log.append(_make_event("e3", "after the restart"))
        finally:
            await log.close()

        assert [event.id for event in log.read_all()] == expected_ids
