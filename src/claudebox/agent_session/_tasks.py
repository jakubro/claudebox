"""TaskService - in-memory agentic task list backing the LangGraph task_* tools.

The LangGraph @tool wrappers (in `task_mgmt.py`) are thin (~10 line)
delegates onto this service. Numeric per-session monotonic IDs match
Claude's UX. State lives in memory inside the running container; resume
rebuilds the cache by replaying the session's events.jsonl, looking for
prior task_create / task_update / task_stop / task_output tool_use entries.

Persistence model: there is no separate tasks file. The canonical persistent
log is events.jsonl - the same stream the frontend's `extractTasks` derives
panel state from. The in-memory store is a fast-lookup cache for
task_get / task_list / task_output during the running session; container
restart triggers a rebuild from the event log.
"""

import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal


TaskStatus = Literal["pending", "in_progress", "completed"]


class TaskNotFound(Exception):
    """Raised when a task_id lookup fails."""

    def __init__(self, task_id: int) -> None:
        super().__init__(f"Task not found: {task_id}")
        self.task_id = task_id


@dataclass(frozen=True)
class Task:
    """Single task record - immutable snapshot.

    Mutations return a new Task via `dataclasses.replace`; the service swaps
    the stored reference. Frozen prevents accidental in-place mutation by
    callers holding a reference.
    """

    id: int
    subject: str
    description: str
    active_form: str
    status: TaskStatus
    parent_tool_use_id: str | None
    blocked_by: tuple[int, ...]
    output: str
    created_at: datetime
    updated_at: datetime

    def asdict(self) -> dict[str, Any]:
        """Return a JSON-serialisable dict for tool_result / API responses.

        Wire-format keys are camelCase to match Claude's TaskCreate /
        TaskUpdate result shape - the existing frontend
        `appendTaskDiffs` / `_applyTaskResult` paths key on `activeForm`,
        `parentToolUseId`, `blockedBy`, etc.
        """

        return {
            "id": self.id,
            "subject": self.subject,
            "description": self.description,
            "activeForm": self.active_form,
            "status": self.status,
            "parentToolUseId": self.parent_tool_use_id,
            "blockedBy": list(self.blocked_by),
            "output": self.output,
            "createdAt": self.created_at.isoformat(),
            "updatedAt": self.updated_at.isoformat(),
        }


class TaskService:
    """In-memory task store backing the LangGraph task_* tool surface.

    Per-session, in-container, in-process. Tool function calls go straight
    through Python without HTTP. State is rebuildable from events.jsonl when
    the container restarts mid-session.
    """

    def __init__(self, session_id: str) -> None:
        self._session_id = session_id
        self._tasks: dict[int, Task] = {}
        self._next_id: int = 1

    # Mutations
    # ------------------------------------------------------------------

    def create(
        self,
        *,
        subject: str,
        description: str = "",
        active_form: str = "",
        parent_tool_use_id: str | None = None,
    ) -> Task:
        """Create a new pending task; return the populated record."""

        task_id = self._next_id
        self._next_id += 1
        now = datetime.now(timezone.utc)
        task = Task(
            id=task_id,
            subject=subject,
            description=description,
            active_form=active_form,
            status="pending",
            parent_tool_use_id=parent_tool_use_id,
            blocked_by=(),
            output="",
            created_at=now,
            updated_at=now,
        )
        self._tasks[task_id] = task

        return task

    def update(
        self,
        task_id: int,
        *,
        status: TaskStatus | None = None,
        subject: str | None = None,
        description: str | None = None,
        active_form: str | None = None,
        add_blocked_by: list[int] | tuple[int, ...] | None = None,
    ) -> Task:
        """Mutate fields on an existing task; return the updated record."""

        current = self._tasks.get(task_id)

        if current is None:
            raise TaskNotFound(task_id)

        updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}

        if status is not None:
            updates["status"] = status

        if subject is not None:
            updates["subject"] = subject

        if description is not None:
            updates["description"] = description

        if active_form is not None:
            updates["active_form"] = active_form

        if add_blocked_by:
            merged = set(current.blocked_by)
            merged.update(int(b) for b in add_blocked_by)
            updates["blocked_by"] = tuple(sorted(merged))

        new_task = replace(current, **updates)
        self._tasks[task_id] = new_task

        return new_task

    def append_output(self, task_id: int, output: str) -> Task:
        """Append a chunk to a task's accumulated output buffer; newline-join."""

        current = self._tasks.get(task_id)

        if current is None:
            raise TaskNotFound(task_id)

        combined = output if not current.output else current.output + "\n" + output
        new_task = replace(current, output=combined, updated_at=datetime.now(timezone.utc))
        self._tasks[task_id] = new_task

        return new_task

    def stop(self, task_id: int) -> Task:
        """Mark a task as completed - the explicit stop signal."""

        return self.update(task_id, status="completed")

    # Queries
    # ------------------------------------------------------------------

    def get(self, task_id: int) -> Task:
        """Return the task with `task_id`; raise TaskNotFound when unknown."""

        task = self._tasks.get(task_id)

        if task is None:
            raise TaskNotFound(task_id)

        return task

    def list(self, *, status_filter: TaskStatus | None = None) -> list[Task]:
        """Return tasks, optionally filtered by status; ordered by id ascending."""

        tasks = sorted(self._tasks.values(), key=lambda t: t.id)

        if status_filter is None:
            return tasks

        return [t for t in tasks if t.status == status_filter]

    # Resume
    # ------------------------------------------------------------------

    def rebuild_from_events(self, events_path: Path) -> None:
        """Replay `events.jsonl`, reconstructing the store from prior tool_use entries.

        Scans the events log for task_create / task_update / task_stop /
        task_output tool_use blocks and applies each in order. The replay
        tolerates partial / corrupt entries by skipping unparseable lines
        rather than failing session resume. After this call, `_next_id` is
        positioned so the next `create()` uses an unused id.
        """

        if not events_path.exists():
            return

        try:
            content = events_path.read_text()
        except OSError:
            return

        for line in content.splitlines():
            if not line.strip():
                continue

            try:
                data = json.loads(line)
            except (json.JSONDecodeError, ValueError):
                continue

            if data.get("subtype") != "tool_use":
                continue

            tool_name = data.get("tool_name") or data.get("content")
            tool_input = data.get("tool_input") or {}

            if tool_name == "task_create":
                self._apply_replay_create(tool_input)
            elif tool_name == "task_update":
                self._apply_replay_update(tool_input)
            elif tool_name == "task_stop":
                self._apply_replay_stop(tool_input)
            elif tool_name == "task_output":
                self._apply_replay_output(tool_input)

    # Replay helpers
    # ------------------------------------------------------------------

    def _apply_replay_create(self, tool_input: dict[str, Any]) -> None:
        """Apply a task_create entry encountered during event replay."""

        self.create(
            subject=str(tool_input.get("subject", "")),
            description=str(tool_input.get("description", "")),
            active_form=str(tool_input.get("activeForm", "")),
            parent_tool_use_id=tool_input.get("parentToolUseId"),
        )

    def _apply_replay_update(self, tool_input: dict[str, Any]) -> None:
        """Apply a task_update entry encountered during event replay."""

        task_id = tool_input.get("taskId")

        if not isinstance(task_id, int) or task_id not in self._tasks:
            return

        try:
            self.update(
                task_id,
                status=tool_input.get("status"),
                subject=tool_input.get("subject"),
                description=tool_input.get("description"),
                active_form=tool_input.get("activeForm"),
                add_blocked_by=tool_input.get("addBlockedBy"),
            )
        except TaskNotFound:
            pass

    def _apply_replay_stop(self, tool_input: dict[str, Any]) -> None:
        """Apply a task_stop entry encountered during event replay."""

        task_id = tool_input.get("taskId")

        if not isinstance(task_id, int):
            return

        try:
            self.stop(task_id)
        except TaskNotFound:
            pass

    def _apply_replay_output(self, tool_input: dict[str, Any]) -> None:
        """Apply a task_output entry encountered during event replay."""

        task_id = tool_input.get("taskId")
        output = tool_input.get("output", "")

        if not isinstance(task_id, int):
            return

        try:
            self.append_output(task_id, str(output))
        except TaskNotFound:
            pass
