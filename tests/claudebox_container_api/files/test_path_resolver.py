"""Tests for claudebox_container_api.files.path_resolver — path resolution and file indexing.

NOTE: path_resolver uses os.walk which follows symlinks by default. This is safe
because the container API runs inside a container with a limited filesystem view —
symlink traversal cannot escape the container boundary. If the resolver is ever
used outside the container, symlink-following should be restricted.
"""

import time

from pathspec import PathSpec

from claudebox_container_api.constants import FILE_INDEX_CACHE_TTL
from claudebox_container_api.files.path_resolver import PathResolver


def _ignore_spec(patterns: list[str] | None = None) -> PathSpec:
    """Build PathSpec from given patterns or return empty spec."""

    return PathSpec.from_lines("gitignore", patterns or [])


class TestPathResolverResolve:
    """Test path candidate resolution."""

    def test_resolves_exact_filename(self, tmp_path):
        (tmp_path / "foo.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["foo.py"], temp_dir=None)

        assert result == {"foo.py": str(tmp_path / "foo.py")}

    def test_resolves_nested_file(self, tmp_path):
        sub = tmp_path / "src"
        sub.mkdir()
        (sub / "bar.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["bar.py"], temp_dir=None)

        assert result == {"bar.py": str(sub / "bar.py")}

    def test_resolves_multi_segment_path(self, tmp_path):
        sub = tmp_path / "src" / "utils"
        sub.mkdir(parents=True)
        (sub / "helper.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["utils/helper.py"], temp_dir=None)

        assert result == {"utils/helper.py": str(sub / "helper.py")}

    def test_returns_empty_for_nonexistent(self, tmp_path):
        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["nonexistent.py"], temp_dir=None)
        assert result == {}

    def test_returns_empty_for_ambiguous(self, tmp_path):
        d1 = tmp_path / "a"
        d1.mkdir()
        (d1 / "dup.py").write_text("")
        d2 = tmp_path / "b"
        d2.mkdir()
        (d2 / "dup.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["dup.py"], temp_dir=None)
        assert result == {}

    def test_resolves_absolute_path(self, tmp_path):
        f = tmp_path / "abs.txt"
        f.write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve([str(f)], temp_dir=None)

        assert result == {str(f): str(f)}

    def test_absolute_nonexistent_not_resolved(self, tmp_path):
        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["/nonexistent/file.txt"], temp_dir=None)
        assert result == {}

    def test_tmp_path_resolved_via_temp_dir(self, tmp_path):
        temp_dir = tmp_path / "session_tmp"
        temp_dir.mkdir()

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["/tmp/output.log"], temp_dir=temp_dir)

        assert result == {"/tmp/output.log": str(temp_dir / "output.log")}

    def test_tmp_root_resolved_via_temp_dir(self, tmp_path):
        temp_dir = tmp_path / "session_tmp"
        temp_dir.mkdir()

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["/tmp"], temp_dir=temp_dir)

        assert result == {"/tmp": str(temp_dir)}

    def test_tmp_path_without_temp_dir_not_resolved(self, tmp_path):
        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["/tmp/file.txt"], temp_dir=None)

        # /tmp/file.txt doesn't exist as absolute, temp_dir is None.
        assert result == {}

    def test_strips_whitespace(self, tmp_path):
        (tmp_path / "spaced.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["  spaced.py  "], temp_dir=None)

        assert "spaced.py" in result

    def test_skips_empty_candidates(self, tmp_path):
        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["", "  ", ""], temp_dir=None)
        assert result == {}


class TestPathResolverIgnoreSpec:
    """Test that ignored files are excluded from the index."""

    def test_ignored_files_not_resolved(self, tmp_path):
        (tmp_path / "secret.env").write_text("")
        (tmp_path / "normal.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec(["*.env"]))
        result = resolver.resolve(["secret.env", "normal.py"], temp_dir=None)

        assert "secret.env" not in result
        assert "normal.py" in result

    def test_git_dir_excluded_from_walk(self, tmp_path):
        git = tmp_path / ".git"
        git.mkdir()
        (git / "config").write_text("")
        (tmp_path / "normal.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["config", "normal.py"], temp_dir=None)

        assert "config" not in result
        assert "normal.py" in result


class TestPathResolverCaching:
    """Test TTL-based cache invalidation."""

    def test_resolve_cache_returns_cached_result(self, tmp_path):
        (tmp_path / "cached.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result1 = resolver.resolve(["cached.py"], temp_dir=None)
        result2 = resolver.resolve(["cached.py"], temp_dir=None)

        assert result1 == result2

    def test_resolve_cache_cleared_on_index_rebuild(self, tmp_path, monkeypatch):
        (tmp_path / "old.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())

        # First resolve — caches "new.py" as not found.
        result1 = resolver.resolve(["new.py"], temp_dir=None)
        assert "new.py" not in result1

        # Advance time past TTL.
        original = time.monotonic()
        monkeypatch.setattr(
            time,
            "monotonic",
            lambda: original + FILE_INDEX_CACHE_TTL.total_seconds() + 1,
        )

        # Create the file — should now be found after index rebuild.
        (tmp_path / "new.py").write_text("")
        result2 = resolver.resolve(["new.py"], temp_dir=None)
        assert "new.py" in result2

    def test_index_within_ttl_not_rebuilt(self, tmp_path):
        (tmp_path / "existing.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        resolver.resolve(["existing.py"], temp_dir=None)

        # Add file within TTL — should NOT be found.
        (tmp_path / "invisible.py").write_text("")
        result = resolver.resolve(["invisible.py"], temp_dir=None)
        assert "invisible.py" not in result
