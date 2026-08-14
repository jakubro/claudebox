"""Tests for claudebox_daemon.domain.watchdog - event-loop lag detection."""

import asyncio
import time

import pytest

from claudebox_daemon.constants import WATCHDOG_LAG_THRESHOLD
from claudebox_daemon.domain.watchdog import DaemonWatchdog


# --- _poll: healthy / unhealthy classification ---


class TestPollClassification:
    """A responsive loop reports healthy; a starved one reports unhealthy."""

    @pytest.mark.anyio
    async def test_healthy_under_responsive_loop(self):
        watchdog = DaemonWatchdog()
        watchdog._next_wake = time.monotonic()

        await watchdog._poll()

        assert watchdog.healthy is True

    @pytest.mark.anyio
    async def test_unhealthy_when_starved_past_threshold(self):
        watchdog = DaemonWatchdog()
        watchdog._next_wake = time.monotonic() - (WATCHDOG_LAG_THRESHOLD.total_seconds() + 5)

        await watchdog._poll()

        assert watchdog.healthy is False

    @pytest.mark.anyio
    async def test_healthy_just_under_the_threshold(self):
        watchdog = DaemonWatchdog()
        watchdog._next_wake = time.monotonic() - (WATCHDOG_LAG_THRESHOLD.total_seconds() - 0.1)

        await watchdog._poll()

        assert watchdog.healthy is True


# --- start / stop lifecycle ---


class TestWatchdogLifecycle:
    """Mirrors HealthMonitor's own start/stop contract - see test_health.py."""

    @pytest.mark.anyio
    async def test_start_creates_task(self):
        watchdog = DaemonWatchdog()

        await watchdog.start()

        assert watchdog._task is not None

        watchdog._task.cancel()

        try:
            await watchdog._task
        except asyncio.CancelledError:
            pass

    @pytest.mark.anyio
    async def test_start_anchors_baseline_to_start_time_not_construction_time(self):
        watchdog = DaemonWatchdog()
        await asyncio.sleep(0.05)  # widen the construction-to-start gap

        await watchdog.start()

        assert abs(watchdog._next_wake - (time.monotonic() + watchdog._interval)) < 0.05
        assert watchdog._task is not None

        watchdog._task.cancel()

        try:
            await watchdog._task
        except asyncio.CancelledError:
            pass

    @pytest.mark.anyio
    async def test_stop_cancels_task(self):
        watchdog = DaemonWatchdog()

        async def forever():
            await asyncio.sleep(999)

        watchdog._task = asyncio.create_task(forever())

        await watchdog.stop()

        assert watchdog._task is None
