"""Tests for claudebox_daemon.domain.sessions.schedules - schedule events, read incrementally."""

from __future__ import annotations

import dataclasses
import json
import os
from pathlib import Path

import pytest

from claudebox import file_stamp
from claudebox_daemon.domain.sessions import schedules
from claudebox_daemon.domain.sessions.schedules import ScheduleIndex


def _human(content: str, turn_id: str, ts: str = "2026-10-20T10:00:00+00:00") -> dict:
    return {
        "type": "user",
        "subtype": "text",
        "is_human": True,
        "content": content,
        "turn_id": turn_id,
        "ts": ts,
        "raw": {"message": "x"},
        "id": "evt_1",
    }


def _call(name: str, tool_use_id: str, tool_input: dict, **extra) -> dict:
    return {
        "type": "assistant",
        "subtype": "tool_use",
        "content": name,
        "tool_name": name,
        "tool_use_id": tool_use_id,
        "tool_input": tool_input,
        "ts": "2026-10-20T10:00:01+00:00",
        "turn_id": "t-other",
        "message_data": {"big": "x"},
        **extra,
    }


def _result(tool_use_id: str, result: dict, **extra) -> dict:
    return {
        "type": "user",
        "subtype": "tool_result",
        "content": "Scheduled job 0a899097.",
        "tool_use_id": tool_use_id,
        "is_error": None,
        "tool_use_result": result,
        "ts": "2026-10-20T10:00:02+00:00",
        **extra,
    }


def _append(path: Path, *records: dict) -> None:
    with path.open("a", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record) + "\n")


def _settled_stamp(path: Path):
    stamp = file_stamp(path)
    assert stamp is not None

    return dataclasses.replace(stamp, settled=True)


@pytest.fixture
def log(tmp_path) -> Path:
    return tmp_path / "events.jsonl"


class TestKeptEvents:
    def test_keeps_the_schedule_calls_their_results_and_restarts_in_log_order(self, log):
        _append(
            log,
            _human("schedule it", "t1"),
            {"type": "assistant", "subtype": "text", "content": "On it", "ts": "a"},
            _call(
                "CronCreate",
                "c1",
                {"cron": "*/15 * * * *", "prompt": "Check", "recurring": True},
            ),
            _result("c1", {"id": "0a899097", "recurring": True, "durable": False}),
            {"type": "result", "subtype": "success", "ts": "b"},
            {"type": "system", "subtype": "container_restarted", "ts": "c", "message_data": {}},
            _call("CronDelete", "d1", {"id": "0a899097"}),
            _result("d1", {"id": "0a899097"}),
        )

        events = ScheduleIndex().read(log).events

        assert [(e["type"], e["subtype"], e.get("content")) for e in events] == [
            ("user", "text", None),
            ("assistant", "tool_use", "CronCreate"),
            ("user", "tool_result", None),
            ("system", "container_restarted", None),
            ("assistant", "tool_use", "CronDelete"),
        ]
        assert events[1]["tool_input"] == {
            "cron": "*/15 * * * *",
            "prompt": "Check",
            "recurring": True,
        }
        assert events[2]["tool_use_result"] == {
            "id": "0a899097",
            "recurring": True,
            "durable": False,
        }

    def test_drops_raw_payloads_and_message_text(self, log):
        _append(
            log,
            _human("secret plans", "t1"),
            _call("CronCreate", "c1", {"cron": "0 9 * * *", "prompt": "Brief"}),
            _result("c1", {"id": "00000001"}),
        )

        human, create, result = ScheduleIndex().read(log).events

        assert set(human) == {"type", "subtype", "is_human", "turn_id", "ts"}
        assert "message_data" not in create and "turn_id" not in create
        assert "content" not in result

    def test_each_create_is_preceded_by_the_human_message_of_its_turn(self, log):
        _append(
            log,
            _human("first", "t1"),
            _human("second", "t2"),
            _call("CronCreate", "c1", {"cron": "0 9 * * *", "prompt": "A"}),
            _result("c1", {"id": "00000001"}),
            _call("CronCreate", "c2", {"cron": "0 10 * * *", "prompt": "B"}),
            _result("c2", {"id": "00000002"}),
        )

        events = ScheduleIndex().read(log).events

        assert [e.get("turn_id") for e in events if e.get("is_human")] == ["t2"]
        assert events[0]["turn_id"] == "t2"

    def test_skips_nested_calls_and_other_tools_results(self, log):
        _append(
            log,
            _call(
                "CronCreate",
                "c9",
                {"cron": "0 9 * * *", "prompt": "Nested"},
                parent_tool_use_id="task",
            ),
            _result("c9", {"id": "00000009"}, parent_tool_use_id="task"),
            _call("Bash", "b1", {"command": "ls"}),
            _result("b1", {"stdout": "x"}),
        )

        assert ScheduleIndex().read(log).events == []


class TestRespondingSince:
    @pytest.mark.parametrize(
        ("records", "since"),
        [
            ([{"type": "assistant", "subtype": "text", "ts": "t1"}], "t1"),
            (
                [
                    {"type": "assistant", "subtype": "text", "ts": "t1"},
                    {"type": "assistant", "subtype": "tool_use", "ts": "t2"},
                ],
                "t1",
            ),
            (
                [
                    {"type": "assistant", "subtype": "text", "ts": "t1"},
                    {"type": "result", "subtype": "success", "ts": "t2"},
                ],
                None,
            ),
            (
                [
                    {"type": "assistant", "subtype": "text", "ts": "t1"},
                    {"type": "system", "subtype": "error", "ts": "t2"},
                ],
                None,
            ),
            (
                [{"type": "assistant", "subtype": "text", "ts": "t1", "parent_tool_use_id": "x"}],
                None,
            ),
            ([{"type": "user", "subtype": "text", "is_human": True, "ts": "t1"}], None),
        ],
        ids=["starts", "holds", "result-ends", "error-ends", "nested-leaves-it", "human-leaves-it"],
    )
    def test_folds_whether_the_session_is_answering(self, log, records, since):
        _append(log, *records)

        assert ScheduleIndex().read(log).responding_since == since


class TestIncrementalReads:
    def test_an_unchanged_settled_log_is_not_read_again(self, log, monkeypatch):
        _append(log, _call("CronCreate", "c1", {"cron": "0 9 * * *", "prompt": "A"}))
        monkeypatch.setattr(schedules, "file_stamp", _settled_stamp)
        index = ScheduleIndex()
        index.read(log)
        reads = []
        monkeypatch.setattr(schedules, "read_jsonl_from", lambda *args: reads.append(args))

        events = index.read(log).events

        assert reads == []
        assert [e["content"] for e in events] == ["CronCreate"]

    def test_appended_lines_are_read_from_the_offset(self, log):
        index = ScheduleIndex()
        _append(
            log,
            _human("go", "t1"),
            _call("CronCreate", "c1", {"cron": "0 9 * * *", "prompt": "A"}),
        )
        index.read(log)
        first = index.bytes_read
        _append(log, _result("c1", {"id": "00000001"}))

        index.bytes_read = 0
        events = index.read(log).events

        assert [e["subtype"] for e in events] == ["text", "tool_use", "tool_result"]
        assert 0 < index.bytes_read < first

    @pytest.mark.parametrize("change", ["shrunk", "replaced"])
    def test_a_shrunk_or_replaced_log_is_read_from_the_start(self, log, change):
        index = ScheduleIndex()
        _append(
            log,
            _call("CronCreate", "c1", {"cron": "0 9 * * *", "prompt": "Old"}),
            _result("c1", {"id": "00000001"}),
        )
        index.read(log)

        if change == "shrunk":
            log.write_text("")
            _append(log, _call("CronCreate", "c2", {"cron": "0 9 * * *", "prompt": "New"}))
        else:
            replacement = log.with_name("events.jsonl.new")
            _append(
                replacement,
                _call("CronCreate", "c2", {"cron": "0 9 * * *", "prompt": "New"}),
                _result("c2", {"id": "00000002"}),
                _human("padding so the replacement is longer than the original", "t9"),
            )
            os.replace(replacement, log)

        prompts = [e["tool_input"]["prompt"] for e in index.read(log).events if "tool_input" in e]

        assert prompts == ["New"]

    def test_retain_drops_the_logs_no_longer_wanted(self, tmp_path):
        a, b = tmp_path / "a.jsonl", tmp_path / "b.jsonl"
        _append(a, _call("CronCreate", "c1", {"cron": "0 9 * * *", "prompt": "A"}))
        _append(b, _call("CronCreate", "c2", {"cron": "0 9 * * *", "prompt": "B"}))
        index = ScheduleIndex()
        index.read(a)
        index.read(b)

        index.retain([b])
        index.bytes_read = 0
        index.read(a)

        assert index.bytes_read == a.stat().st_size
