"""Tests for claudebox.concurrency - sync/async bridging."""

import pytest

from claudebox.core.concurrency import maybe_awaitable


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
            await maybe_awaitable(failing())
