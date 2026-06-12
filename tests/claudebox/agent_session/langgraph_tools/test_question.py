"""question.py @tool tests - ask_user_question backed by interrupt()."""

from claudebox.agent_session.langgraph_tools.question import make_question_tools


class TestMakeQuestionTools:
    def test_returns_single_ask_user_question_tool(self, tool_ctx):
        tools = make_question_tools(tool_ctx)

        assert [t.name for t in tools] == ["ask_user_question"]


class TestAskUserQuestion:
    def test_passes_questions_to_interrupt(self, tool_ctx, monkeypatch):
        captured: dict[str, object] = {}

        def fake_interrupt(value):
            captured["value"] = value

            return "answer"

        monkeypatch.setattr(
            "claudebox.agent_session.langgraph_tools.question.interrupt",
            fake_interrupt,
        )
        ask = make_question_tools(tool_ctx)[0]
        questions = [
            {
                "header": "Mode",
                "question": "Which mode?",
                "options": [{"label": "A", "description": "alpha"}],
                "multiSelect": False,
            }
        ]

        ask.invoke({"questions": questions})

        assert captured["value"] == {"questions": questions}

    def test_returns_interrupt_value_as_string(self, tool_ctx, monkeypatch):
        monkeypatch.setattr(
            "claudebox.agent_session.langgraph_tools.question.interrupt",
            lambda _value: "the user's answer text",
        )
        ask = make_question_tools(tool_ctx)[0]

        result = ask.invoke({"questions": [{"question": "ok?"}]})

        assert result == "the user's answer text"

    def test_stringifies_non_string_interrupt_value(self, tool_ctx, monkeypatch):
        """Resume may surface a non-string when called via Command(resume=...);
        the tool coerces to str so the model always sees text."""

        monkeypatch.setattr(
            "claudebox.agent_session.langgraph_tools.question.interrupt",
            lambda _value: {"answer": 42},
        )
        ask = make_question_tools(tool_ctx)[0]

        result = ask.invoke({"questions": [{"question": "ok?"}]})

        assert isinstance(result, str)
        assert "answer" in result
