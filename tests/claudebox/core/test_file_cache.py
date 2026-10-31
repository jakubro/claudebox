"""Tests for claudebox.core.file_cache - stamp-keyed file cache and settle window."""

from __future__ import annotations

import os
import time
from time import time_ns

import pytest

from claudebox.core import file_cache
from claudebox.core.file_cache import FileCache, file_stamp


@pytest.fixture
def settled_clock(monkeypatch):
    """Read every stamp an hour from now, so any file written in the test counts as settled."""

    monkeypatch.setattr(file_cache, "time_ns", lambda: time_ns() + 3600 * 10**9)


class TestFileCache:
    """Test cache miss, hit, stat invalidation, and pruning."""

    def test_cache_miss_calls_callback(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("content")

        calls = []

        def loader():
            calls.append(1)

            return "loaded"

        result = cache.get(path, loader)
        assert result == "loaded"
        assert len(calls) == 1

    def test_cache_hit_skips_callback(self, tmp_path, settled_clock):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("content")

        calls = []

        def loader():
            calls.append(1)

            return "loaded"

        cache.get(path, loader)
        result = cache.get(path, loader)
        assert result == "loaded"
        assert len(calls) == 1

    def test_mtime_change_invalidates(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("v1")

        cache.get(path, lambda: "first")

        # Force mtime change (avoids flaky sleep on coarse-grained filesystems)
        path.write_text("v2")
        os.utime(path, (path.stat().st_atime, path.stat().st_mtime + 2))

        result = cache.get(path, lambda: "second")
        assert result == "second"

    def test_missing_file_still_loads(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "missing.txt"

        result = cache.get(path, lambda: "default")
        assert result == "default"

    def test_string_path_accepted(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("content")

        result = cache.get(str(path), lambda: "ok")
        assert result == "ok"

    def test_size_change_within_one_mtime_tick_invalidates(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("v1")
        stat = path.stat()
        cache.get(path, lambda: "first")

        path.write_text("v1 longer")
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))

        assert cache.get(path, lambda: "second") == "second"

    def test_a_write_during_the_callback_is_reread_next_time(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("v1")

        def load_while_a_writer_lands():
            value = path.read_text()
            path.write_text("v2 written mid-read")

            return value

        assert cache.get(path, load_while_a_writer_lands) == "v1"
        assert cache.get(path, path.read_text) == "v2 written mid-read"

    def test_a_failing_callback_caches_nothing(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("v1")

        def fail():
            raise ValueError("unreadable")

        with pytest.raises(ValueError, match="unreadable"):
            cache.get(path, fail)

        assert cache.get(path, lambda: "retried") == "retried"

    def test_retain_drops_paths_not_named(self, tmp_path, settled_clock):
        cache = FileCache()
        kept, dropped = tmp_path / "kept.txt", tmp_path / "dropped.txt"
        kept.write_text("k")
        dropped.write_text("d")
        cache.get(kept, lambda: "kept")
        cache.get(dropped, lambda: "dropped")

        cache.retain([kept])

        assert cache.get(kept, lambda: "reloaded") == "kept"
        assert cache.get(dropped, lambda: "reloaded") == "reloaded"

    def test_a_same_size_rewrite_within_one_mtime_tick_is_reread(self, tmp_path, settled_clock):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("alpha")
        stat = path.stat()
        cache.get(path, lambda: "first")
        # Past the file clock's tick, so the rewrite's change time differs while mtime is restored.
        time.sleep(0.05)

        path.write_text("omega")
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))

        assert cache.get(path, lambda: "second") == "second"

    def test_a_rewrite_leaving_every_stat_field_equal_is_reread_while_unsettled(
        self,
        tmp_path,
        monkeypatch,
    ):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("v1")
        recorded = os.stat(path)
        monkeypatch.setattr(file_cache.os, "stat", lambda _: recorded)
        calls = []

        cache.get(path, lambda: calls.append(1))
        cache.get(path, lambda: calls.append(2))

        assert calls == [1, 2]

    def test_a_settled_unchanged_file_is_served_from_cache(self, tmp_path, settled_clock):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("v1")
        calls = []

        cache.get(path, lambda: calls.append(1))
        cache.get(path, lambda: calls.append(2))

        assert calls == [1]

    def test_an_unsettled_file_is_reread_on_every_get(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "data.txt"
        path.write_text("v1")
        calls = []

        cache.get(path, lambda: calls.append(1))
        cache.get(path, lambda: calls.append(2))

        assert calls == [1, 2]

    def test_file_stamp_of_a_missing_file_is_none(self, tmp_path):
        assert file_stamp(tmp_path / "missing.txt") is None

    def test_a_missing_file_stays_cached(self, tmp_path):
        cache = FileCache()
        path = tmp_path / "missing.txt"
        calls = []

        cache.get(path, lambda: calls.append(1))
        cache.get(path, lambda: calls.append(2))

        assert calls == [1]
