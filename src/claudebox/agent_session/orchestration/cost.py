"""Session cost - what each result's reported cost adds to its session's total."""

from __future__ import annotations


def cost_added(figure: float, previous: float | None, *, runtime: str | None) -> float:
    """Return what a result's `cost_usd` adds to its session, `previous` being the figure before it.

    Claude, and a None runtime, report the process's running total: a rise adds the rise, and a
    fall - a new process that restored less - adds the whole figure. LangGraph reports each turn.
    """

    if runtime != "LangGraph" and previous is not None and figure >= previous:
        return figure - previous

    return figure
