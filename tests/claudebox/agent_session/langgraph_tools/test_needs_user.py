"""needs_user.py @tool tests - the LangGraph binding of the needs_user tool."""

from __future__ import annotations

from claudebox.agent_session.langgraph_tools.needs_user import make_needs_user_tools
from claudebox.core.io import write_json


class TestNeedsUser:
    def test_returns_single_needs_user_tool_taking_a_reason(self, tool_ctx):
        tools = make_needs_user_tools(tool_ctx)

        assert [t.name for t in tools] == ["needs_user"]
        assert set(tools[0].args) == {"reason", "replies"}

    def test_acknowledges_without_ending_anything(self, tool_ctx):
        needs_user = make_needs_user_tools(tool_ctx)[0]

        result = needs_user.invoke({"reason": "Decide: where retry state lives"})

        assert "has been told" in result

    def test_replies_past_five_are_reported_as_dropped(self, tool_ctx):
        needs_user = make_needs_user_tools(tool_ctx)[0]
        replies = ["A", "B", "C", "D", "E", "F", "G"]

        result = needs_user.invoke({"reason": "Pick", "replies": replies})

        assert "2 more were dropped" in result

    def test_spawned_session_is_told_its_signal_was_ignored(self, tool_ctx):
        session_dir = tool_ctx.config.session_dir
        session_dir.mkdir()
        write_json(session_dir / "session.json", {"spawned_from_session_id": "parent-1"})
        needs_user = make_needs_user_tools(tool_ctx)[0]

        result = needs_user.invoke({"reason": "Decide: which branch"})

        assert result.startswith("Ignored")
        assert "started it" in result

    def test_reply_thread_is_told_its_signal_was_ignored(self, tool_ctx):
        session_dir = tool_ctx.config.session_dir
        session_dir.mkdir()
        write_json(session_dir / "session.json", {"is_side_thread": True})
        needs_user = make_needs_user_tools(tool_ctx)[0]

        result = needs_user.invoke({"reason": "Decide: which branch"})

        assert result.startswith("Ignored: a reply thread")
