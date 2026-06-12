"""Tests for ClaudeRuntime._translate_sdk_message - SDK message -> typed AgentEvent."""

import dataclasses

import pytest
from claude_agent_sdk import (
    AssistantMessage,
    RateLimitEvent,
    RateLimitInfo,
    ResultMessage,
    SystemMessage,
    UserMessage,
)
from claude_agent_sdk.types import TextBlock as SdkTextBlock
from claude_agent_sdk.types import ToolResultBlock as SdkToolResultBlock
from claude_agent_sdk.types import ToolUseBlock as SdkToolUseBlock

from claudebox.agent_session.events import (
    AgentEvent,
    AssistantMessagePayload,
    McpServerInit,
    RateLimitPayload,
    ResultPayload,
    ResultUsage,
    SystemInitData,
    SystemInitPayload,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UnknownBlock,
    UserMessagePayload,
)
from claudebox.agent_session.runtime_claude import ClaudeRuntime


# Per-kind translation
# --------------------------------------------------------------------------------------------------


def test_translate_system_message():
    """System message -> kind='system_init' with typed SystemInitPayload."""

    msg = SystemMessage(subtype="init", data={"session_id": "abc", "model": "claude-opus"})
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt, AgentEvent)
    assert evt.kind == "system_init"
    assert isinstance(evt.payload, SystemInitPayload)
    assert evt.payload.subtype == "init"
    assert evt.payload.session_id == "abc"
    assert evt.payload.model == "claude-opus"


def test_translate_user_message_string_content():
    """User message with string content -> kind='user_message' + typed UserMessagePayload."""

    msg = UserMessage("hello there")
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.kind == "user_message"
    assert isinstance(evt.payload, UserMessagePayload)
    assert evt.payload.content == "hello there"


def test_translate_assistant_message_with_text_block():
    """Assistant message with TextBlock -> kind='assistant_message'; content[0] is TextBlock dataclass."""

    msg = AssistantMessage(content=[SdkTextBlock(text="hi")], model="claude")
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.kind == "assistant_message"
    assert isinstance(evt.payload, AssistantMessagePayload)
    assert evt.payload.model == "claude"
    assert isinstance(evt.payload.content[0], TextBlock)
    assert evt.payload.content[0].text == "hi"


def test_translate_assistant_message_with_tool_use_block():
    """SDK ToolUseBlock -> claudebox ToolUseBlock dataclass with id/name/input."""

    msg = AssistantMessage(
        content=[SdkToolUseBlock(id="tu1", name="Bash", input={"command": "ls"})],
        model="claude",
    )
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt.payload, AssistantMessagePayload)
    block = evt.payload.content[0]
    assert isinstance(block, ToolUseBlock)
    assert block.id == "tu1"
    assert block.name == "Bash"
    assert block.input == {"command": "ls"}


class TestAskUserQuestionInputValidation:
    """AskUserQuestion input coercion + validation at the SDK -> typed-payload boundary."""

    @staticmethod
    def _translate_tool_use(input_data: dict, *, name: str = "AskUserQuestion") -> ToolUseBlock:
        """Helper - run an SdkToolUseBlock through the translator and return the typed block."""

        msg = AssistantMessage(
            content=[SdkToolUseBlock(id="tu", name=name, input=input_data)],
            model="claude",
        )
        evt = ClaudeRuntime._translate_sdk_message(msg)
        assert isinstance(evt.payload, AssistantMessagePayload)
        block = evt.payload.content[0]
        assert isinstance(block, ToolUseBlock)

        return block

    def test_well_formed_list_passes_through(self):
        questions = [{"header": "Approach", "question": "Which?"}]
        block = self._translate_tool_use({"questions": questions})

        assert block.input["questions"] == questions

    def test_stringified_array_is_coerced(self):
        # Canonical malformed shape: a JSON-encoded array instead of a list.
        stringified = '[{"header":"Approach","question":"Which?"}]'
        block = self._translate_tool_use({"questions": stringified})

        assert isinstance(block.input["questions"], list)
        assert block.input["questions"] == [{"header": "Approach", "question": "Which?"}]

    def test_unparseable_string_drops_field_to_empty_list(self):
        block = self._translate_tool_use({"questions": "not json {"})

        assert block.input["questions"] == []

    def test_string_parsing_to_non_list_drops_field(self):
        # A string that parses but yields a non-list (e.g. an object).
        block = self._translate_tool_use({"questions": '{"header": "Approach"}'})

        assert block.input["questions"] == []

    def test_non_string_non_list_drops_field(self):
        block = self._translate_tool_use({"questions": {"header": "Approach"}})

        assert block.input["questions"] == []

    def test_other_tools_pass_through_unchanged(self):
        # Validator registry only intercepts AskUserQuestion - other tools'
        # input.questions (if such a field even existed) flows unmodified.
        block = self._translate_tool_use(
            {"command": "ls", "questions": "passes through"}, name="Bash"
        )

        assert block.input == {"command": "ls", "questions": "passes through"}


def test_translate_user_message_with_tool_result_block():
    """SDK ToolResultBlock -> claudebox ToolResultBlock dataclass; user-side wrapper."""

    msg = UserMessage(content=[SdkToolResultBlock(tool_use_id="tu1", content="ok")])
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.kind == "user_message"
    assert isinstance(evt.payload, UserMessagePayload)
    block = evt.payload.content[0]
    assert isinstance(block, ToolResultBlock)
    assert block.tool_use_id == "tu1"
    assert block.content == "ok"


def test_translate_result_message():
    """Result message -> kind='result' with typed ResultPayload carrying cost/duration/etc."""

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
    assert isinstance(evt.payload, ResultPayload)
    assert evt.payload.subtype == "success"
    assert evt.payload.total_cost_usd == 0.01
    assert evt.payload.duration_ms == 100
    assert evt.payload.num_turns == 1


def test_agent_event_payload_is_sdk_free():
    """AgentEvent.payload classes live in claudebox; no SDK type instance leaks."""

    msg = AssistantMessage(content=[SdkTextBlock(text="x")], model="claude")
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt.payload, AssistantMessagePayload)

    for block in evt.payload.content:
        assert type(block).__module__.startswith("claudebox.")


# Match-narrowing
# --------------------------------------------------------------------------------------------------


def test_match_kind_narrows_payload_type():
    """``match evt.kind:`` narrows ``evt.payload`` to the corresponding dataclass type."""

    msg = SystemMessage(subtype="init", data={"session_id": "abc"})
    evt = ClaudeRuntime._translate_sdk_message(msg)

    match evt.kind:
        case "system_init":
            assert isinstance(evt.payload, SystemInitPayload)
            session_id = evt.payload.session_id  # typed attribute access
            assert session_id == "abc"
        case _:
            raise AssertionError(f"unexpected kind {evt.kind}")


# Per-block-type construction
# --------------------------------------------------------------------------------------------------


def test_text_block_construction():
    block = TextBlock(text="hi")
    assert block.text == "hi"


def test_thinking_block_construction():
    block = ThinkingBlock(thinking="reasoning")
    assert block.thinking == "reasoning"


def test_tool_use_block_construction():
    block = ToolUseBlock(id="tu1", name="Bash", input={"command": "ls"})
    assert block.id == "tu1"
    assert block.name == "Bash"
    assert block.input == {"command": "ls"}


def test_tool_result_block_construction():
    block = ToolResultBlock(tool_use_id="tu1", content="ok")
    assert block.tool_use_id == "tu1"
    assert block.content == "ok"
    assert block.is_error is None


# Dict-shape round trip - JSONL replay compatibility
# --------------------------------------------------------------------------------------------------


# Unknown classes - fail-loud for messages, preserve-with-warning for blocks
# --------------------------------------------------------------------------------------------------


@dataclasses.dataclass
class _StubSdkMessage:
    """SDK-shaped message class outside the known ladder."""

    subtype: str = "future"
    data: dict = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class _StubSdkBlock:
    """SDK-shaped block class outside the known ladder."""

    text: str = "stub"
    meta: dict = dataclasses.field(default_factory=dict)


def test_translate_unknown_sdk_message_raises():
    """Unknown SDK message class -> loud ValueError naming the class."""

    with pytest.raises(ValueError, match="Unknown SDK message type.*_StubSdkMessage"):
        ClaudeRuntime._translate_sdk_message(_StubSdkMessage())


def test_translate_unknown_sdk_block_emits_unknown_block(caplog):
    """Unknown SDK block class -> UnknownBlock with class_name + data; warning logged."""

    msg = AssistantMessage(
        content=[SdkTextBlock(text="prefix"), _StubSdkBlock(text="x", meta={"k": "v"})],  # ty: ignore[invalid-argument-type]
        model="claude",
    )
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt.payload, AssistantMessagePayload)
    blocks = evt.payload.content
    assert isinstance(blocks[0], TextBlock)
    assert isinstance(blocks[1], UnknownBlock)
    assert blocks[1].class_name == "_StubSdkBlock"
    assert blocks[1].data == {"text": "x", "meta": {"k": "v"}}


def test_unknown_block_round_trips_through_conversion():
    """UnknownBlock projects to ``{"type": "unknown", ...}`` and yields an Event downstream."""

    from claudebox.agent_session.orchestration.conversion import (
        _block_to_dict,
        _typed_payload_to_dict_message,
        dict_message_to_events,
    )

    msg = AssistantMessage(content=[_StubSdkBlock(text="raw")], model="claude")  # ty: ignore[invalid-argument-type]
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt.payload, AssistantMessagePayload)
    block_dict = _block_to_dict(evt.payload.content[0])
    assert block_dict == {
        "type": "unknown",
        "class_name": "_StubSdkBlock",
        "data": {"text": "raw", "meta": {}},
    }

    # End-to-end through conversion: typed payload -> dict shape -> Event.
    dict_msg = _typed_payload_to_dict_message(evt)
    events = list(dict_message_to_events(dict_msg))
    assert len(events) == 1
    assert events[0].subtype == "unknown"


# Typed payload shapes - SystemInitData closure + ResultUsage
# --------------------------------------------------------------------------------------------------


def test_claude_init_translates_to_typed_init_data():
    """SDK SystemMessage(subtype=init).data -> SystemInitData with known fields populated."""

    msg = SystemMessage(
        subtype="init",
        data={
            "session_id": "sess-1",
            "model": "claude-opus",
            "slash_commands": ["/help"],
            "mcp_servers": [{"name": "jina", "status": "connected"}],
            "permissionMode": "default",
            "cwd": "/repo",
        },
    )
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt.payload, SystemInitPayload)
    assert isinstance(evt.payload.data, SystemInitData)
    assert evt.payload.session_id == "sess-1"
    assert evt.payload.model == "claude-opus"
    assert evt.payload.data.slash_commands == ["/help"]
    assert evt.payload.data.permissionMode == "default"
    assert evt.payload.data.cwd == "/repo"
    assert evt.payload.data.mcp_servers == [McpServerInit(name="jina", status="connected")]


def test_claude_init_unknown_data_keys_raise():
    """SDK init data carrying unknown keys -> ValueError listing them (fail-loud per D1a)."""

    msg = SystemMessage(
        subtype="init",
        data={"session_id": "sess-1", "future_field": "x", "another_future": [1, 2]},
    )

    with pytest.raises(
        ValueError, match="Unknown SDK init data fields.*another_future.*future_field"
    ):
        ClaudeRuntime._translate_sdk_message(msg)


def test_claude_result_emits_no_usage_today():
    """ClaudeRuntime ResultMessage path leaves payload.usage None (SDK shape mismatch with ResultUsage)."""

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

    assert isinstance(evt.payload, ResultPayload)
    assert evt.payload.usage is None


def test_conversion_flattens_typed_payloads_for_wire_compat():
    """``_typed_payload_to_dict_message`` reinjects model + session_id; ResultUsage flattens to dict."""

    from claudebox.agent_session.orchestration.conversion import _typed_payload_to_dict_message

    init_evt = AgentEvent(
        kind="system_init",
        payload=SystemInitPayload(
            subtype="init",
            session_id="sess-1",
            model="claude-opus",
            data=SystemInitData(slash_commands=["/help"]),
        ),
    )
    init_dict = _typed_payload_to_dict_message(init_evt)
    assert init_dict["type"] == "system"
    assert init_dict["message"]["subtype"] == "init"
    assert init_dict["message"]["data"]["model"] == "claude-opus"
    assert init_dict["message"]["data"]["session_id"] == "sess-1"
    assert init_dict["message"]["data"]["slash_commands"] == ["/help"]

    result_evt = AgentEvent(
        kind="result",
        payload=ResultPayload(
            subtype="success",
            result="done",
            usage=ResultUsage(used_tokens=320, max_tokens=128_000),
        ),
    )
    result_dict = _typed_payload_to_dict_message(result_evt)
    assert result_dict["message"]["usage"] == {"used_tokens": 320, "max_tokens": 128_000}

    # Usage None -> key omitted (was already optional pre-fix).
    result_no_usage_evt = AgentEvent(
        kind="result",
        payload=ResultPayload(subtype="success", result="done"),
    )
    result_no_usage_dict = _typed_payload_to_dict_message(result_no_usage_evt)
    assert "usage" not in result_no_usage_dict["message"]


def test_translate_isinstance_dispatch_no_string_match():
    """Static check - _translate_sdk_message + _translate_content use isinstance dispatch."""

    import inspect

    src_message = inspect.getsource(ClaudeRuntime._translate_sdk_message)
    src_content = inspect.getsource(ClaudeRuntime._translate_content)
    assert "class_name ==" not in src_message
    assert "block_class ==" not in src_content
    assert "isinstance(message, Sdk" in src_message
    assert "isinstance(sdk_block, Sdk" in src_content


def test_typed_payload_asdict_round_trip_assistant():
    """``dataclasses.asdict`` on AssistantMessagePayload produces a dict structurally equivalent to the JSONL persistence shape."""

    msg = AssistantMessage(
        content=[
            SdkTextBlock(text="hello"),
            SdkToolUseBlock(id="tu1", name="Bash", input={"command": "ls"}),
        ],
        model="claude",
    )
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert isinstance(evt.payload, AssistantMessagePayload)
    payload_dict = dataclasses.asdict(evt.payload)

    # Top-level shape matches what dict_message_to_events would read.
    assert payload_dict["model"] == "claude"
    assert isinstance(payload_dict["content"], list)
    # ContentBlock dataclasses asdict to bare-key dicts; the JSONL contract gets
    # the ``type`` discriminator reinjected by conversion._block_to_dict on the
    # live path. The asdict shape captures every field downstream needs.
    assert payload_dict["content"][0] == {"text": "hello"}
    assert payload_dict["content"][1] == {"id": "tu1", "name": "Bash", "input": {"command": "ls"}}


# Rate-limit event
# --------------------------------------------------------------------------------------------------


def test_translate_rate_limit_event():
    """RateLimitEvent -> kind='rate_limit' with a curated RateLimitPayload subset."""

    msg = RateLimitEvent(
        rate_limit_info=RateLimitInfo(
            status="allowed_warning",
            resets_at=123,
            rate_limit_type="five_hour",
            utilization=0.5,
        ),
        uuid="u1",
        session_id="s1",
    )
    evt = ClaudeRuntime._translate_sdk_message(msg)

    assert evt.kind == "rate_limit"
    assert isinstance(evt.payload, RateLimitPayload)
    assert evt.payload.status == "allowed_warning"
    assert evt.payload.resets_at == 123
    assert evt.payload.rate_limit_type == "five_hour"
    assert evt.payload.utilization == 0.5


def test_rate_limit_event_projects_to_system_subtype():
    """A rate_limit AgentEvent projects to a single non-rendered system/rate_limit event."""

    from claudebox.agent_session.orchestration.conversion import agent_event_to_events

    evt = AgentEvent(kind="rate_limit", payload=RateLimitPayload(status="rejected"))
    events = list(agent_event_to_events(evt))

    assert len(events) == 1
    assert events[0].type == "system"
    assert events[0].subtype == "rate_limit"
    assert events[0].primary is False
