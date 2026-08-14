"""ClaudeboxSummarizationMiddleware - announces the compaction LangGraph performs.

LangGraph's `SummarizationMiddleware` rewrites in place and reports nothing; two claudebox surfaces
wait to hear about it: the compaction block the UI opens, and the re-supplied session prompt.

This subclass wraps the summarization in a start/finish pair, using the same trigger and cutoff
the parent checks, so a start is announced only when a boundary is certain to follow.
"""

from collections.abc import Awaitable
from typing import Any, Protocol

from langchain.agents.middleware import AgentState, SummarizationMiddleware
from langchain_core.messages import RemoveMessage
from langgraph.runtime import Runtime


# The parent tags the message it writes in place of the compacted history.
_SUMMARY_SOURCE = "summarization"


class CompactionStarted(Protocol):
    """Called once the middleware knows it is about to compact."""

    def __call__(self) -> Awaitable[None]: ...


class CompactionFinished(Protocol):
    """Called with the token counts either side of a compaction, its summary, and what it kept."""

    def __call__(
        self,
        *,
        pre_tokens: int,
        post_tokens: int,
        summary: str,
        kept: list[Any],
    ) -> Awaitable[None]: ...


class ClaudeboxSummarizationMiddleware(SummarizationMiddleware):
    """SummarizationMiddleware that reports each compaction it performs."""

    def __init__(
        self,
        *,
        model: Any,
        trigger: Any,
        on_started: CompactionStarted,
        on_finished: CompactionFinished,
    ) -> None:
        super().__init__(model=model, trigger=trigger)
        self._on_started = on_started
        self._on_finished = on_finished

    async def abefore_model(
        self,
        state: AgentState[Any],
        runtime: Runtime,
    ) -> dict[str, Any] | None:
        """Compact as the parent does, bracketed by the start and finish callbacks."""

        messages = state["messages"]
        self._ensure_message_ids(messages)
        pre_tokens = self.token_counter(messages)

        if not self._should_summarize(messages, pre_tokens):
            return None

        # The parent bails out here too, and an unfinished start leaves the UI compacting forever.
        if self._determine_cutoff_index(messages) <= 0:
            return None

        await self._on_started()

        update = await super().abefore_model(state, runtime)

        if update is None:
            # Only reachable if the parent's own guards disagree with the ones checked above.
            await self._on_finished(
                pre_tokens=pre_tokens,
                post_tokens=pre_tokens,
                summary="",
                kept=list(messages),
            )

            return None

        kept = [m for m in update["messages"] if not isinstance(m, RemoveMessage)]
        await self._on_finished(
            pre_tokens=pre_tokens,
            post_tokens=self.token_counter(kept),
            summary=_summary_text(kept),
            kept=kept,
        )

        return update


def is_summary(message: Any) -> bool:
    """Whether this is the message the parent wrote in place of the compacted history."""

    return (getattr(message, "additional_kwargs", None) or {}).get("lc_source") == _SUMMARY_SOURCE


def _summary_text(messages: list[Any]) -> str:
    """Return the summary the parent wrote in place of the compacted history."""

    for message in messages:
        if is_summary(message):
            content = message.content

            return content if isinstance(content, str) else str(content)

    return ""


__all__ = ["ClaudeboxSummarizationMiddleware", "is_summary"]
