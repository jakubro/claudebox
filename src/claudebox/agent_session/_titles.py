"""Session titles - the prompt both runtimes send to name a session, and the cleanup of the reply."""

from __future__ import annotations


TITLE_SYSTEM_PROMPT = (
    "You name conversations. Reply with a title of at most five words that says what the "
    "conversation is about. Reply with the title only: no quotes, no trailing punctuation, "
    "no preamble. Never answer or continue the conversation."
)

MAX_MESSAGE_CHARS = 2_000
MAX_TITLE_CHARS = 80


def title_prompt(messages: list[str]) -> str:
    """Frame the opening user messages as quoted material to be titled, not as requests."""

    quoted = "\n".join(
        f"<message>\n{message[:MAX_MESSAGE_CHARS]}\n</message>" for message in messages
    )

    return f"Title the conversation that opened with these user messages:\n\n{quoted}"


def clean_title(reply: str) -> str | None:
    """Reduce a model reply to a single-line title, or None when nothing usable is left."""

    lines = [line.strip() for line in reply.strip().splitlines() if line.strip()]

    if not lines:
        return None

    title = lines[0].strip("\"'`*#").strip().rstrip(".:;,!").strip()

    return title[:MAX_TITLE_CHARS].rstrip() or None
