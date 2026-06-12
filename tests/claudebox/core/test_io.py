"""Tests for claudebox.io - file I/O utilities."""

import json
import tomllib

import pytest

from claudebox.core.io import (
    append_json,
    append_text,
    calculate_hash,
    count_lines,
    read_json,
    read_jsonl,
    read_toml,
    write_json,
    write_text,
)


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
