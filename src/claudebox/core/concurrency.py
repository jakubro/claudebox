"""Concurrency helpers for bridging sync and async boundaries."""

import asyncio
import inspect
from collections.abc import Awaitable, Callable
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


async def maybe_awaitable[T](res: T | Awaitable[T]) -> T:
    """Await the value if it's awaitable, otherwise return it directly."""

    if inspect.isawaitable(res):
        return await res  # ty: ignore[invalid-return-type]
    else:
        return res
