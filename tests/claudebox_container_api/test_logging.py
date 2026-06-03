"""Tests for container API logging — LogBroadcaster file-based replay."""

import asyncio
import json

import pytest

from claudebox_container_api.logging import LogBroadcaster


# --- Helpers ---


def _write_log_lines(path, lines):
    """Write JSON log lines to a file."""

    path.write_text("\n".join(json.dumps(line) for line in lines) + "\n")


def _drain_queue(queue):
    """Drain all items from an asyncio.Queue."""

    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    return items


# --- Construction ---


class TestLogBroadcasterConstruction:
    """LogBroadcaster requires a log file path at construction."""

    def test_empty_path_raises(self):
        with pytest.raises(ValueError, match="log_file_path"):
            LogBroadcaster("")

    def test_none_path_raises(self):
        with pytest.raises(ValueError, match="log_file_path"):
            LogBroadcaster(None)  # ty: ignore[invalid-argument-type]


# --- File-Based Replay (via subscribe) ---


class TestLogBroadcasterFileReplay:
    """Test LogBroadcaster replay path: subscribe() loads the log file into the queue."""

    @pytest.mark.anyio
    async def test_replay_from_file(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        _write_log_lines(
            log_file,
            [
                {
                    "event": "Server started",
                    "level": "info",
                    "logger": "app",
                    "timestamp": "10:00:00",
                },
                {
                    "event": "Request received",
                    "level": "debug",
                    "logger": "http",
                    "timestamp": "10:00:01",
                },
            ],
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert len(items) == 2

        assert items[0]["message"] == "Server started"
        assert items[0]["level"] == "INFO"
        assert items[0]["logger"] == "app"
        assert isinstance(items[0]["timestamp"], float)

        assert items[1]["message"] == "Request received"
        assert items[1]["level"] == "DEBUG"

    @pytest.mark.anyio
    async def test_replay_empty_when_file_missing(self, tmp_path):
        """Missing log file replays nothing — empty queue, no synthetic events."""

        b = LogBroadcaster(tmp_path / "nonexistent.log")
        _, queue = await b.subscribe()

        assert _drain_queue(queue) == []

    @pytest.mark.anyio
    async def test_extra_fields_collected(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        _write_log_lines(
            log_file,
            [
                {
                    "event": "Error",
                    "level": "error",
                    "logger": "app",
                    "timestamp": "12:00:00",
                    "exc_info": "traceback here",
                },
            ],
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert items[0]["extra"] == {"exc_info": "traceback here"}

    @pytest.mark.anyio
    async def test_extra_is_none_when_no_extra_fields(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        _write_log_lines(
            log_file,
            [
                {"event": "OK", "level": "info", "logger": "app", "timestamp": "12:00:00"},
            ],
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert items[0]["extra"] is None

    @pytest.mark.anyio
    async def test_malformed_lines_skipped(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        log_file.write_text(
            "not json\n"
            + json.dumps(
                {"event": "Good", "level": "info", "logger": "app", "timestamp": "12:00:00"}
            )
            + "\n"
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert len(items) == 1
        assert items[0]["message"] == "Good"

    @pytest.mark.anyio
    async def test_missing_timestamp_skips_line(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        _write_log_lines(
            log_file,
            [
                {"event": "No timestamp", "level": "info", "logger": "app"},
                {
                    "event": "Has timestamp",
                    "level": "info",
                    "logger": "app",
                    "timestamp": "12:00:00",
                },
            ],
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert len(items) == 1
        assert items[0]["message"] == "Has timestamp"

    @pytest.mark.anyio
    async def test_float_epoch_timestamp(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        _write_log_lines(
            log_file,
            [
                {
                    "event": "Float ts",
                    "level": "info",
                    "logger": "app",
                    "timestamp": 1713264000.123,
                },
            ],
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert len(items) == 1
        assert items[0]["message"] == "Float ts"
        assert items[0]["timestamp"] == pytest.approx(1713264000.123)

    @pytest.mark.anyio
    async def test_int_epoch_timestamp(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        _write_log_lines(
            log_file,
            [
                {
                    "event": "Int ts",
                    "level": "info",
                    "logger": "app",
                    "timestamp": 1713264000,
                },
            ],
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert len(items) == 1
        assert items[0]["message"] == "Int ts"
        assert items[0]["timestamp"] == 1713264000.0

    @pytest.mark.anyio
    async def test_mixed_timestamp_formats(self, tmp_path):
        log_file = tmp_path / "container_api.log"
        _write_log_lines(
            log_file,
            [
                {
                    "event": "String ts",
                    "level": "info",
                    "logger": "app",
                    "timestamp": "10:00:00",
                },
                {
                    "event": "Float ts",
                    "level": "info",
                    "logger": "app",
                    "timestamp": 1713264000.5,
                },
            ],
        )

        b = LogBroadcaster(log_file)
        _, queue = await b.subscribe()

        items = _drain_queue(queue)
        assert len(items) == 2
        assert items[0]["message"] == "String ts"
        assert items[1]["message"] == "Float ts"
        assert items[1]["timestamp"] == pytest.approx(1713264000.5)
