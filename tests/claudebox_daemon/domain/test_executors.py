"""Tests for claudebox_daemon.domain.executors - per-concern pools and admission tracking."""

import asyncio
import logging
import threading
import time
from unittest.mock import MagicMock

import pytest

import claudebox_daemon.domain.executors as executors_module
from claudebox_daemon.domain.executors import DaemonExecutors, ObservedPool, tracked


class TestPoolIsolation:
    """Saturating one class of blocking work must leave the others serving."""

    @pytest.mark.anyio
    async def test_a_saturated_listing_pool_does_not_delay_state_work(self):
        """The reported outage: queued listings held every worker the registry writes needed too."""

        pools = DaemonExecutors.create()
        release = asyncio.Event()
        loop = asyncio.get_running_loop()

        def _hog():
            while not release.is_set():
                time.sleep(0.01)

        occupied = [
            loop.run_in_executor(pools.listing, _hog) for _ in range(pools.listing._max_workers * 2)
        ]
        await asyncio.sleep(0.05)

        try:
            started = time.monotonic()
            await asyncio.wait_for(
                loop.run_in_executor(pools.state, lambda: "written"),
                timeout=2.0,
            )
            elapsed = time.monotonic() - started
        finally:
            release.set()
            await asyncio.gather(*occupied)
            pools.shutdown()

        assert elapsed < 1.0

    @pytest.mark.anyio
    async def test_a_saturated_listing_pool_does_not_delay_podman_dispatch(self):
        pools = DaemonExecutors.create()
        release = asyncio.Event()
        loop = asyncio.get_running_loop()

        def _hog():
            while not release.is_set():
                time.sleep(0.01)

        occupied = [
            loop.run_in_executor(pools.listing, _hog) for _ in range(pools.listing._max_workers * 2)
        ]
        await asyncio.sleep(0.05)

        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(pools.podman, lambda: "dispatched"),
                timeout=2.0,
            )
        finally:
            release.set()
            await asyncio.gather(*occupied)
            pools.shutdown()

        assert result == "dispatched"

    def test_every_concern_gets_its_own_pool(self):
        pools = DaemonExecutors.create()

        try:
            assert len({id(pools.listing), id(pools.podman), id(pools.state)}) == 3
        finally:
            pools.shutdown()

    def test_shutdown_releases_every_pool(self):
        pools = DaemonExecutors.create()
        pools.shutdown()

        for pool in (pools.listing, pools.podman, pools.state):
            with pytest.raises(RuntimeError):
                pool.submit(lambda: None)


class TestPoolObservability:
    """Queue depth and oldest-queued age were unmeasured, so saturation had no evidence."""

    @staticmethod
    def _saturate(pool, release: threading.Event, extra: int) -> None:
        """Occupy every worker, then queue `extra` jobs behind them."""

        for _ in range(pool._max_workers + extra):
            pool.submit(release.wait)

    def test_reports_queue_depth_and_oldest_wait_while_backed_up(self):
        pool = ObservedPool(2, name="listing")
        release = threading.Event()

        try:
            self._saturate(pool, release, extra=3)
            time.sleep(0.1)
            stats = pool.stats()

            assert stats.name == "listing"
            assert stats.workers == 2
            assert stats.running == 2
            assert stats.queued == 3
            assert stats.oldest_queued_seconds >= 0.1
        finally:
            release.set()
            pool.shutdown()

    def test_an_idle_pool_reports_an_empty_backlog(self):
        pool = ObservedPool(2, name="state")

        try:
            pool.submit(lambda: None).result(timeout=2)
            stats = pool.stats()

            assert stats.queued == 0
            assert stats.running == 0
            assert stats.oldest_queued_seconds == 0.0
        finally:
            pool.shutdown()

    def test_saturated_names_the_backed_up_pool_and_leaves_idle_ones_out(self):
        pools = DaemonExecutors.create()
        release = threading.Event()

        try:
            self._saturate(pools.listing, release, extra=2)
            time.sleep(0.05)

            assert pools.saturated() == ["listing"]
            assert pools.stats()["listing"]["queued"] >= 1
            assert pools.stats()["podman"]["queued"] == 0
        finally:
            release.set()
            pools.shutdown()

    def test_stats_covers_every_pool(self):
        pools = DaemonExecutors.create()

        try:
            assert set(pools.stats()) == {"listing", "podman", "state"}
        finally:
            pools.shutdown()

    def test_a_long_queue_wait_is_reported_once_the_job_runs(self, caplog):
        """The signal that was missing entirely - a full pool used to look identical to an idle one."""

        pool = ObservedPool(1, name="listing")
        release = threading.Event()

        try:
            with caplog.at_level(logging.WARNING):
                pool.submit(release.wait)
                queued = pool.submit(lambda: "late")
                time.sleep(executors_module.QUEUE_WARN_SECONDS + 0.2)
                release.set()

                assert queued.result(timeout=2) == "late"

            assert "pool_queue_backlog" in caplog.text
        finally:
            release.set()
            pool.shutdown()

    def test_a_prompt_job_is_not_reported(self):
        pool = ObservedPool(2, name="state")

        try:
            admissions_logged = []
            pool._logger = MagicMock()
            pool._logger.warning = lambda *a, **kw: admissions_logged.append(kw)
            pool.submit(lambda: None).result(timeout=2)

            assert admissions_logged == []
        finally:
            pool.shutdown()


class TestAdmission:
    """A bound around a dispatch covers queueing plus execution; the log must tell them apart."""

    def test_a_job_that_never_ran_reports_not_started(self):
        _wrapped, admission = tracked(lambda: "unused")

        assert admission.started is False
        assert admission.queued_seconds >= 0

    def test_a_job_that_ran_reports_started(self):
        wrapped, admission = tracked(lambda: "done")

        assert wrapped() == "done"
        assert admission.started is True

    def test_queued_seconds_stops_climbing_once_a_worker_picks_it_up(self):
        wrapped, admission = tracked(lambda: None)

        time.sleep(0.02)
        wrapped()
        settled = admission.queued_seconds
        time.sleep(0.02)

        assert admission.queued_seconds == settled
        assert settled >= 0.02

    def test_running_seconds_stops_climbing_once_the_job_finishes(self):
        wrapped, admission = tracked(lambda: time.sleep(0.02))

        wrapped()
        settled = admission.running_seconds
        time.sleep(0.02)

        assert admission.running_seconds == settled
        assert settled >= 0.02

    def test_a_dispatch_cancelled_before_it_runs_stops_being_counted(self):
        """A cancelled queued job never runs the wrapper, so wrapper-side cleanup can never fire."""

        pool = ObservedPool(1, name="state")
        release = threading.Event()

        try:
            occupier = pool.submit(release.wait)
            queued = pool.submit(lambda: "never runs")
            time.sleep(0.05)

            assert pool.stats().queued == 1
            assert queued.cancel()

            release.set()
            occupier.result(timeout=2)
            time.sleep(0.05)

            assert pool.stats().queued == 0
            assert pool.stats().running == 0
        finally:
            release.set()
            pool.shutdown()

    def test_a_submit_that_fails_is_not_counted(self):
        pool = ObservedPool(1, name="state")
        pool.shutdown()

        with pytest.raises(RuntimeError):
            pool.submit(lambda: None)

        assert pool.stats().queued == 0
        assert pool.stats().running == 0
