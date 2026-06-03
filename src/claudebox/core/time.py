"""Timestamp generation and parsing."""

from datetime import UTC, datetime


# Format string for human-readable timestamps: YYYYMMDD-HHMMSS.
TIMESTAMP_FORMAT = "%Y%m%d-%H%M%S"


def get_timestamp(posix: bool = False) -> str | int:
    """Return current time as YYYYMMDD-HHMMSS (UTC) or POSIX int if posix=True."""

    if posix:
        return int(datetime.now().timestamp())
    else:
        return datetime.now(UTC).replace(tzinfo=None).strftime(TIMESTAMP_FORMAT)


def parse_timestamp(value: str | float | int, posix: bool = False) -> datetime:
    """Parse YYYYMMDD-HHMMSS string (or POSIX numeric/string if posix=True) to datetime."""

    if posix:
        return datetime.fromtimestamp(int(value))
    else:
        return datetime.strptime(str(value), TIMESTAMP_FORMAT)
