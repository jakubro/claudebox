"""Tests for claudebox.time - timestamp generation and parsing."""

from __future__ import annotations

import re
from datetime import UTC, datetime

import pytest

from claudebox.core.time import TIMESTAMP_FORMAT, days_before, get_timestamp, parse_timestamp


class TestGetTimestamp:
    """Test timestamp generation."""

    def test_returns_formatted_string(self):
        ts = get_timestamp()
        assert isinstance(ts, str)
        assert re.match(r"\d{8}-\d{6}$", ts)

    def test_posix_returns_int(self):
        ts = get_timestamp(posix=True)
        assert isinstance(ts, int)
        assert ts > 0


class TestParseTimestamp:
    """Test timestamp parsing."""

    def test_roundtrip_string(self):
        ts = get_timestamp()
        dt = parse_timestamp(ts)
        assert isinstance(dt, datetime)
        assert dt.strftime(TIMESTAMP_FORMAT) == ts

    def test_roundtrip_posix(self):
        ts = get_timestamp(posix=True)
        dt = parse_timestamp(str(ts), posix=True)
        assert isinstance(dt, datetime)
        assert int(dt.timestamp()) == ts

    def test_posix_accepts_numeric(self):
        ts = get_timestamp(posix=True)
        from_int = parse_timestamp(ts, posix=True)
        from_float = parse_timestamp(float(ts), posix=True)
        from_str = parse_timestamp(str(ts), posix=True)
        assert from_int == from_str == from_float

    def test_parses_known_value(self):
        dt = parse_timestamp("20260306-120000")
        assert dt.year == 2026
        assert dt.month == 3
        assert dt.day == 6
        assert dt.hour == 12

    def test_parse_invalid_string_raises(self):
        """Garbage input should raise ValueError."""

        with pytest.raises(ValueError):
            parse_timestamp("not-a-timestamp")


class TestDaysBefore:
    """A lifetime longer than the calendar reaches back to its first day instead of failing."""

    NOW = datetime(2026, 10, 24, tzinfo=UTC)

    def test_a_lifetime_inside_the_calendar(self):
        assert days_before(self.NOW, 14) == datetime(2026, 10, 10, tzinfo=UTC)

    @pytest.mark.parametrize("days", [800_000, 10**12])
    def test_a_lifetime_past_the_calendar_reaches_its_first_day(self, days):
        assert days_before(self.NOW, days) == datetime(1, 1, 1, tzinfo=UTC)

    def test_a_naive_moment_stays_naive(self):
        assert days_before(self.NOW.replace(tzinfo=None), 10**12).tzinfo is None
