"""Tests for ClaudeRuntime._translate_sdk_message — SDK message → AgentEvent."""

from claude_agent_sdk import AssistantMessage, ResultMessage, SystemMessage, UserMessage
from claude_agent_sdk.types import TextBlock, ToolResultBlock, ToolUseBlock

from claudebox.agent_session.events import AgentEvent
from claudebox.agent_session.runtime_claude import ClaudeRuntime


def test_translate_system_message():
    """System message → kind='system', subtype in payload."""

    msg = SystemMessage(subtype="init", data={"session_id": "abc"})
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt, AgentEvent)
    assert evt.kind == "system"
    assert evt.payload["subtype"] == "init"
    assert evt.payload["data"]["session_id"] == "abc"


def test_translate_user_message_string_content():
    """User message with string content → kind='user', content in payload."""

    msg = UserMessage("hello there")
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.kind == "user"
    assert evt.payload["content"] == "hello there"


def test_translate_assistant_message_with_text_block():
    """Assistant message with TextBlock → kind='assistant'; block type injected."""

    msg = AssistantMessage(content=[TextBlock(text="hi")], model="claude")
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.kind == "assistant"
    assert evt.payload["model"] == "claude"
    blocks = evt.payload["content"]
    assert isinstance(blocks, list)
    assert blocks[0]["type"] == "text"
    assert blocks[0]["text"] == "hi"


def test_translate_assistant_message_with_tool_use_block():
    """ToolUseBlock → block.type='tool_use' after translation."""

    msg = AssistantMessage(
        content=[ToolUseBlock(id="tu1", name="Bash", input={"command": "ls"})],
        model="claude",
    )
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.payload["content"][0]["type"] == "tool_use"
    assert evt.payload["content"][0]["name"] == "Bash"


def test_translate_assistant_message_with_tool_result_block():
    """ToolResultBlock → block.type='tool_result' after translation."""

    msg = UserMessage(content=[ToolResultBlock(tool_use_id="tu1", content="ok")])
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.payload["content"][0]["type"] == "tool_result"


def test_translate_result_message():
    """Result message → kind='result'."""

    msg = ResultMessage(
        subtype="success",
        duration_ms=100,
        duration_api_ms=80,
        is_error=False,
        num_turns=1,
        session_id="abc",
        total_cost_usd=0.01,
        result="done",
    )
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.kind == "result"
    assert evt.payload["subtype"] == "success"
    assert evt.payload["total_cost_usd"] == 0.01


def test_agent_event_payload_is_sdk_free():
    """AgentEvent.payload contains no SDK type instances — pure dict."""

    msg = AssistantMessage(content=[TextBlock(text="x")], model="claude")
    evt = ClaudeRuntime._translate_sdk_message(msg)

    # asdict converts SDK dataclasses to dicts; no SDK class instances remain.
    assert isinstance(evt.payload, dict)
    for block in evt.payload.get("content", []):
        assert isinstance(block, dict)
        assert "type" in block
