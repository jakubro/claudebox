"""events_to_messages (pure) and the Claude->LangGraph migration seed path.

Seed/resume run a real graph and checkpoints.sqlite; only the provider is faked (no sockets)."""

import base64
from pathlib import Path
from unittest.mock import patch

import pytest
from langchain_core.language_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, ToolMessage

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime, events_to_messages


MODEL_ID = "anthropic:claude-test-model"


class _ScriptedChatModel(FakeMessagesListChatModel):
    """A real BaseChatModel that accepts tool binding without using it - see the sibling
    real-graph test module for why the base class's bind_tools refusal must be overridden."""

    def bind_tools(self, tools, **kwargs):
        return self


def _make_config(tmp_path: Path, session_id: str) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model=MODEL_ID,
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id=session_id,
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=HookCallbacks(),
    )


async def _connected_runtime(
    tmp_path: Path,
    session_id: str = "migrated-session",
) -> LangGraphRuntime:
    """Connect a runtime whose graph and checkpointer are real."""

    runtime = LangGraphRuntime(_make_config(tmp_path, session_id))

    with patch(
        "claudebox.agent_session.runtime_langgraph.init_chat_model",
        return_value=_ScriptedChatModel(responses=[AIMessage(content="unused")]),
    ):
        await runtime.connect()

    return runtime


def _bash_events() -> list[dict]:
    """A short Claude-shaped events.jsonl transcript: a question, a Bash call, and its result."""

    return [
        {"type": "user", "subtype": "message", "content": "list the files", "is_human": True},
        {
            "type": "assistant",
            "subtype": "text",
            "content": "I'll check.",
        },
        {
            "type": "assistant",
            "subtype": "tool_use",
            "tool_use_id": "tu_1",
            "tool_name": "Bash",
            "tool_input": {"command": "ls", "description": "List files"},
        },
        {
            "type": "user",
            "subtype": "tool_result",
            "tool_use_id": "tu_1",
            "content": "a.txt\nb.txt",
            "is_error": False,
        },
        {"type": "assistant", "subtype": "text", "content": "Found a.txt and b.txt."},
    ]


class TestEventsToMessages:
    def test_human_and_assistant_text(self):
        messages = events_to_messages(
            [
                {"type": "user", "subtype": "message", "content": "hello", "is_human": True},
                {"type": "assistant", "subtype": "text", "content": "hi"},
            ],
        )

        assert [m.content for m in messages] == ["hello", "hi"]
        assert messages[0].id != messages[1].id

    def test_mapped_tool_call_becomes_a_real_tool_call(self):
        messages = events_to_messages(_bash_events())

        call_message = next(m for m in messages if getattr(m, "tool_calls", None))
        assert isinstance(call_message, AIMessage)
        assert len(call_message.tool_calls) == 1
        call = call_message.tool_calls[0]
        assert call["id"] == "tu_1"
        assert call["name"] == "bash"
        assert call["args"] == {"command": "ls", "description": "List files"}

        result_message = next(m for m in messages if getattr(m, "tool_call_id", None) == "tu_1")
        assert isinstance(result_message, ToolMessage)
        assert result_message.content == "a.txt\nb.txt"
        assert result_message.status == "success"

    def test_failed_tool_call_status_is_error(self):
        events = _bash_events()
        events[3]["is_error"] = True

        messages = events_to_messages(events)
        result_message = next(m for m in messages if getattr(m, "tool_call_id", None) == "tu_1")
        assert isinstance(result_message, ToolMessage)

        assert result_message.status == "error"

    def test_unmapped_tool_call_is_flattened_to_text(self):
        messages = events_to_messages(
            [
                {"type": "user", "subtype": "message", "content": "track it", "is_human": True},
                {
                    "type": "assistant",
                    "subtype": "tool_use",
                    "tool_use_id": "tu_2",
                    "tool_name": "TodoWrite",
                    "tool_input": {"todos": [{"content": "x", "status": "pending"}]},
                },
                {
                    "type": "user",
                    "subtype": "tool_result",
                    "tool_use_id": "tu_2",
                    "content": "ok",
                    "is_error": False,
                },
            ],
        )

        assert not any(getattr(m, "tool_calls", None) for m in messages)
        assert not any(getattr(m, "tool_call_id", None) for m in messages)
        assert "TodoWrite" in messages[1].content
        assert "ok" in messages[2].content

    def test_nested_event_is_dropped(self):
        messages = events_to_messages(
            [
                {"type": "user", "subtype": "message", "content": "go", "is_human": True},
                {
                    "type": "assistant",
                    "subtype": "tool_use",
                    "tool_use_id": "sub_1",
                    "tool_name": "Bash",
                    "tool_input": {"command": "echo hi"},
                    "parent_tool_use_id": "task_1",
                },
            ],
        )

        assert len(messages) == 1
        assert messages[0].content == "go"

    def test_echo_marker_is_skipped(self):
        messages = events_to_messages(
            [
                {
                    "type": "user",
                    "subtype": "text",
                    "content": "<local-command-stdout>ls\na.txt</local-command-stdout>",
                    "is_human": False,
                },
            ],
        )

        assert messages == []

    def test_compaction_context_is_kept(self):
        messages = events_to_messages(
            [
                {
                    "type": "user",
                    "subtype": "text",
                    "content": "This session is being continued from a previous conversation...",
                    "is_human": False,
                },
            ],
        )

        assert len(messages) == 1

    def test_trailing_unresolved_tool_call_is_dropped(self):
        events = _bash_events()[:3]  # question, text, the Bash call - no result, no reply

        messages = events_to_messages(events)

        assert not any(getattr(m, "tool_calls", None) for m in messages)
        assert [m.content for m in messages] == ["list the files", "I'll check."]

    def test_thinking_block_is_dropped(self):
        messages = events_to_messages(
            [
                {"type": "user", "subtype": "message", "content": "explain", "is_human": True},
                {"type": "assistant", "subtype": "thinking", "content": "considering options..."},
                {"type": "assistant", "subtype": "text", "content": "Here you go."},
            ],
        )

        assert [m.content for m in messages] == ["explain", "Here you go."]

    def test_attachment_is_reencoded_from_disk(self, tmp_path):
        image_bytes = b"\x89PNG\r\n\x1a\nfake-png-data"
        (tmp_path / "att_screenshot.png").write_bytes(image_bytes)

        messages = events_to_messages(
            [
                {
                    "type": "user",
                    "subtype": "message",
                    "content": "what is this",
                    "is_human": True,
                    "attachments": [
                        {
                            "name": "screenshot.png",
                            "type": "image/png",
                            "filename": "att_screenshot.png",
                        },
                    ],
                },
            ],
            attachments_dir=tmp_path,
        )

        blocks = messages[0].content
        assert isinstance(blocks, list)
        assert blocks[0] == {"type": "text", "text": "what is this"}
        image_block = blocks[1]
        assert isinstance(image_block, dict)
        assert image_block["type"] == "image"
        assert image_block["source"]["media_type"] == "image/png"
        assert base64.b64decode(image_block["source"]["data"]) == image_bytes

    def test_pdf_attachment_is_reencoded_from_disk(self, tmp_path):
        pdf_bytes = b"%PDF-1.4\nfake-pdf-data"
        (tmp_path / "att_report.pdf").write_bytes(pdf_bytes)

        messages = events_to_messages(
            [
                {
                    "type": "user",
                    "subtype": "message",
                    "content": "see the attached report",
                    "is_human": True,
                    "attachments": [
                        {
                            "name": "report.pdf",
                            "type": "application/pdf",
                            "filename": "att_report.pdf",
                        },
                    ],
                },
            ],
            attachments_dir=tmp_path,
        )

        blocks = messages[0].content
        assert isinstance(blocks, list)
        doc_block = blocks[1]
        assert isinstance(doc_block, dict)
        assert doc_block["type"] == "document"
        assert doc_block["source"]["media_type"] == "application/pdf"
        assert base64.b64decode(doc_block["source"]["data"]) == pdf_bytes

    def test_attachment_text_content_is_carried_verbatim(self, tmp_path):
        (tmp_path / "att_notes.txt").write_bytes(b"line one\nline two")

        messages = events_to_messages(
            [
                {
                    "type": "user",
                    "subtype": "message",
                    "content": "",
                    "is_human": True,
                    "attachments": [
                        {"name": "notes.txt", "type": "text/plain", "filename": "att_notes.txt"},
                    ],
                },
            ],
            attachments_dir=tmp_path,
        )

        blocks = messages[0].content
        assert isinstance(blocks, list)
        assert len(blocks) == 1  # no text block for the empty prompt, just the attachment
        assert blocks[0] == {"type": "text", "text": "[File: notes.txt]\nline one\nline two"}

    def test_attachment_missing_from_disk_falls_back_to_a_placeholder(self, tmp_path):
        messages = events_to_messages(
            [
                {
                    "type": "user",
                    "subtype": "message",
                    "content": "see attached",
                    "is_human": True,
                    "attachments": [
                        {"name": "gone.pdf", "type": "application/pdf", "filename": "att_gone.pdf"},
                    ],
                },
            ],
            attachments_dir=tmp_path,
        )

        blocks = messages[0].content
        assert isinstance(blocks, list)
        placeholder = blocks[1]
        assert isinstance(placeholder, dict)
        assert placeholder["type"] == "text"
        assert "gone.pdf" in placeholder["text"]
        assert "no longer on disk" in placeholder["text"]

    def test_attachment_without_attachments_dir_flattens_to_a_placeholder(self, tmp_path):
        (tmp_path / "att_notes.txt").write_bytes(b"hello")

        messages = events_to_messages(
            [
                {
                    "type": "user",
                    "subtype": "message",
                    "content": "see attached",
                    "is_human": True,
                    "attachments": [
                        {"name": "notes.txt", "type": "text/plain", "filename": "att_notes.txt"},
                    ],
                },
            ],
        )  # no attachments_dir - the file on disk is never consulted

        blocks = messages[0].content
        assert isinstance(blocks, list)
        placeholder = blocks[1]
        assert isinstance(placeholder, dict)
        assert placeholder["type"] == "text"
        assert "no longer on disk" in placeholder["text"]


class TestMigrationSeed:
    @pytest.mark.anyio
    async def test_seeded_history_survives_a_second_runtime_over_the_same_directory(self, tmp_path):
        """A second runtime over the same session_dir resumes the full prior transcript."""

        session_id = "migrated-session"
        messages = events_to_messages(_bash_events())

        first = await _connected_runtime(tmp_path, session_id)
        assert first._graph is not None

        try:
            await first._graph.aupdate_state(
                {"configurable": {"thread_id": session_id}},
                {"messages": messages},
                as_node="model",
            )
        finally:
            await first.disconnect()

        second = await _connected_runtime(tmp_path, session_id)
        assert second._graph is not None

        try:
            state = await second._graph.aget_state(
                {"configurable": {"thread_id": session_id}},
            )
        finally:
            await second.disconnect()

        resumed_contents = [str(getattr(m, "content", "")) for m in state.values["messages"]]

        assert "list the files" in resumed_contents
        assert "Found a.txt and b.txt." in resumed_contents

        tool_call_ids = [
            call["id"]
            for m in state.values["messages"]
            for call in getattr(m, "tool_calls", None) or []
        ]
        assert "tu_1" in tool_call_ids

    @pytest.mark.anyio
    async def test_seeding_the_same_events_twice_does_not_duplicate_history(self, tmp_path):
        """Deterministic ids from events_to_messages() let add_messages merge a re-seed by id.
        The CLI script's runtime=="LangGraph" pre-check is a second, independent guard."""

        session_id = "migrated-session"
        messages = events_to_messages(_bash_events())

        runtime = await _connected_runtime(tmp_path, session_id)
        assert runtime._graph is not None

        try:
            config = {"configurable": {"thread_id": session_id}}
            await runtime._graph.aupdate_state(config, {"messages": messages}, as_node="model")
            await runtime._graph.aupdate_state(config, {"messages": messages}, as_node="model")
            state = await runtime._graph.aget_state(config)
        finally:
            await runtime.disconnect()

        human_count = sum(
            1
            for m in state.values["messages"]
            if str(getattr(m, "content", "")) == "list the files"
        )
        assert human_count == 1
