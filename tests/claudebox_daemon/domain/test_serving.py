"""Tests for claudebox_daemon.domain.serving - health must track serving capacity, not just lag."""

import asyncio
import threading
from datetime import timedelta

import pytest

import claudebox_daemon.domain.serving as serving_module
from claudebox_daemon.domain.executors import DaemonExecutors
from claudebox_daemon.domain.serving import ServingProbe


def _saturate(pool, release: threading.Event, extra: int = 2) -> None:
    """Occupy every worker in `pool` and queue `extra` jobs behind them."""

    for _ in range(pool._max_workers + extra):
        pool.submit(release.wait)


class TestServingProbe:
    """A live loop that cannot get work done must read unhealthy."""

    @pytest.mark.anyio
    async def test_an_idle_daemon_is_healthy(self):
        pools = DaemonExecutors.create()
        probe = ServingProbe(pools)

        try:
            await probe._poll()

            assert probe.healthy is True
            assert probe.failing == []
            assert set(probe.last_latency_seconds) == {"listing", "state"}
        finally:
            pools.shutdown()

    @pytest.mark.anyio
    async def test_a_saturated_serving_pool_reads_unhealthy(self, monkeypatch):
        """The reported incident: the loop scheduled normally while nothing could run."""

        monkeypatch.setattr(serving_module, "SERVING_PROBE_TIMEOUT", timedelta(seconds=0.2))
        pools = DaemonExecutors.create()
        probe = ServingProbe(pools)
        release = threading.Event()

        try:
            _saturate(pools.listing, release)

            for _ in range(serving_module.SERVING_PROBE_MAX_FAILURES):
                await probe._poll()

            assert probe.healthy is False
            assert probe.failing == ["listing"]
        finally:
            release.set()
            pools.shutdown()

    @pytest.mark.anyio
    async def test_heavy_but_completing_load_stays_healthy(self, monkeypatch):
        """The row that catches an over-eager threshold - a slow daemon is not a hung one."""

        monkeypatch.setattr(serving_module, "SERVING_PROBE_TIMEOUT", timedelta(seconds=5))
        pools = DaemonExecutors.create()
        probe = ServingProbe(pools)
        loop = asyncio.get_running_loop()

        try:
            busy = [
                loop.run_in_executor(pools.listing, lambda: __import__("time").sleep(0.05))
                for _ in range(pools.listing._max_workers * 3)
            ]
            await probe._poll()
            await asyncio.gather(*busy)

            assert probe.healthy is True
            assert probe.failing == []
        finally:
            pools.shutdown()

    @pytest.mark.anyio
    async def test_a_saturated_podman_pool_does_not_trip_the_verdict(self, monkeypatch):
        """Four concurrent 60s spawns are healthy; gating on them would restart a working daemon."""

        monkeypatch.setattr(serving_module, "SERVING_PROBE_TIMEOUT", timedelta(seconds=0.2))
        pools = DaemonExecutors.create()
        probe = ServingProbe(pools)
        release = threading.Event()

        try:
            _saturate(pools.podman, release)
            await probe._poll()

            assert probe.healthy is True
        finally:
            release.set()
            pools.shutdown()

    @pytest.mark.anyio
    async def test_recovers_once_the_backlog_clears(self, monkeypatch):
        """Recovery without a restart is the behaviour that makes shedding unnecessary."""

        monkeypatch.setattr(serving_module, "SERVING_PROBE_TIMEOUT", timedelta(seconds=0.2))
        pools = DaemonExecutors.create()
        probe = ServingProbe(pools)
        release = threading.Event()

        try:
            _saturate(pools.listing, release)

            for _ in range(serving_module.SERVING_PROBE_MAX_FAILURES):
                await probe._poll()

            assert probe.healthy is False

            release.set()
            await asyncio.sleep(0.1)
            await probe._poll()

            assert probe.healthy is True
            assert probe.failing == []
        finally:
            release.set()
            pools.shutdown()

    @pytest.mark.anyio
    async def test_one_failed_probe_does_not_restart_a_busy_daemon(self, monkeypatch):
        """A single spike must not trip it - the host script would restart on that alone."""

        monkeypatch.setattr(serving_module, "SERVING_PROBE_TIMEOUT", timedelta(seconds=0.2))
        pools = DaemonExecutors.create()
        probe = ServingProbe(pools)
        release = threading.Event()

        try:
            _saturate(pools.listing, release)
            await probe._poll()

            assert probe.failing == ["listing"]
            assert probe.consecutive_failures == 1
            assert probe.healthy is True
        finally:
            release.set()
            pools.shutdown()

    @pytest.mark.anyio
    async def test_one_good_probe_clears_the_streak(self, monkeypatch):
        monkeypatch.setattr(serving_module, "SERVING_PROBE_TIMEOUT", timedelta(seconds=0.2))
        pools = DaemonExecutors.create()
        probe = ServingProbe(pools)
        release = threading.Event()

        try:
            _saturate(pools.listing, release)
            await probe._poll()
            release.set()
            await asyncio.sleep(0.1)
            await probe._poll()

            assert probe.consecutive_failures == 0
            assert probe.healthy is True
        finally:
            release.set()
            pools.shutdown()


class TestProbeBound:
    """The bound covers queueing plus execution, so it must clear the work's own contract."""

    def test_the_probe_bound_exceeds_the_listing_bound(self):
        """Listings running their full contractual 15s must not read as a pool that cannot serve."""

        from claudebox_daemon.constants import DISK_LISTING_TIMEOUT, SERVING_PROBE_TIMEOUT

        assert SERVING_PROBE_TIMEOUT > DISK_LISTING_TIMEOUT

    def test_a_full_probe_sweep_fits_inside_the_poller_backstop(self):
        """Every probed pool can hit its bound without AsyncPoller cancelling the sweep."""

        from claudebox.core.polling import MIN_POLL_BOUND, POLL_BOUND_INTERVAL_MULTIPLIER
        from claudebox_daemon.constants import SERVING_PROBE_INTERVAL, SERVING_PROBE_TIMEOUT
        from claudebox_daemon.domain.serving import PROBED_POOLS

        worst_sweep = SERVING_PROBE_TIMEOUT.total_seconds() * len(PROBED_POOLS)
        backstop = max(
            MIN_POLL_BOUND,
            SERVING_PROBE_INTERVAL.total_seconds() * POLL_BOUND_INTERVAL_MULTIPLIER,
        )

        assert worst_sweep < backstop
