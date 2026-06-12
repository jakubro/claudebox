"""DaemonServiceBundle - dependency-injection wrapper for cross-process services.

Runtime-neutral container that the LangGraph tool factories read for
references to daemon-shaped services. The bundle abstracts service locality:
an embedded instance today (in-process Python, in-container per session);
a remote-daemon HTTP client tomorrow. Tool code reads `bundle.tasks` /
`bundle.worktrees` / `bundle.scheduler` without knowing which.

Fields are extended alphabetically; new entries land Optional with safe
defaults so one service can be wired without forcing the bundle to know
about siblings.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from ._tasks import TaskService


@dataclass(frozen=True)
class DaemonServiceBundle:
    """Bundle of claudebox-daemon-style services exposed to tool factories.

    Currently in-process / in-container per session - service references are
    direct Python instances. Future remote daemon would replace each field
    with an HTTP client of the same shape; tool code remains unchanged.
    """

    tasks: "TaskService | None" = None
