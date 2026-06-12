"""filesystem.py @tool tests - read_file, write_file, edit_file."""

import pytest

from claudebox.agent_session.langgraph_tools.filesystem import make_filesystem_tools


def _tools(tool_ctx):
    by_name = {tool_obj.name: tool_obj for tool_obj in make_filesystem_tools(tool_ctx)}

    return by_name["read_file"], by_name["write_file"], by_name["edit_file"]


class TestReadFile:
    def test_returns_full_content(self, tool_ctx, tmp_path):
        target = tmp_path / "hello.txt"
        target.write_text("line one\nline two\n")
        read_file, _, _ = _tools(tool_ctx)

        assert read_file.invoke({"path": str(target)}) == "line one\nline two\n"


class TestWriteFile:
    def test_writes_content_and_returns_byte_count(self, tool_ctx, tmp_path):
        target = tmp_path / "out.txt"
        _, write_file, _ = _tools(tool_ctx)

        result = write_file.invoke({"path": str(target), "content": "abc"})

        assert target.read_text() == "abc"
        assert "Wrote 3 bytes" in result

    def test_creates_parent_dirs(self, tool_ctx, tmp_path):
        target = tmp_path / "nested" / "deep" / "out.txt"
        _, write_file, _ = _tools(tool_ctx)

        write_file.invoke({"path": str(target), "content": "x"})

        assert target.read_text() == "x"


class TestEditFile:
    def test_single_occurrence_replace(self, tool_ctx, tmp_path):
        target = tmp_path / "f.txt"
        target.write_text("hello world\n")
        _, _, edit_file = _tools(tool_ctx)

        edit_file.invoke({"path": str(target), "old_string": "world", "new_string": "claude"})

        assert target.read_text() == "hello claude\n"

    def test_multiple_occurrences_without_replace_all_raises(self, tool_ctx, tmp_path):
        target = tmp_path / "f.txt"
        target.write_text("a a a\n")
        _, _, edit_file = _tools(tool_ctx)

        with pytest.raises(Exception, match="occurs 3 times"):
            edit_file.invoke({"path": str(target), "old_string": "a", "new_string": "b"})

    def test_replace_all_replaces_every_match(self, tool_ctx, tmp_path):
        target = tmp_path / "f.txt"
        target.write_text("a a a\n")
        _, _, edit_file = _tools(tool_ctx)

        edit_file.invoke(
            {"path": str(target), "old_string": "a", "new_string": "b", "replace_all": True}
        )

        assert target.read_text() == "b b b\n"

    def test_not_found_raises(self, tool_ctx, tmp_path):
        target = tmp_path / "f.txt"
        target.write_text("hello\n")
        _, _, edit_file = _tools(tool_ctx)

        with pytest.raises(Exception, match="not found"):
            edit_file.invoke({"path": str(target), "old_string": "missing", "new_string": "x"})

    def test_preserves_surrounding_whitespace(self, tool_ctx, tmp_path):
        target = tmp_path / "f.txt"
        target.write_text("    if x:\n        return\n")
        _, _, edit_file = _tools(tool_ctx)

        edit_file.invoke(
            {"path": str(target), "old_string": "        return", "new_string": "        pass"}
        )

        assert target.read_text() == "    if x:\n        pass\n"
