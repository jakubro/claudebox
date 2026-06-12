"""Task-management tools - 6 thin wrappers over the per-session TaskService.

Each wrapper is ~10 lines: validate input, call `ctx.daemon_services.tasks`,
format the return. State lives in the TaskService (in-memory, per-session);
these tools project it to the model and emit canonical tool_use blocks the
frontend picks up via the existing `appendTaskDiffs` pipeline.

Input / output keys are camelCase (subject, activeForm, taskId,
addBlockedBy, statusFilter) so the wire format matches Claude's TaskCreate
/ TaskUpdate / TaskGet / TaskList / TaskOutput / TaskStop shape - the
frontend's `_applyTaskCreate` / `_applyTaskUpdate` / `_applyTaskResult` and
`appendTaskDiffs` keyed on `activeForm`, `addBlockedBy`, `taskId`, and
`tool_use_result.task.id` continue to apply unchanged. Only the tool-name
gate (TaskCreate vs task_create) needs frontend normalisation - handled
in `schema.js::TOOL_NAME_ALIASES`.
"""

from typing import Any, cast

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext
from .._tasks import TaskNotFound, TaskStatus


def make_task_mgmt_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the six task_* @tool functions.

    Returns an empty list when the runtime did not populate
    `daemon_services` or its `tasks` slot - a misconfigured runtime then
    surfaces as the model encountering an unbound tool rather than as a
    runtime crash mid invocation.
    """

    bundle = ctx.daemon_services

    if bundle is None or bundle.tasks is None:
        return []

    tasks = bundle.tasks

    @tool
    def task_create(
        subject: str,
        description: str = "",
        activeForm: str = "",  # noqa: N803 - camelCase wire format for Claude parity
    ) -> dict[str, Any]:
        """Create a new pending task; return its record.

        `subject` is the headline shown in the task panel. `description` is
        optional secondary text. `activeForm` is the present-continuous
        phrasing rendered while the task runs (e.g. "Reading file"). The
        returned dict's `task.id` carries the assigned numeric id so the
        model can reference the task in subsequent task_update / task_get
        / task_stop / task_output calls.
        """

        record = tasks.create(subject=subject, description=description, active_form=activeForm)

        return {"task": record.asdict()}

    @tool
    def task_get(taskId: int) -> dict[str, Any]:  # noqa: N803
        """Return the full record for `taskId`."""

        try:
            return {"task": tasks.get(taskId).asdict()}
        except TaskNotFound as exc:
            raise ToolException(str(exc)) from exc

    @tool
    def task_list(statusFilter: str | None = None) -> dict[str, Any]:  # noqa: N803
        """List tasks, optionally filtered by status (pending/in_progress/completed)."""

        narrowed = cast("TaskStatus | None", statusFilter)

        return {"tasks": [t.asdict() for t in tasks.list(status_filter=narrowed)]}

    @tool
    def task_output(taskId: int) -> dict[str, Any]:  # noqa: N803
        """Return the accumulated output buffer for `taskId`."""

        try:
            return {"output": tasks.get(taskId).output}
        except TaskNotFound as exc:
            raise ToolException(str(exc)) from exc

    @tool
    def task_stop(taskId: int) -> dict[str, Any]:  # noqa: N803
        """Mark `taskId` as completed; return the updated record."""

        try:
            return {"task": tasks.stop(taskId).asdict()}
        except TaskNotFound as exc:
            raise ToolException(str(exc)) from exc

    @tool
    def task_update(
        taskId: int,  # noqa: N803
        status: str | None = None,
        subject: str | None = None,
        description: str | None = None,
        activeForm: str | None = None,  # noqa: N803
        addBlockedBy: list[int] | None = None,  # noqa: N803
    ) -> dict[str, Any]:
        """Mutate fields on an existing task; return the updated record."""

        narrowed_status = cast("TaskStatus | None", status)

        try:
            return {
                "task": tasks.update(
                    taskId,
                    status=narrowed_status,
                    subject=subject,
                    description=description,
                    active_form=activeForm,
                    add_blocked_by=addBlockedBy,
                ).asdict()
            }
        except TaskNotFound as exc:
            raise ToolException(str(exc)) from exc

    return [task_create, task_get, task_list, task_output, task_stop, task_update]


__all__ = ["make_task_mgmt_tools"]
