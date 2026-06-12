"""AskUserQuestion - structured Q&A via LangGraph's interrupt() primitive.

The runtime projects the LangGraph interrupt into the existing
assistant_message event with a tool_use block whose
`name == "ask_user_question"` and `input == {questions: [...]}`. The user
replies via the existing Claude UX path (form -> POST /api/send with
content wrapped in `<response:AskUserQuestion>...</response:AskUserQuestion>`).
The runtime detects the post-interrupt state, routes the next query through
`graph.aresume(Command(resume=<wrapped-text>))`, and the @tool's
`interrupt()` call returns that text as the tool's return value. Same wire
format as Claude, no new endpoint, no Protocol surface change.

Each question is a dict with the keys the frontend's
InteractiveQuestions component reads: `header`, `question`, `options`
(list of {label, description}), and `multiSelect` (bool). The tool input
accepts the raw `questions` list verbatim - the frontend renders it
identically to Claude's AskUserQuestion.
"""

from typing import Any

from langchain_core.tools import BaseTool, tool
from langgraph.types import interrupt

from ._context import ToolContext


def make_question_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the ask_user_question @tool function.

    Closes over `ctx` to keep the signature uniform, even
    though this tool reads nothing off the context today.
    """

    _ = ctx  # unused; kept for the uniform make_*_tools(ctx) signature.

    @tool
    def ask_user_question(questions: list[dict[str, Any]]) -> str:
        """Ask the user up to four structured questions; return their answer text.

        `questions` is a list of question records. Each record carries
        `header` (short label), `question` (the question text), `options`
        (list of `{label, description}` choices), and `multiSelect` (bool).
        The user submits via the interactive form; their answer arrives
        as text wrapped in `<response:AskUserQuestion>...</response:AskUserQuestion>`.
        """

        answer = interrupt({"questions": questions})

        return answer if isinstance(answer, str) else str(answer)

    return [ask_user_question]


__all__ = ["make_question_tools"]
