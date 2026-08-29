"""DaemonServiceBundle - dependency-injection wrapper for cross-process services.

Runtime-neutral container the LangGraph tool factories read for daemon-shaped services,
abstracting away locality: tool code reads `bundle.tasks`/`bundle.worktrees`/`bundle.scheduler`
without knowing whether the service is local or remote.

Fields are extended alphabetically; new entries land Optional with safe defaults so one service
can be wired without the bundle needing to know about siblings.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from ._sibling_sessions import SiblingSessionClient
    from ._tasks import TaskService


@dataclass(frozen=True)
class DaemonServiceBundle:
    """Bundle of claudebox-daemon-style services exposed to tool factories.

    In-process/in-container per session, so fields are direct Python instances today; a future
    remote daemon would swap each field for an HTTP client of the same shape, tool code unchanged.
    """

    sessions: "SiblingSessionClient | None" = None
    tasks: "TaskService | None" = None
