"""Tests for claudebox.agent_session.orchestration.session - content block building and internal commands."""

import base64

from claudebox.agent_session.orchestration.session import (
    INTERNAL_COMMAND_PATTERN,
    SessionService,
)


# --- INTERNAL_COMMAND_PATTERN ---


class TestInternalCommandPattern:
    """Test internal command regex matching."""

    def test_compact_matches(self):
        assert INTERNAL_COMMAND_PATTERN.match("/compact")

    def test_compact_with_args_matches(self):
        assert INTERNAL_COMMAND_PATTERN.match("/compact some args")

    def test_context_matches(self):
        assert INTERNAL_COMMAND_PATTERN.match("/context")

    def test_context_with_args_matches(self):
        assert INTERNAL_COMMAND_PATTERN.match("/context show")

    def test_regular_text_no_match(self):
        assert not INTERNAL_COMMAND_PATTERN.match("hello world")

    def test_other_slash_command_no_match(self):
        assert not INTERNAL_COMMAND_PATTERN.match("/help")

    def test_mid_text_slash_no_match(self):
        assert not INTERNAL_COMMAND_PATTERN.match("run /compact")


# --- _build_content_blocks ---


class TestBuildContentBlocks:
    """Test Anthropic API content block assembly from attachments."""

    def test_text_only(self):
        blocks = SessionService._build_content_blocks("Hello", [])
        assert blocks == [{"type": "text", "text": "Hello"}]

    def test_empty_prompt_no_text_block(self):
        blocks = SessionService._build_content_blocks("   ", [])
        assert blocks == []

    def test_image_attachment(self):
        data = base64.b64encode(b"fake-png").decode()
        blocks = SessionService._build_content_blocks(
            "Look at this",
            [
                {"type": "image/png", "data": data, "name": "screenshot.png"},
            ],
        )

        assert len(blocks) == 2
        assert blocks[0] == {"type": "text", "text": "Look at this"}
        assert blocks[1]["type"] == "image"
        assert blocks[1]["source"]["media_type"] == "image/png"
        assert blocks[1]["source"]["data"] == data

    def test_pdf_attachment(self):
        data = base64.b64encode(b"fake-pdf").decode()
        blocks = SessionService._build_content_blocks(
            "Check this",
            [
                {"type": "application/pdf", "data": data, "name": "report.pdf"},
            ],
        )

        assert len(blocks) == 2
        assert blocks[1]["type"] == "document"
        assert blocks[1]["source"]["media_type"] == "application/pdf"

    def test_unknown_mime_treated_as_text(self):
        text_content = "file contents here"
        data = base64.b64encode(text_content.encode()).decode()
        blocks = SessionService._build_content_blocks(
            "",
            [
                {"type": "application/octet-stream", "data": data, "name": "data.csv"},
            ],
        )

        assert len(blocks) == 1
        assert blocks[0]["type"] == "text"
        assert "data.csv" in blocks[0]["text"]
        assert text_content in blocks[0]["text"]

    def test_multiple_attachments(self):
        png_data = base64.b64encode(b"png").decode()
        pdf_data = base64.b64encode(b"pdf").decode()
        blocks = SessionService._build_content_blocks(
            "Files",
            [
                {"type": "image/png", "data": png_data, "name": "a.png"},
                {"type": "application/pdf", "data": pdf_data, "name": "b.pdf"},
            ],
        )

        assert len(blocks) == 3
        assert blocks[0]["type"] == "text"
        assert blocks[1]["type"] == "image"
        assert blocks[2]["type"] == "document"


# --- _serialize_inline_replies ---


class TestSerializeInlineReplies:
    """Test <inline-replies> wire-envelope serialization."""

    def test_single_reply(self):
        xml = SessionService._serialize_inline_replies(
            [{"quote": "context window", "from": "assistant", "response": "how big?"}]
        )

        assert xml == (
            "<inline-replies>\n"
            '  <reply><quote from="assistant">context window</quote>'
            "<response>how big?</response></reply>\n"
            "</inline-replies>"
        )

    def test_escapes_inner_text_only(self):
        xml = SessionService._serialize_inline_replies(
            [{"quote": "a < b & c", "from": "user", "response": "x > y"}]
        )

        assert "a &lt; b &amp; c" in xml
        assert "x &gt; y" in xml

    def test_multiple_replies_carry_from_attribution(self):
        xml = SessionService._serialize_inline_replies(
            [
                {"quote": "q1", "from": "assistant", "response": "r1"},
                {"quote": "q2", "from": "user", "response": "r2"},
            ]
        )

        assert xml.count("<reply>") == 2
        assert 'from="assistant"' in xml
        assert 'from="user"' in xml

    def test_strips_anchor_fields_from_the_wire(self):
        # Anchor fields ride on the display event + reload but must never reach the
        # model - the from/quote/response allowlist keeps them structurally invisible.
        xml = SessionService._serialize_inline_replies(
            [
                {
                    "quote": "context window",
                    "from": "assistant",
                    "response": "how big?",
                    "turnId": "t-42",
                    "prefix": "the runtime embeds ",
                    "suffix": " in the Model",
                    "offset": 19,
                }
            ]
        )

        for anchor_token in ("t-42", "turnId", "prefix", "suffix", "offset", "the runtime embeds"):
            assert anchor_token not in xml

        assert "context window" in xml
        assert "how big?" in xml
