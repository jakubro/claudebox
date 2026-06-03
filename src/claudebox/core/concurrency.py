"""Concurrency helpers for bridging sync and async boundaries."""

import inspect
from collections.abc import Awaitable
from typing import TypeVar


T = TypeVar("T")


async def maybe_awaitable(res: T | Awaitable[T]) -> T:
    """Await the value if it's awaitable, otherwise return it directly."""

    if inspect.isawaitable(res):
        return await res  # ty: ignore[invalid-return-type]
    else:
        return res
