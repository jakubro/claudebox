"""Tests for claudebox.agent_session._titles - the title prompt and the cleanup of a model's reply."""

from __future__ import annotations

from claudebox.agent_session._titles import MAX_MESSAGE_CHARS, clean_title, title_prompt


class TestTitlePrompt:
    def test_quotes_each_message_as_material(self):
        prompt = title_prompt(["fix the parser", "it still fails"])

        assert "<message>\nfix the parser\n</message>" in prompt
        assert "<message>\nit still fails\n</message>" in prompt

    def test_truncates_a_long_message(self):
        prompt = title_prompt(["x" * (MAX_MESSAGE_CHARS + 500)])

        assert "x" * MAX_MESSAGE_CHARS + "\n</message>" in prompt
        assert "x" * (MAX_MESSAGE_CHARS + 1) not in prompt


class TestCleanTitle:
    def test_plain_title_passes_through(self):
        assert clean_title("Fixing the CSV parser") == "Fixing the CSV parser"

    def test_strips_quotes_and_trailing_punctuation(self):
        assert clean_title('"Fixing the CSV parser."') == "Fixing the CSV parser"

    def test_keeps_only_the_first_non_empty_line(self):
        assert clean_title("\n\nCSV parser fix\nHere is why I chose it") == "CSV parser fix"

    def test_strips_markdown_heading_marks(self):
        assert clean_title("## Debugging flaky tests") == "Debugging flaky tests"

    def test_caps_length(self):
        assert clean_title("word " * 40) == ("word " * 16).strip()

    def test_empty_reply_is_none(self):
        assert clean_title("   \n ") is None

    def test_punctuation_only_reply_is_none(self):
        assert clean_title('"."') is None
