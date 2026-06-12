"""Shared structlog ConsoleRenderer with ISO8601 timestamps, used by daemon stderr and ``claudebox logs``."""

from collections.abc import MutableMapping
from datetime import UTC, datetime
from typing import Any

import structlog


# Fields produced by the SSE LogBroadcaster projection that need translation
# back into the structlog event_dict shape ConsoleRenderer consumes.
_SSE_KNOWN_FIELDS = {"timestamp", "level", "logger", "message", "extra"}


_RENDERER = structlog.dev.ConsoleRenderer(
    exception_formatter=structlog.dev.RichTracebackFormatter(show_locals=False),
)


def render_event(record: dict[str, Any]) -> str:
    """Render a structlog record dict as one line: ISO timestamp, level, logger, message, kvs.

    Accepts either the on-disk JSON shape (``event``/lowercase level/flat kvs) or
    the SSE-projected shape (``message``/uppercase level/nested ``extra``) - both
    are normalized to the structlog event_dict ConsoleRenderer expects.
    """

    return _RENDERER(None, "", _to_event_dict(record))


def format_timestamp_iso(
    _logger: Any,
    _name: str,
    event_dict: MutableMapping[str, Any],
) -> MutableMapping[str, Any]:
    """Console-only structlog processor: rewrite float-epoch ``timestamp`` to ISO8601 string.

    Inserted between ``remove_processors_meta`` and ``ConsoleRenderer`` in the
    daemon's console handler chain. File handler chain is untouched so the
    on-disk JSON contract (float epoch) is preserved.
    """

    ts = event_dict.get("timestamp")

    if isinstance(ts, (int, float)):
        event_dict["timestamp"] = _iso(ts)

    return event_dict


def _to_event_dict(record: dict[str, Any]) -> dict[str, Any]:
    """Normalize either on-disk or SSE-projected log dict into structlog event_dict shape."""

    # SSE-projected shape - has ``message``/``extra``/uppercase ``level``.
    if "message" in record and "event" not in record:
        out: dict[str, Any] = {
            "event": record.get("message", ""),
            "level": (record.get("level") or "info").lower(),
            "logger": record.get("logger", ""),
        }
        ts = record.get("timestamp")

        if isinstance(ts, (int, float)):
            out["timestamp"] = _iso(ts)
        elif isinstance(ts, str):
            out["timestamp"] = ts

        extra = record.get("extra")

        if isinstance(extra, dict):
            for k, v in extra.items():
                if k not in out:
                    out[k] = v

        return out

    # On-disk JSON shape - already structlog-flavored.
    out = dict(record)
    ts = out.get("timestamp")

    if isinstance(ts, (int, float)):
        out["timestamp"] = _iso(ts)

    return out


def _iso(ts: float) -> str:
    """Convert a float-epoch timestamp to ``YYYY-MM-DD HH:MM:SS.mmm`` (UTC)."""

    return datetime.fromtimestamp(ts, tz=UTC).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
