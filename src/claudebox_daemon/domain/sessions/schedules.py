"""Schedule index - each running session's scheduling calls, read from its log a tail at a time."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

from claudebox import FileStamp, file_stamp, read_jsonl_from


CRON_CREATE = "CronCreate"
CRON_DELETE = "CronDelete"

_HUMAN_FIELDS = ("type", "subtype", "is_human", "turn_id", "ts")
_CALL_FIELDS = ("type", "subtype", "content", "tool_use_id", "ts", "tool_input")
_RESULT_FIELDS = ("type", "subtype", "tool_use_id", "is_error", "ts", "tool_use_result")
_RESTART_FIELDS = ("type", "subtype", "ts")


@dataclass(frozen=True)
class ScheduleLog:
    """One log's schedule events in log order, and when its current answer began (None when idle).

    `events` holds the schedule creates and deletes, the creates' results, container restarts, and
    before each create the human message that opened its turn.
    """

    events: list[dict]
    responding_since: str | None


@dataclass
class _Entry:
    stamp: FileStamp | None = None
    offset: int = 0
    events: list[dict] = field(default_factory=list)
    create_ids: set[str | None] = field(default_factory=set)
    last_human: dict | None = None
    responding: bool = False
    responding_since: str | None = None

    def fold(self, record: dict) -> None:
        kind, subtype = record.get("type"), record.get("subtype")

        if kind == "assistant" and not record.get("parent_tool_use_id"):
            if not self.responding:
                self.responding_since = record.get("ts")

            self.responding = True
        elif kind == "result" or (kind == "system" and subtype == "error"):
            self.responding = False
            self.responding_since = None

        if record.get("parent_tool_use_id"):
            return

        if kind == "user" and record.get("is_human"):
            self.last_human = _pick(record, _HUMAN_FIELDS)
        elif subtype == "tool_use" and record.get("content") == CRON_CREATE:
            if self.last_human is not None:
                self.events.append(self.last_human)
                self.last_human = None

            self.events.append(_pick(record, _CALL_FIELDS))
            self.create_ids.add(record.get("tool_use_id"))
        elif subtype == "tool_use" and record.get("content") == CRON_DELETE:
            self.events.append(_pick(record, _CALL_FIELDS))
        elif subtype == "tool_result" and record.get("tool_use_id") in self.create_ids:
            self.events.append(_pick(record, _RESULT_FIELDS))
        elif kind == "system" and subtype == "container_restarted":
            self.events.append(_pick(record, _RESTART_FIELDS))


class ScheduleIndex:
    """Per event log, the schedule events read so far and the byte offset reading resumes from.

    Not thread-safe: one owner reads it from one job at a time.
    """

    def __init__(self) -> None:
        self._entries: dict[str, _Entry] = {}
        self.bytes_read = 0

    def read(self, path: Path) -> ScheduleLog:
        """Bring `path`'s entry up to date: appended bytes only, the whole log once replaced."""

        key = str(path)
        stamp = file_stamp(path)
        entry = self._entries.get(key)

        if entry is None or _replaced(entry, stamp):
            entry = _Entry()
            self._entries[key] = entry

        if not (entry.stamp == stamp and stamp is not None and stamp.settled):
            records, offset = read_jsonl_from(path, entry.offset)
            self.bytes_read += offset - entry.offset

            for record in records:
                entry.fold(record)

            entry.offset = offset

        entry.stamp = stamp

        return ScheduleLog(events=list(entry.events), responding_since=entry.responding_since)

    def retain(self, paths: Iterable[Path]) -> None:
        """Drop every entry whose log is not in `paths`."""

        kept = {str(path) for path in paths}

        for key in self._entries.keys() - kept:
            del self._entries[key]


def _replaced(entry: _Entry, stamp: FileStamp | None) -> bool:
    if stamp is None or entry.stamp is None:
        return entry.offset > 0

    return stamp.ino != entry.stamp.ino or stamp.size < entry.offset


def _pick(record: dict, fields: tuple[str, ...]) -> dict:
    return {name: record.get(name) for name in fields}
