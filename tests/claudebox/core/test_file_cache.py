"""Tests for claudebox.core.file_cache — mtime-based file cache."""

import os

from claudebox.core.file_cache import FileCache


class TestFileCache:
    """Test cache miss, hit, and mtime invalidation."""

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

    def test_cache_hit_skips_callback(self, tmp_path):
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

    def test_missing_file_uses_zero_mtime(self, tmp_path):
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
