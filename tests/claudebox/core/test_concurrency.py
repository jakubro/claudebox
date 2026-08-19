"""Tests for claudebox.concurrency - sync/async bridging and call collapsing."""

import asyncio

import pytest

from claudebox.core.concurrency import SingleFlight, maybe_awaitable


class TestMaybeAwaitable:
    """Test awaiting sync and async values."""

    @pytest.mark.anyio
    async def test_returns_sync_value(self):
        result = await maybe_awaitable(42)
        assert result == 42

    @pytest.mark.anyio
    async def test_returns_none(self):
        result = await maybe_awaitable(None)
        assert result is None

    @pytest.mark.anyio
    async def test_awaits_coroutine(self):
        async def async_fn():
            return "async_result"

        result = await maybe_awaitable(async_fn())
        assert result == "async_result"

    @pytest.mark.anyio
    async def test_returns_string(self):
        result = await maybe_awaitable("hello")
        assert result == "hello"

    @pytest.mark.anyio
    async def test_awaits_failing_coroutine(self):
        """Exception from awaited coroutine propagates to caller."""

        async def failing():
            raise ValueError("boom")

        with pytest.raises(ValueError, match="boom"):
            # Result deliberately discarded - the raise is what's under test.
            await maybe_awaitable(failing())


class TestSingleFlight:
    """Concurrent callers share one execution; an abandoned caller doesn't take it down."""

    @staticmethod
    def _counting_job(calls: list, release: asyncio.Event):
        """Job that records each start and blocks until `release` is set."""

        async def _job():
            calls.append(1)
            await release.wait()

            return len(calls)

        return _job

    @pytest.mark.anyio
    async def test_concurrent_callers_run_the_job_once(self):
        flight = SingleFlight()
        calls: list = []
        release = asyncio.Event()
        job = self._counting_job(calls, release)

        waiters = [asyncio.create_task(flight.run(job)) for _ in range(10)]
        await asyncio.sleep(0)
        release.set()
        results = await asyncio.gather(*waiters)

        assert len(calls) == 1
        assert results == [1] * 10

    @pytest.mark.anyio
    async def test_sequential_callers_each_get_a_fresh_run(self):
        flight = SingleFlight()
        calls: list = []

        async def _job():
            calls.append(1)

            return len(calls)

        assert await flight.run(_job) == 1
        assert await flight.run(_job) == 2
        assert len(calls) == 2

    @pytest.mark.anyio
    async def test_abandoning_one_caller_leaves_the_others_served(self):
        """A listing that times out must not cancel the scan its co-callers are waiting on."""

        flight = SingleFlight()
        calls: list = []
        release = asyncio.Event()
        job = self._counting_job(calls, release)

        quitter = asyncio.create_task(flight.run(job))
        stayer = asyncio.create_task(flight.run(job))
        await asyncio.sleep(0)

        quitter.cancel()

        with pytest.raises(asyncio.CancelledError):
            await quitter

        release.set()

        assert await stayer == 1
        assert len(calls) == 1

    @pytest.mark.anyio
    async def test_failure_reaches_every_caller(self):
        flight = SingleFlight()
        release = asyncio.Event()

        async def _job():
            await release.wait()

            raise ValueError("boom")

        waiters = [asyncio.create_task(flight.run(_job)) for _ in range(3)]
        await asyncio.sleep(0)
        release.set()
        results = await asyncio.gather(*waiters, return_exceptions=True)

        assert all(isinstance(r, ValueError) for r in results)

    @pytest.mark.anyio
    async def test_a_failed_run_does_not_poison_the_next_one(self):
        flight = SingleFlight()

        async def _failing():
            raise ValueError("boom")

        async def _working():
            return "ok"

        with pytest.raises(ValueError, match="boom"):
            await flight.run(_failing)

        assert await flight.run(_working) == "ok"
