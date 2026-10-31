"""Tests for claudebox.io - file I/O utilities."""

from __future__ import annotations

import json
import threading
import tomllib
from pathlib import Path

import pytest
from structlog.testing import capture_logs

from claudebox.core.io import (
    append_json,
    append_text,
    calculate_hash,
    count_lines,
    read_json,
    read_jsonl,
    read_jsonl_from,
    read_jsonl_tail,
    read_toml,
    repair_jsonl_tail,
    write_json,
    write_text,
)
from claudebox.core.logging import get_logger


# --- write_text / append_text ---


class TestWriteText:
    """Test text file writing."""

    def test_writes_content(self, tmp_path):
        path = tmp_path / "file.txt"
        write_text(path, "hello")
        assert path.read_text() == "hello"

    def test_creates_parent_dirs(self, tmp_path):
        path = tmp_path / "a" / "b" / "file.txt"
        write_text(path, "nested")
        assert path.read_text() == "nested"

    def test_overwrites_existing(self, tmp_path):
        path = tmp_path / "file.txt"
        write_text(path, "first")
        write_text(path, "second")
        assert path.read_text() == "second"

    def test_converts_non_string(self, tmp_path):
        path = tmp_path / "file.txt"
        write_text(path, 42)
        assert path.read_text() == "42"

    def test_accepts_string_path(self, tmp_path):
        path = str(tmp_path / "file.txt")
        write_text(path, "hello")
        assert (tmp_path / "file.txt").read_text() == "hello"


class TestWriteTextAtomicity:
    """Test that a write is published whole - readers never observe an intermediate state."""

    def test_reader_mid_write_sees_previous_content(self, tmp_path, monkeypatch):
        path = tmp_path / "state.json"
        write_json(path, {"generation": 1})

        halfway = threading.Event()
        resume = threading.Event()
        unpatched = Path.write_text

        # Parks a writer with half its payload on disk, so the reader runs against that exact state.
        def _halted(self, data, *args, **kwargs):
            split = len(data) // 2
            unpatched(self, data[:split], *args, **kwargs)
            halfway.set()
            resume.wait(timeout=5)

            with self.open("a") as handle:
                handle.write(data[split:])

        monkeypatch.setattr(Path, "write_text", _halted)
        writer = threading.Thread(target=write_json, args=(path, {"generation": 2}))
        writer.start()

        try:
            halfway.wait(timeout=5)
            observed = read_json(path, default=None)
        finally:
            resume.set()
            writer.join(timeout=5)

        assert observed == {"generation": 1}

    def test_publishes_the_new_content_once_complete(self, tmp_path):
        path = tmp_path / "state.json"
        write_json(path, {"generation": 1})
        write_json(path, {"generation": 2})

        assert read_json(path) == {"generation": 2}

    def test_leaves_no_temp_file_behind(self, tmp_path):
        path = tmp_path / "state.json"
        write_json(path, {"generation": 1})

        siblings = [p.name for p in tmp_path.iterdir() if p.name.startswith(path.name)]
        assert siblings == [path.name]

    def test_writes_through_a_symlink_to_its_target(self, tmp_path):
        target = tmp_path / "real.json"
        link = tmp_path / "link.json"
        write_json(target, {"generation": 1})
        link.symlink_to(target)

        write_json(link, {"generation": 2})

        assert link.is_symlink()
        assert read_json(target) == {"generation": 2}

    def test_preserves_the_target_file_mode(self, tmp_path):
        path = tmp_path / "state.json"
        write_json(path, {"generation": 1})
        path.chmod(0o600)

        write_json(path, {"generation": 2})

        assert path.stat().st_mode & 0o777 == 0o600


class TestAppendText:
    """Test text file appending."""

    def test_appends_with_newline(self, tmp_path):
        path = tmp_path / "file.txt"
        append_text(path, "line1")
        append_text(path, "line2")
        assert path.read_text() == "line1\nline2\n"

    def test_creates_parent_dirs(self, tmp_path):
        path = tmp_path / "a" / "b" / "file.txt"
        append_text(path, "hello")
        assert path.exists()


# --- write_json / append_json ---


class TestWriteJson:
    """Test JSON file writing."""

    def test_writes_dict(self, tmp_path):
        path = tmp_path / "data.json"
        write_json(path, {"key": "value"})
        content = path.read_text()
        assert '"key"' in content
        assert '"value"' in content

    def test_creates_parent_dirs(self, tmp_path):
        path = tmp_path / "a" / "data.json"
        write_json(path, {"x": 1})
        assert path.exists()


class TestAppendJson:
    """Test JSONL appending."""

    def test_appends_json_lines(self, tmp_path):
        path = tmp_path / "data.jsonl"
        append_json(path, {"a": 1})
        append_json(path, {"b": 2})
        lines = path.read_text().strip().split("\n")
        assert len(lines) == 2


# --- count_lines ---


class TestCountLines:
    """Test line counting."""

    def test_counts_lines(self, tmp_path):
        path = tmp_path / "file.txt"
        path.write_text("a\nb\nc\n")
        assert count_lines(path) == 3

    def test_single_line_no_trailing_newline(self, tmp_path):
        path = tmp_path / "file.txt"
        path.write_text("hello")
        assert count_lines(path) == 1

    def test_empty_file(self, tmp_path):
        path = tmp_path / "file.txt"
        path.write_text("")
        assert count_lines(path) == 0

    def test_missing_file_returns_zero(self, tmp_path):
        path = tmp_path / "nonexistent.txt"
        assert count_lines(path) == 0


# --- calculate_hash ---


class TestCalculateHash:
    """Test SHA256 hashing."""

    def test_returns_hex_digest(self, tmp_path):
        path = tmp_path / "file.txt"
        path.write_text("hello")
        result = calculate_hash(path)
        assert isinstance(result, str)
        assert len(result) == 64

    def test_deterministic(self, tmp_path):
        path = tmp_path / "file.txt"
        path.write_text("hello")
        assert calculate_hash(path) == calculate_hash(path)

    def test_different_content_different_hash(self, tmp_path):
        a = tmp_path / "a.txt"
        b = tmp_path / "b.txt"
        a.write_text("hello")
        b.write_text("world")
        assert calculate_hash(a) != calculate_hash(b)


# --- read_json ---


class TestReadJson:
    """Test JSON file reading."""

    def test_reads_dict(self, tmp_path):
        path = tmp_path / "data.json"
        write_json(path, {"key": "value"})
        result = read_json(path)
        assert result == {"key": "value"}

    def test_missing_file_with_default(self, tmp_path):
        path = tmp_path / "missing.json"
        assert read_json(path, default=None) is None

    def test_missing_file_without_default_raises(self, tmp_path):
        path = tmp_path / "missing.json"

        with pytest.raises(FileNotFoundError):
            read_json(path)

    def test_default_none_is_valid(self, tmp_path):
        path = tmp_path / "missing.json"
        assert read_json(path, default=None) is None

    def test_default_empty_dict(self, tmp_path):
        path = tmp_path / "missing.json"
        assert read_json(path, default={}) == {}


# --- read_jsonl ---


@pytest.fixture
def logs():
    """Captured structlog events; logging is configured first, which would otherwise reset capture."""

    get_logger()

    with capture_logs() as captured:
        yield captured


class TestReadJsonl:
    """Test JSONL file reading."""

    def test_reads_multiple_lines(self, tmp_path):
        path = tmp_path / "data.jsonl"
        append_json(path, {"a": 1})
        append_json(path, {"b": 2})
        result = list(read_jsonl(path))
        assert result == [{"a": 1}, {"b": 2}]

    def test_missing_file_yields_nothing(self, tmp_path):
        path = tmp_path / "missing.jsonl"
        result = list(read_jsonl(path))
        assert result == []

    def test_empty_file(self, tmp_path):
        path = tmp_path / "empty.jsonl"
        path.write_text("")
        result = list(read_jsonl(path))
        assert result == []

    def test_blank_lines_between_records(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n\n{"b": 2}\n\n')
        result = list(read_jsonl(path))
        assert result == [{"a": 1}, {"b": 2}]

    def test_whitespace_only_lines_skipped(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n   \n\t\n{"b": 2}\n')
        result = list(read_jsonl(path))
        assert result == [{"a": 1}, {"b": 2}]

    def test_warns_on_a_complete_line_that_does_not_parse(self, tmp_path, logs):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{ broken\n{"b": 2}\n')

        result = list(read_jsonl(path))

        assert result == [{"a": 1}, {"b": 2}]
        assert [(log["log_level"], log["line"]) for log in logs] == [("warning", 2)]

    def test_an_unterminated_last_line_is_skipped_silently(self, tmp_path, logs):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"b": 2')

        result = list(read_jsonl(path))

        assert result == [{"a": 1}]
        assert logs == []

    def test_a_complete_last_record_without_newline_is_read(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"b": 2}')

        assert list(read_jsonl(path)) == [{"a": 1}, {"b": 2}]


class TestReadJsonlTail:
    """The last lines of a JSONL file, read back from its end."""

    def test_returns_the_last_lines_oldest_first(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text("".join(f'{{"n": {n}}}\n' for n in range(5000)))

        assert read_jsonl_tail(path, 3) == [{"n": 4997}, {"n": 4998}, {"n": 4999}]

    def test_a_tail_spanning_many_read_blocks_is_whole(self, tmp_path):
        path = tmp_path / "data.jsonl"
        filler = "x" * 900
        path.write_text("".join(f'{{"n": {n}, "pad": "{filler}"}}\n' for n in range(400)))

        result = read_jsonl_tail(path, 300)

        assert [r["n"] for r in result] == list(range(100, 400))

    def test_a_short_file_is_returned_whole(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n\n{"b": 2}\n')

        assert read_jsonl_tail(path, 1000) == [{"a": 1}, {"b": 2}]

    def test_a_complete_last_record_without_newline_is_read(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"b": 2}')

        assert read_jsonl_tail(path, 1) == [{"b": 2}]

    def test_an_unterminated_last_line_is_skipped_silently(self, tmp_path, logs):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"b": 2')

        assert read_jsonl_tail(path, 5) == [{"a": 1}]
        assert logs == []

    def test_a_damaged_line_is_recovered_and_reported_by_offset(self, tmp_path, logs):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"torn": "ZZ{"b": 2}\n')

        assert read_jsonl_tail(path, 5) == [{"a": 1}, {"b": 2}]
        assert [(log["log_level"], log["offset"]) for log in logs] == [("warning", 9)]

    def test_missing_file_is_empty(self, tmp_path):
        assert read_jsonl_tail(tmp_path / "missing.jsonl", 10) == []


class TestReadJsonlFrom:
    """The complete lines after a byte offset, and where the next read resumes."""

    def test_reads_only_the_lines_after_the_offset(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"b": 2}\n')

        assert read_jsonl_from(path, 9) == ([{"b": 2}], 18)

    def test_offset_zero_reads_the_whole_file(self, tmp_path):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n\n{"b": 2}\n')

        assert read_jsonl_from(path, 0) == ([{"a": 1}, {"b": 2}], 19)

    def test_an_unterminated_last_line_waits_for_the_next_read(self, tmp_path, logs):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"b": 2')

        assert read_jsonl_from(path, 0) == ([{"a": 1}], 9)
        assert logs == []

        with path.open("a") as f:
            f.write("}\n")

        assert read_jsonl_from(path, 9) == ([{"b": 2}], 18)

    def test_a_damaged_line_is_recovered_and_reported_by_offset(self, tmp_path, logs):
        path = tmp_path / "data.jsonl"
        path.write_text('{"a": 1}\n{"torn": "ZZ{"b": 2}\n')

        assert read_jsonl_from(path, 0) == ([{"a": 1}, {"b": 2}], 30)
        assert [(log["log_level"], log["offset"]) for log in logs] == [("warning", 9)]

    def test_missing_file_reads_nothing_at_offset_zero(self, tmp_path):
        assert read_jsonl_from(tmp_path / "missing.jsonl", 40) == ([], 0)


class TestReadJsonlDamagedLine:
    """A record appended to another writer's torn fragment is recovered; only the fragment is lost."""

    def test_recovers_the_record_appended_to_a_torn_fragment(self, tmp_path, logs):
        path = tmp_path / "log.jsonl"
        path.write_text('{"id": "r1"}\n{"event": "torn", "blob": "ZZ{"id": "r2"}\n')

        result = list(read_jsonl(path))

        assert result == [{"id": "r1"}, {"id": "r2"}]
        assert [(log["log_level"], log["line"], log["bytes_dropped"]) for log in logs] == [
            ("warning", 2, 29),
        ]

    def test_recovers_every_complete_record_after_the_fragment(self, tmp_path):
        path = tmp_path / "log.jsonl"
        path.write_text('{"event": "to{"id": "r2"}{"id": "r3"}\n')

        assert list(read_jsonl(path)) == [{"id": "r2"}, {"id": "r3"}]

    def test_garbage_with_no_record_yields_nothing_and_warns(self, tmp_path, logs):
        path = tmp_path / "log.jsonl"
        path.write_text('{"id": "r1"}\nZZZZ {not json\n')

        assert list(read_jsonl(path)) == [{"id": "r1"}]
        assert [(log["log_level"], log["line"]) for log in logs] == [("warning", 2)]

    def test_a_clean_record_holding_braces_in_a_string_is_never_split(self, tmp_path, logs):
        path = tmp_path / "log.jsonl"
        path.write_text('{"message": "payload {\\"id\\": \\"inner\\"} sent"}\n')

        assert list(read_jsonl(path)) == [{"message": 'payload {"id": "inner"} sent'}]
        assert logs == []

    def test_reports_the_damage_once_across_reads(self, tmp_path, logs):
        path = tmp_path / "log.jsonl"
        path.write_text('{"event": "torn{"id": "r2"}\n')

        first = list(read_jsonl(path))
        second = list(read_jsonl(path))

        assert first == second == [{"id": "r2"}]
        assert len(logs) == 1


# --- repair_jsonl_tail ---


REC1 = b'{"id": "e1"}\n'
REC2 = b'{"id": "e2"}'


class TestRepairJsonlTail:
    """The next append to a repaired log starts on a line of its own."""

    @pytest.mark.parametrize(
        ("content", "expected"),
        [
            (REC1 + b'{"id": "e2", "content": "hal', REC1),
            (REC1 + REC2, REC1 + REC2 + b"\n"),
            (REC1 + b"\x00" * 37, REC1),
            (b'{"id": "e1", "con', b""),
            (REC1 + b'{"blob": "' + b"x" * (200 * 1024), REC1),
            (REC1 + b"[1, 2]", REC1),
            (REC1, REC1),
            (b"", b""),
        ],
        ids=[
            "torn",
            "newline-lost",
            "nul-tail",
            "fragment-only",
            "fragment-over-a-chunk",
            "not-an-object",
            "clean",
            "empty",
        ],
    )
    def test_repairs_the_tail(self, tmp_path, content, expected):
        path = tmp_path / "events.jsonl"
        path.write_bytes(content)

        repair_jsonl_tail(path)

        assert path.read_bytes() == expected

    def test_a_missing_file_is_not_created(self, tmp_path):
        path = tmp_path / "events.jsonl"

        repair_jsonl_tail(path)

        assert not path.exists()

    def test_a_truncation_is_logged_without_content(self, tmp_path, logs):
        path = tmp_path / "events.jsonl"
        path.write_bytes(REC1 + b'{"secret": "hal')

        repair_jsonl_tail(path)

        assert [(log["log_level"], log["offset"], log["bytes_dropped"]) for log in logs] == [
            ("warning", 13, 15),
        ]
        assert "secret" not in str(logs)


# --- read_toml ---


class TestReadToml:
    """Test TOML file reading."""

    def test_reads_toml(self, tmp_path):
        path = tmp_path / "config.toml"
        path.write_text('[section]\nkey = "value"\n')
        result = read_toml(path)
        assert result == {"section": {"key": "value"}}

    def test_missing_file_with_default(self, tmp_path):
        path = tmp_path / "missing.toml"
        assert read_toml(path, default={}) == {}

    def test_missing_file_without_default_raises(self, tmp_path):
        path = tmp_path / "missing.toml"

        with pytest.raises(FileNotFoundError):
            read_toml(path)

    def test_invalid_toml_raises(self, tmp_path):
        path = tmp_path / "bad.toml"
        path.write_text("[broken\nno closing bracket")

        with pytest.raises(tomllib.TOMLDecodeError):
            read_toml(path)


# --- error paths ---


class TestReadJsonCorrupt:
    """Test read_json with corrupt content."""

    def test_corrupt_json_raises(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text("{not valid json")

        with pytest.raises(json.JSONDecodeError):
            read_json(path)


class TestCalculateHashMissing:
    """Test calculate_hash with missing file."""

    def test_missing_file_raises(self, tmp_path):
        path = tmp_path / "nonexistent.txt"

        with pytest.raises(FileNotFoundError):
            calculate_hash(path)
