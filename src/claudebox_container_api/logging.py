"""Container API logging - SSE broadcasting and per-session file logs."""

import asyncio
import logging
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import ClassVar

from claudebox import (
    Broadcaster,
    EventSubtype,
    EventType,
    parse_timestamp,
    read_jsonl,
    use_log_file,
)


class LogBroadcaster(Broadcaster[logging.LogRecord, dict]):
    """SSE log broadcaster - accepts LogRecord, emits SSE-shaped dicts, replays from log file.

    Boundary frames delimit the replay, so a subscriber can tell where history ends and live output begins.
    """

    # Fields in the log file JSON that map directly to SSE dict keys.
    _LOG_FILE_KNOWN_FIELDS: ClassVar[set[str]] = {
        "event",
        "level",
        "logger",
        "timestamp",
        "source",
        "stream",
    }

    def __init__(self, log_file_path: str | Path) -> None:
        """Pin the log file used as the replay source."""

        if not log_file_path:
            raise ValueError("log_file_path is required for LogBroadcaster")

        super().__init__()
        self._log_file_path = Path(log_file_path)

    async def subscribe(self) -> tuple[str, asyncio.Queue]:  # ty: ignore[invalid-method-override]
        """Subscribe and replay log history to the new subscriber."""

        subscriber_id, queue = super().subscribe()
        events = self._load()

        try:
            await self.replay_to(queue, events)
        except Exception:
            await self.unsubscribe(subscriber_id)

            raise

        return subscriber_id, queue

    async def unsubscribe(self, subscriber_id: str) -> None:  # ty: ignore[invalid-method-override]
        """Async wrapper around the base sync unsubscribe - satisfies AsyncBroadcastEventSource."""

        super().unsubscribe(subscriber_id)

    def _load(self) -> Iterable[dict]:
        """Yield SSE-format dicts from the log file (empty when the file does not exist)."""

        if not self._log_file_path.exists():
            return

        base_date = parse_timestamp(self._log_file_path.stat().st_mtime, posix=True).date()

        for record in read_jsonl(self._log_file_path):
            try:
                raw_ts = record["timestamp"]

                if isinstance(raw_ts, (float, int)):
                    ts = float(raw_ts)
                elif isinstance(raw_ts, str):
                    # Time-only format has no %z - combines with base_date's own naive convention.
                    time = datetime.strptime(raw_ts, "%H:%M:%S").time()  # noqa: DTZ007
                    ts = datetime.combine(base_date, time).timestamp()
                else:
                    continue
            except (KeyError, ValueError, TypeError):
                continue

            extra = {
                k: v for k, v in record.items() if k not in self._LOG_FILE_KNOWN_FIELDS
            } or None

            yield {
                "timestamp": ts,
                "level": record.get("level", "INFO").upper(),
                "logger": record.get("logger", ""),
                "message": record.get("event", ""),
                "source": record.get("source", "api"),
                "stream": record.get("stream"),
                "extra": extra,
            }

    def _on_event(self, event: logging.LogRecord) -> dict:
        """Project a LogRecord into the SSE wire-shape dict (structured payload preserved)."""

        if isinstance(event.msg, dict):
            message = event.msg.get("event", str(event.msg))
            source = event.msg.get("source", "api")
            stream = event.msg.get("stream")
            # Mirrors _load's extra-rebuild so SSE frames carry the same payload (exception, session.id, etc.).
            extra = {
                k: v for k, v in event.msg.items() if k not in self._LOG_FILE_KNOWN_FIELDS
            } or None
        else:
            message = event.getMessage()
            source = "api"
            stream = None
            extra = getattr(event, "_context", None)

        return {
            "timestamp": event.created,
            "level": event.levelname,
            "logger": event.name,
            "message": message,
            "source": source,
            "stream": stream,
            "extra": extra,
        }

    def _on_replay_started(self, length: int) -> dict:
        """Create the replay-started boundary frame."""

        return self._boundary(EventSubtype.REPLAY_STARTED, length)

    def _on_replay_ended(self) -> dict:
        """Create the replay-ended boundary frame."""

        return self._boundary(EventSubtype.REPLAY_ENDED, 0)

    @classmethod
    def _boundary(cls, subtype: EventSubtype, count: int) -> dict:
        """Build a boundary frame; its ``type`` key is what sets it apart from a log record."""

        return {"type": EventType.SYSTEM, "subtype": subtype, "count": count}


class BroadcastLogHandler(logging.Handler):
    """logging.Handler that broadcasts records via LogBroadcaster."""

    def __init__(self, broadcaster: Broadcaster) -> None:
        super().__init__()
        self._broadcaster = broadcaster

    def emit(self, record: logging.LogRecord) -> None:
        """Convert log record to dict and broadcast to subscribers."""

        try:
            self._broadcaster.schedule_broadcast(record)
        except Exception:  # noqa: BLE001 - Handler.emit() contract: never raise, call handleError
            self.handleError(record)


log_broadcaster: LogBroadcaster | None = None
_log_handler: BroadcastLogHandler | None = None


def start_logging(log_file_path: str | Path) -> None:
    """Attach the per-session log file and install the SSE broadcaster handler on the root logger."""

    global log_broadcaster, _log_handler

    use_log_file(log_file_path)

    log_broadcaster = LogBroadcaster(log_file_path)
    _log_handler = BroadcastLogHandler(log_broadcaster)

    logging.getLogger().addHandler(_log_handler)


def stop_logging() -> None:
    """Detach the SSE broadcaster handler and clear the module singletons."""

    global log_broadcaster, _log_handler

    if _log_handler:
        logging.getLogger().removeHandler(_log_handler)

    log_broadcaster = None
    _log_handler = None
