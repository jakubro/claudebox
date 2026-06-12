"""Tests for ``claudebox.core.log_rendering`` - ISO timestamp + shape normalization + file-format guard."""

import re

import pytest

from claudebox.core.log_rendering import format_timestamp_iso, render_event


ISO_RE = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _strip(s: str) -> str:
    """Strip ANSI escape sequences for assertion-stable substring checks."""

    return ANSI_RE.sub("", s)


class TestRenderEventOnDiskShape:
    """``render_event`` accepts the on-disk JSON shape (``event``/lowercase level/flat kvs)."""

    def test_iso_timestamp_replaces_float_epoch(self) -> None:
        record = {
            "timestamp": 1780166824.318,
            "level": "warning",
            "logger": "claudebox_daemon.x",
            "event": "Container connection failed",
            "url": "http://localhost:34727/api/health",
        }
        clean = _strip(render_event(record))

        assert ISO_RE.search(clean), clean
        assert "1780166824" not in clean
        assert "Container connection failed" in clean
        assert "url=" in clean

    def test_string_timestamp_passthrough(self) -> None:
        record = {
            "timestamp": "2026-05-30 21:13:44.318",
            "level": "info",
            "logger": "x",
            "event": "ok",
        }
        clean = _strip(render_event(record))
        assert "2026-05-30 21:13:44.318" in clean


class TestRenderEventSseShape:
    """``render_event`` accepts the SSE-projected shape (``message``/uppercase level/nested ``extra``)."""

    def test_sse_shape_normalized_and_rendered(self) -> None:
        record = {
            "timestamp": 1780166824.318,
            "level": "INFO",
            "logger": "claudebox_container_api.session",
            "message": "Session initialised",
            "extra": {"session": {"id": "707098ca"}},
        }
        clean = _strip(render_event(record))

        assert ISO_RE.search(clean)
        assert "Session initialised" in clean
        # Top-level kvs from ``extra`` surface in the rendered line.
        assert "session=" in clean


class TestFormatTimestampIsoProcessor:
    """``format_timestamp_iso`` rewrites float-epoch timestamps in-place; leaves other shapes alone."""

    def test_float_to_iso(self) -> None:
        event_dict = {"timestamp": 1780166824.318, "event": "x"}
        out = format_timestamp_iso(None, "", event_dict)
        assert ISO_RE.search(out["timestamp"]), out

    def test_already_string_kept(self) -> None:
        event_dict = {"timestamp": "2026-05-30T00:00:00", "event": "x"}
        out = format_timestamp_iso(None, "", event_dict)
        assert out["timestamp"] == "2026-05-30T00:00:00"

    def test_missing_timestamp_left_alone(self) -> None:
        event_dict = {"event": "x"}
        out = format_timestamp_iso(None, "", event_dict)
        assert "timestamp" not in out


class TestFileFormatGuard:
    """The daemon log file format remains JSON with a float-epoch ``timestamp`` (durable contract)."""

    def test_shared_processors_emit_float_timestamp(self) -> None:
        """``_shared_processors`` must include TimeStamper() with no fmt argument -> float epoch."""

        import structlog

        from claudebox.core import logging as logmod

        # Walk the shared chain and locate the TimeStamper instance.
        ts_processors = [
            p for p in logmod._shared_processors if isinstance(p, structlog.processors.TimeStamper)
        ]
        assert ts_processors, "_shared_processors must contain TimeStamper"

        ts = ts_processors[0]
        result = ts(None, "info", {"event": "guard"})

        assert isinstance(result["timestamp"], float), (
            f"on-disk timestamp must remain a float epoch; got {type(result['timestamp']).__name__}"
        )

    def test_format_timestamp_iso_not_in_file_chain(self) -> None:
        """File handler's processor chain must not include ``format_timestamp_iso``."""

        # Inspect logging.py source - the file chain (_use_log_file) must use
        # JSONRenderer terminally without the ISO timestamp processor.
        import inspect

        from claudebox.core import logging as logmod

        src = inspect.getsource(logmod._use_log_file)
        assert "format_timestamp_iso" not in src, (
            "File handler must keep float-epoch timestamps; ISO processor is console-only"
        )
