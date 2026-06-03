"""AgentEvent — runtime-neutral event yielded by AgentSession.receive_events."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AgentEvent:
    """One event from the runtime's response stream.

    `kind` discriminates the event class ("system", "user", "assistant",
    "result"); `payload` carries the runtime-projected dict.
    """

    kind: str
    payload: dict[str, Any]
    turn_id: str | None = None
