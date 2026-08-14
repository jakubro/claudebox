"""Tests for claudebox_container_api.files.path_resolver - path resolution and file indexing.

os.walk follows symlinks by default; safe only because the container API's limited filesystem view blocks escape.
"""

import json
import threading
import time
from pathlib import Path

from pathspec import PathSpec

from claudebox_container_api.constants import (
    FILE_INDEX_CACHE_TTL,
    FILE_INDEX_WALK_TTL_FACTOR,
    PATH_INDEX_FILE,
    PATH_INDEX_LOAD_MAX_AGE,
)
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

        result1 = resolver.resolve(["new.py"], temp_dir=None)
        assert "new.py" not in result1

        original = time.monotonic()
        monkeypatch.setattr(
            time,
            "monotonic",
            lambda: original + FILE_INDEX_CACHE_TTL.total_seconds() + 1,
        )

        (tmp_path / "new.py").write_text("")
        result2 = resolver.resolve(["new.py"], temp_dir=None)
        assert "new.py" in result2

    def test_index_within_ttl_not_rebuilt(self, tmp_path):
        (tmp_path / "existing.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        resolver.resolve(["existing.py"], temp_dir=None)

        (tmp_path / "invisible.py").write_text("")
        result = resolver.resolve(["invisible.py"], temp_dir=None)
        assert "invisible.py" not in result


class TestPathResolverClaudeboxExclusion:
    """Test that claudebox's own state directory is never walked, whatever .ignore says."""

    @staticmethod
    def _seed(tmp_path):
        session = tmp_path / ".claudebox" / "sessions" / "sess-1"
        session.mkdir(parents=True)
        (session / "events.jsonl").write_text('{"type":"user"}\n')
        (tmp_path / "app.py").write_text("")

    def test_index_holds_project_file_and_nothing_from_claudebox(self, tmp_path):
        self._seed(tmp_path)

        resolver = PathResolver(tmp_path, _ignore_spec())
        index = resolver._get_file_index()

        assert "app.py" in index
        assert "events.jsonl" not in index
        assert not [path for paths in index.values() for path in paths if ".claudebox" in path]

    def test_claudebox_file_does_not_resolve(self, tmp_path):
        self._seed(tmp_path)

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["events.jsonl", "app.py"], temp_dir=None)

        assert "events.jsonl" not in result
        assert result["app.py"] == str(tmp_path / "app.py")


class TestPathResolverAvoidsNeedlessWalks:
    """The index is built only when a candidate actually needs it."""

    @staticmethod
    def _counting_resolver(tmp_path, monkeypatch):
        """Return (resolver, counter) where counter[0] counts _build_index calls."""

        resolver = PathResolver(tmp_path, _ignore_spec())
        counter = [0]
        original = resolver._build_index

        def _counted():
            counter[0] += 1

            return original()

        monkeypatch.setattr(resolver, "_build_index", _counted)

        return resolver, counter

    def test_tmp_only_batch_never_walks(self, tmp_path, monkeypatch):
        temp_dir = tmp_path / "session_tmp"
        temp_dir.mkdir()
        resolver, counter = self._counting_resolver(tmp_path, monkeypatch)

        result = resolver.resolve(["/tmp/out.log", "/tmp/err.log"], temp_dir=temp_dir)

        assert result == {
            "/tmp/out.log": str(temp_dir / "out.log"),
            "/tmp/err.log": str(temp_dir / "err.log"),
        }
        assert counter[0] == 0

    def test_absolute_only_batch_never_walks(self, tmp_path, monkeypatch):
        target = tmp_path / "abs.txt"
        target.write_text("")
        resolver, counter = self._counting_resolver(tmp_path, monkeypatch)

        result = resolver.resolve([str(target)], temp_dir=None)

        assert result == {str(target): str(target)}
        assert counter[0] == 0

    def test_one_relative_candidate_still_walks(self, tmp_path, monkeypatch):
        (tmp_path / "app.py").write_text("")
        temp_dir = tmp_path / "session_tmp"
        temp_dir.mkdir()
        resolver, counter = self._counting_resolver(tmp_path, monkeypatch)

        result = resolver.resolve(["/tmp/out.log", "app.py"], temp_dir=temp_dir)

        assert result["app.py"] == str(tmp_path / "app.py")
        assert counter[0] == 1


class TestPathResolverSingleFlight:
    """Concurrent callers past the TTL share one walk instead of racing N."""

    def test_concurrent_rebuilds_walk_once(self, tmp_path, monkeypatch):
        (tmp_path / "app.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        counter = []
        original = resolver._build_index
        threads_count = 8
        at_the_gate = threading.Barrier(threads_count)

        def _slow_build():
            counter.append(1)
            # Sleep long enough that every thread is waiting on the lock, not racing to arrive.
            time.sleep(0.05)

            return original()

        monkeypatch.setattr(resolver, "_build_index", _slow_build)

        def _worker():
            at_the_gate.wait()
            resolver.resolve(["app.py"], temp_dir=None)

        threads = [threading.Thread(target=_worker) for _ in range(threads_count)]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join()

        assert len(counter) == 1


class TestPathResolverAdaptiveTtl:
    """A walk costing more than the nominal TTL must not rebuild on every resolve."""

    def test_ttl_floors_at_a_multiple_of_the_last_walk(self, tmp_path):
        resolver = PathResolver(tmp_path, _ignore_spec())

        assert resolver._index_ttl_seconds() == FILE_INDEX_CACHE_TTL.total_seconds()

        resolver._last_walk_seconds = FILE_INDEX_CACHE_TTL.total_seconds()

        assert resolver._index_ttl_seconds() == (
            FILE_INDEX_CACHE_TTL.total_seconds() * FILE_INDEX_WALK_TTL_FACTOR
        )

    def test_slow_walk_index_survives_past_the_nominal_ttl(self, tmp_path, monkeypatch):
        (tmp_path / "app.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        counter = []
        original = resolver._build_index
        nominal = FILE_INDEX_CACHE_TTL.total_seconds()

        def _counted():
            counter.append(1)

            return original()

        monkeypatch.setattr(resolver, "_build_index", _counted)

        # A walk that cost the whole nominal TTL earns a TTL of N times that.
        now = time.monotonic()
        monkeypatch.setattr(time, "monotonic", lambda: now)
        resolver.resolve(["app.py"], temp_dir=None)
        resolver._last_walk_seconds = nominal

        # Past the nominal TTL but well inside the earned one - still no rebuild.
        monkeypatch.setattr(time, "monotonic", lambda: now + nominal * 2)
        resolver.resolve(["app.py"], temp_dir=None)

        assert len(counter) == 1

        # Past the earned TTL - rebuilds.
        monkeypatch.setattr(
            time,
            "monotonic",
            lambda: now + nominal * FILE_INDEX_WALK_TTL_FACTOR + 1,
        )
        resolver.resolve(["app.py"], temp_dir=None)

        assert len(counter) == 2


class TestPathResolverPersistence:
    """The file index survives a resolver restart via a saved copy on disk."""

    @staticmethod
    def _counting_resolver(resolver, monkeypatch):
        """Patch resolver._build_index to count calls; return the counter."""

        counter = [0]
        original = resolver._build_index

        def _counted():
            counter[0] += 1

            return original()

        monkeypatch.setattr(resolver, "_build_index", _counted)

        return counter

    def test_warm_start_serves_from_persisted_index_without_walking(self, tmp_path, monkeypatch):
        (tmp_path / "app.py").write_text("")

        first = PathResolver(tmp_path, _ignore_spec())
        first.resolve(["app.py"], temp_dir=None)  # builds and persists

        second = PathResolver(tmp_path, _ignore_spec())
        counter = self._counting_resolver(second, monkeypatch)
        result = second.resolve(["app.py"], temp_dir=None)

        assert result == {"app.py": str(tmp_path / "app.py")}
        assert counter[0] == 0

    def test_persisted_index_counts_as_freshly_built_regardless_of_save_age(
        self,
        tmp_path,
        monkeypatch,
    ):
        (tmp_path / "app.py").write_text("")

        first = PathResolver(tmp_path, _ignore_spec())
        first.resolve(["app.py"], temp_dir=None)

        # Backdate past the in-memory TTL, within the load bound - fresh resolver treats it as just-built.
        saved = json.loads(first._index_path.read_text())
        saved["saved_at"] -= FILE_INDEX_CACHE_TTL.total_seconds() * 100
        first._index_path.write_text(json.dumps(saved))

        second = PathResolver(tmp_path, _ignore_spec())
        counter = self._counting_resolver(second, monkeypatch)
        second.resolve(["app.py"], temp_dir=None)

        assert counter[0] == 0

    def test_persisted_index_older_than_load_max_age_ignored(self, tmp_path, monkeypatch):
        (tmp_path / "app.py").write_text("")

        first = PathResolver(tmp_path, _ignore_spec())
        first.resolve(["app.py"], temp_dir=None)

        saved = json.loads(first._index_path.read_text())
        saved["saved_at"] -= PATH_INDEX_LOAD_MAX_AGE.total_seconds() + 1
        first._index_path.write_text(json.dumps(saved))

        second = PathResolver(tmp_path, _ignore_spec())
        counter = self._counting_resolver(second, monkeypatch)
        second.resolve(["app.py"], temp_dir=None)

        assert counter[0] == 1

    def test_moved_file_not_resolved_from_stale_persisted_index(self, tmp_path):
        moved = tmp_path / "moved.py"
        moved.write_text("")

        first = PathResolver(tmp_path, _ignore_spec())
        first.resolve(["moved.py"], temp_dir=None)
        moved.unlink()

        second = PathResolver(tmp_path, _ignore_spec())
        result = second.resolve(["moved.py"], temp_dir=None)

        assert "moved.py" not in result

    def test_new_file_resolves_once_ttl_triggers_a_rebuild(self, tmp_path, monkeypatch):
        (tmp_path / "existing.py").write_text("")

        first = PathResolver(tmp_path, _ignore_spec())
        first.resolve(["existing.py"], temp_dir=None)
        (tmp_path / "new.py").write_text("")

        second = PathResolver(tmp_path, _ignore_spec())

        # Same eventual-consistency contract as an in-memory index: invisible until the next TTL-triggered rebuild.
        original = time.monotonic()
        monkeypatch.setattr(
            time,
            "monotonic",
            lambda: original + FILE_INDEX_CACHE_TTL.total_seconds() + 1,
        )
        result = second.resolve(["new.py"], temp_dir=None)

        assert "new.py" in result

    def test_corrupt_persisted_index_falls_back_to_walk_without_raising(self, tmp_path):
        (tmp_path / "app.py").write_text("")
        index_path = tmp_path / ".claudebox" / PATH_INDEX_FILE
        index_path.parent.mkdir(parents=True)
        index_path.write_text("{not valid json")

        resolver = PathResolver(tmp_path, _ignore_spec())
        result = resolver.resolve(["app.py"], temp_dir=None)

        assert result == {"app.py": str(tmp_path / "app.py")}

    def test_concurrent_persists_leave_a_readable_file(self, tmp_path):
        resolvers = [PathResolver(tmp_path, _ignore_spec()) for _ in range(4)]
        errors = []

        def _persist(resolver, n):
            try:
                resolver._persist_index({f"f{n}.py": [f"f{n}.py"]})
            except Exception as exc:  # pragma: no cover - failure path under test
                errors.append(exc)

        threads = [threading.Thread(target=_persist, args=(r, n)) for n, r in enumerate(resolvers)]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join()

        assert not errors
        # The race leaves a fully-formed, parseable file - never a partial write.
        json.loads(resolvers[0]._index_path.read_text())

    def test_interleaved_persists_promote_one_writers_output(self, tmp_path, monkeypatch):
        resolvers = [PathResolver(tmp_path, _ignore_spec()) for _ in range(2)]
        payloads = [{f"f{n}.py": [f"f{n}.py"]} for n in range(len(resolvers))]
        barrier = threading.Barrier(len(resolvers))
        write_text = Path.write_text

        # Barrier puts both writers mid-write at once, so a shared temp file corrupts every run.
        def _halved(self, data, *args, **kwargs):
            half = len(data) // 2
            write_text(self, data[:half], *args, **kwargs)
            barrier.wait(timeout=5)

            with self.open("a") as handle:
                handle.write(data[half:])

        monkeypatch.setattr(Path, "write_text", _halved)

        threads = [
            threading.Thread(target=resolver._persist_index, args=(payload,))
            for resolver, payload in zip(resolvers, payloads, strict=True)
        ]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join()

        saved = json.loads(resolvers[0]._index_path.read_text())

        assert saved["index"] in payloads

    def test_persisted_index_excludes_config_dir(self, tmp_path):
        session = tmp_path / ".claudebox" / "sessions" / "sess-1"
        session.mkdir(parents=True)
        (session / "events.jsonl").write_text("{}")
        (tmp_path / "app.py").write_text("")

        resolver = PathResolver(tmp_path, _ignore_spec())
        resolver.resolve(["app.py"], temp_dir=None)

        saved = json.loads(resolver._index_path.read_text())
        paths = [p for entries in saved["index"].values() for p in entries]

        assert not [p for p in paths if ".claudebox" in p]
