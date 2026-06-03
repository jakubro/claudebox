"""Tests for async polling primitives — AsyncPoller and MtimeWatcher."""

import asyncio
from pathlib import Path

import pytest

from claudebox.core.polling import AsyncPoller, MtimeWatcher


# --- AsyncPoller ---


class _StubPoller(AsyncPoller):
    """Poller that counts iterations and optionally raises."""

    def __init__(self, *, interval: float = 0.01, fail_at: int | None = None) -> None:
        super().__init__(interval=interval, name="stub-poller")
        self.poll_count = 0
        self._fail_at = fail_at

    async def _poll(self) -> None:
        self.poll_count += 1
        if self._fail_at is not None and self.poll_count == self._fail_at:
            raise RuntimeError("deliberate failure")


class TestAsyncPoller:
    """Tests for AsyncPoller start/stop lifecycle."""

    @pytest.mark.anyio
    async def test_start_stop_lifecycle(self) -> None:
        """Poller runs iterations between start and stop."""

        poller = _StubPoller(interval=0.01)
        await poller.start()
        await asyncio.sleep(0.05)
        await poller.stop()

        assert poller.poll_count >= 1

    @pytest.mark.anyio
    async def test_stop_without_start(self) -> None:
        """Stopping before starting is a no-op."""

        poller = _StubPoller()
        await poller.stop()
        assert poller._task is None

    @pytest.mark.anyio
    async def test_poll_error_isolated(self) -> None:
        """Errors in _poll don't kill the loop — polling continues."""

        poller = _StubPoller(interval=0.01, fail_at=1)
        await poller.start()
        await asyncio.sleep(0.05)
        await poller.stop()

        assert poller.poll_count >= 2


# --- MtimeWatcher ---


class _StubWatcher(MtimeWatcher):
    """Watcher that records changed paths."""

    def __init__(self, **kwargs) -> None:
        super().__init__(interval=0.01, debounce=0, name="stub-watcher", **kwargs)
        self.changed: list[Path] = []

    async def _on_changed(self, path: Path) -> None:
        self.changed.append(path)


class TestMtimeWatcher:
    """Tests for MtimeWatcher file change detection."""

    def test_watch_registers_file(self, tmp_path: Path) -> None:
        """watch() adds file to watched set."""

        f = tmp_path / "a.txt"
        f.write_text("hello")

        watcher = _StubWatcher()
        watcher.watch(f)

        assert str(f) in watcher._watched

    def test_unwatch_removes_file(self, tmp_path: Path) -> None:
        """unwatch() removes file from watched set."""

        f = tmp_path / "a.txt"
        f.write_text("hello")

        watcher = _StubWatcher()
        watcher.watch(f)
        watcher.unwatch(f)

        assert str(f) not in watcher._watched

    def test_sync_watches_replaces_set(self, tmp_path: Path) -> None:
        """sync_watches() replaces the entire watched set."""

        a = tmp_path / "a.txt"
        b = tmp_path / "b.txt"
        a.write_text("a")
        b.write_text("b")

        watcher = _StubWatcher()
        watcher.watch(a)
        watcher.sync_watches([b])

        assert str(a) not in watcher._watched
        assert str(b) in watcher._watched

    @pytest.mark.anyio
    async def test_detects_mtime_change(self, tmp_path: Path) -> None:
        """Watcher detects file modification and calls _on_changed."""

        import os

        f = tmp_path / "watched.txt"
        f.write_text("v1")

        watcher = _StubWatcher()
        watcher.watch(f)

        # Force mtime change (sub-second writes may share same mtime)
        orig_mtime = f.stat().st_mtime
        f.write_text("v2")
        os.utime(f, (orig_mtime + 1, orig_mtime + 1))

        await watcher.start()
        await asyncio.sleep(0.05)
        await watcher.stop()

        assert f in watcher.changed

    def test_get_mtime_nonexistent(self) -> None:
        """Return 0 for nonexistent files."""

        assert MtimeWatcher._get_mtime(Path("/nonexistent/file.txt")) == 0

    @pytest.mark.anyio
    async def test_debounce_delays_notification(self, tmp_path: Path) -> None:
        """Watcher with debounce waits before calling _on_changed."""

        import os

        f = tmp_path / "debounce.txt"
        f.write_text("v1")

        watcher = _StubWatcher()
        watcher._debounce = 0.03
        watcher.watch(f)

        orig_mtime = f.stat().st_mtime
        f.write_text("v2")
        os.utime(f, (orig_mtime + 1, orig_mtime + 1))

        await watcher.start()
        await asyncio.sleep(0.08)
        await watcher.stop()

        assert f in watcher.changed
