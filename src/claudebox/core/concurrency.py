"""Concurrency helpers for bridging sync and async boundaries."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable, Hashable
from dataclasses import dataclass
from typing import TypeVar


T = TypeVar("T")


class SingleFlight:
    """Collapse concurrent calls onto one in-flight job, so N callers cost one execution."""

    def __init__(self) -> None:
        self._inflight: asyncio.Future | None = None

    async def run(self, factory: Callable[[], Awaitable[T]]) -> T:
        """Run `factory()`, or join the run already under way."""

        inflight = self._inflight

        if inflight is None or inflight.done():
            inflight = asyncio.ensure_future(factory())
            self._inflight = inflight
            inflight.add_done_callback(self._release)

        return await asyncio.shield(inflight)

    def _release(self, done: asyncio.Future) -> None:
        """Drop the reference once the job settles, so its result is not held alive."""

        if self._inflight is done:
            self._inflight = None


class KeyedSingleFlight:
    """Collapse concurrent calls per key onto one job, cancelled only once every caller has left."""

    def __init__(self) -> None:
        self._flights: dict[Hashable, _Flight] = {}

    async def run(self, key: Hashable, factory: Callable[[], Awaitable[T]]) -> T:
        """Run `factory()` for `key`, or join the run already under way for it."""

        flight = self._flights.get(key)

        if flight is None:
            flight = _Flight(asyncio.ensure_future(factory()))
            self._flights[key] = flight
            flight.task.add_done_callback(lambda _: self._release(key, flight))

        flight.callers += 1

        try:
            return await asyncio.shield(flight.task)
        finally:
            flight.callers -= 1

            if not flight.callers and not flight.task.done():
                # Released now, not on settle: a caller arriving while it unwinds starts afresh.
                self._release(key, flight)
                flight.task.cancel()

    def _release(self, key: Hashable, flight: _Flight) -> None:
        if self._flights.get(key) is flight:
            del self._flights[key]


async def maybe_awaitable[T](res: T | Awaitable[T]) -> T:
    """Await the value if it's awaitable, otherwise return it directly."""

    if inspect.isawaitable(res):
        return await res
    else:
        return res


@dataclass
class _Flight:
    task: asyncio.Future
    callers: int = 0
