"""AskUserQuestion - structured Q&A via LangGraph's interrupt() primitive.

The runtime projects the interrupt into the existing assistant_message event with a tool_use
block (`name == "ask_user_question"`, `input == {questions: [...]}`). The user replies via the
existing Claude UX path (form -> POST /api/send, content wrapped in
`<response:AskUserQuestion>...</response:AskUserQuestion>`). The runtime then resumes via
`graph.aresume(Command(resume=<wrapped-text>))`, and `interrupt()` returns that text as the
tool's return value - same wire format as Claude, no new endpoint or Protocol change.

The `questions` list passes through verbatim to the frontend's InteractiveQuestions component,
rendered identically to Claude's AskUserQuestion (see `ask_user_question` below for field shape).
"""

from typing import Any

from langchain_core.tools import BaseTool, tool
from langgraph.types import interrupt

from ._context import ToolContext


def make_question_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the ask_user_question @tool function; ctx is unused, kept only for signature uniformity."""

    _ = ctx  # unused; kept for the uniform make_*_tools(ctx) signature.

    @tool
    def ask_user_question(questions: list[dict[str, Any]]) -> str:
        """Ask the user up to four structured questions; return their answer text.

        `questions` is a list of records with `header` (short label), `question` (text),
        `options` (list of `{label, description}` choices), and `multiSelect` (bool). The
        answer arrives as text wrapped in `<response:AskUserQuestion>...</response:AskUserQuestion>`.
        """

        answer = interrupt({"questions": questions})

        return answer if isinstance(answer, str) else str(answer)

    return [ask_user_question]


__all__ = ["make_question_tools"]
