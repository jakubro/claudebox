"""Timestamp generation and parsing."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta


TIMESTAMP_FORMAT = "%Y%m%d-%H%M%S"


def get_timestamp(posix: bool = False) -> str | int:
    """Return current time as YYYYMMDD-HHMMSS (UTC) or POSIX int if posix=True."""

    if posix:
        return int(datetime.now(UTC).timestamp())
    else:
        return datetime.now(UTC).replace(tzinfo=None).strftime(TIMESTAMP_FORMAT)


def days_before(moment: datetime, days: int) -> datetime:
    """Return `moment` minus `days` days, or the calendar's first moment when that falls before it."""

    try:
        return moment - timedelta(days=days)
    except OverflowError:
        return datetime.min.replace(tzinfo=moment.tzinfo)


def parse_timestamp(value: str | float, posix: bool = False) -> datetime:
    """Parse YYYYMMDD-HHMMSS string (or POSIX numeric/string if posix=True) to datetime."""

    if posix:
        # Naive-local by design, symmetric with get_timestamp's naive datetime.now().timestamp() -
        # an aware round-trip here would silently disagree with that side's local interpretation.
        return datetime.fromtimestamp(int(value))  # noqa: DTZ006
    else:
        # TIMESTAMP_FORMAT has no %z - naive-by-convention, matching get_timestamp's own output.
        return datetime.strptime(str(value), TIMESTAMP_FORMAT)  # noqa: DTZ007
