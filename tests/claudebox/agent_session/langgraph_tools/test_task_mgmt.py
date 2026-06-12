"""task_mgmt.py @tool tests - 6 wrappers over TaskService."""

from dataclasses import replace

import pytest
from langchain_core.tools import ToolException

from claudebox.agent_session._daemon_services import DaemonServiceBundle
from claudebox.agent_session._tasks import TaskService
from claudebox.agent_session.langgraph_tools.task_mgmt import make_task_mgmt_tools


def _bundle() -> DaemonServiceBundle:
    return DaemonServiceBundle(tasks=TaskService(session_id="test"))


def _tools(tool_ctx, *, bundle: DaemonServiceBundle | None = None):
    ctx = replace(tool_ctx, daemon_services=bundle if bundle is not None else _bundle())
    by_name = {t.name: t for t in make_task_mgmt_tools(ctx)}

    return ctx, by_name


class TestMakeTaskMgmtTools:
    def test_returns_empty_when_daemon_services_missing(self, tool_ctx):
        ctx = replace(tool_ctx, daemon_services=None)

        assert make_task_mgmt_tools(ctx) == []

    def test_returns_empty_when_tasks_slot_missing(self, tool_ctx):
        ctx = replace(tool_ctx, daemon_services=DaemonServiceBundle(tasks=None))

        assert make_task_mgmt_tools(ctx) == []

    def test_returns_six_tools_in_canonical_order(self, tool_ctx):
        _, by_name = _tools(tool_ctx)

        assert set(by_name) == {
            "task_create",
            "task_get",
            "task_list",
            "task_output",
            "task_stop",
            "task_update",
        }


class TestTaskCreate:
    def test_returns_camelcase_wire_record(self, tool_ctx):
        _, tools = _tools(tool_ctx)

        result = tools["task_create"].invoke(
            {"subject": "Audit", "description": "d", "activeForm": "Auditing"}
        )

        assert result["task"]["id"] == 1
        assert result["task"]["subject"] == "Audit"
        assert result["task"]["description"] == "d"
        assert result["task"]["activeForm"] == "Auditing"
        assert result["task"]["status"] == "pending"

    def test_increments_id(self, tool_ctx):
        _, tools = _tools(tool_ctx)

        first = tools["task_create"].invoke({"subject": "a"})
        second = tools["task_create"].invoke({"subject": "b"})

        assert (first["task"]["id"], second["task"]["id"]) == (1, 2)


class TestTaskGet:
    def test_returns_task_wrapped(self, tool_ctx):
        _, tools = _tools(tool_ctx)
        tools["task_create"].invoke({"subject": "x"})

        result = tools["task_get"].invoke({"taskId": 1})

        assert result["task"]["id"] == 1
        assert result["task"]["subject"] == "x"

    def test_unknown_raises_tool_exception(self, tool_ctx):
        _, tools = _tools(tool_ctx)

        with pytest.raises(ToolException, match="Task not found"):
            tools["task_get"].invoke({"taskId": 999})


class TestTaskList:
    def test_lists_all_when_no_filter(self, tool_ctx):
        _, tools = _tools(tool_ctx)
        tools["task_create"].invoke({"subject": "a"})
        tools["task_create"].invoke({"subject": "b"})

        result = tools["task_list"].invoke({})

        assert [t["subject"] for t in result["tasks"]] == ["a", "b"]

    def test_filters_by_status(self, tool_ctx):
        _, tools = _tools(tool_ctx)
        tools["task_create"].invoke({"subject": "a"})
        tools["task_create"].invoke({"subject": "b"})
        tools["task_update"].invoke({"taskId": 1, "status": "in_progress"})

        in_progress = tools["task_list"].invoke({"statusFilter": "in_progress"})
        pending = tools["task_list"].invoke({"statusFilter": "pending"})

        assert [t["subject"] for t in in_progress["tasks"]] == ["a"]
        assert [t["subject"] for t in pending["tasks"]] == ["b"]


class TestTaskOutput:
    def test_returns_accumulated_buffer(self, tool_ctx):
        ctx, tools = _tools(tool_ctx)
        tools["task_create"].invoke({"subject": "x"})
        ctx.daemon_services.tasks.append_output(1, "line 1")
        ctx.daemon_services.tasks.append_output(1, "line 2")

        result = tools["task_output"].invoke({"taskId": 1})

        assert result["output"] == "line 1\nline 2"

    def test_unknown_raises(self, tool_ctx):
        _, tools = _tools(tool_ctx)

        with pytest.raises(ToolException, match="Task not found"):
            tools["task_output"].invoke({"taskId": 999})


class TestTaskStop:
    def test_marks_completed(self, tool_ctx):
        _, tools = _tools(tool_ctx)
        tools["task_create"].invoke({"subject": "x"})

        result = tools["task_stop"].invoke({"taskId": 1})

        assert result["task"]["status"] == "completed"

    def test_unknown_raises(self, tool_ctx):
        _, tools = _tools(tool_ctx)

        with pytest.raises(ToolException, match="Task not found"):
            tools["task_stop"].invoke({"taskId": 999})


class TestTaskUpdate:
    def test_updates_status(self, tool_ctx):
        _, tools = _tools(tool_ctx)
        tools["task_create"].invoke({"subject": "x"})

        result = tools["task_update"].invoke({"taskId": 1, "status": "in_progress"})

        assert result["task"]["status"] == "in_progress"

    def test_merges_add_blocked_by(self, tool_ctx):
        _, tools = _tools(tool_ctx)

        for s in ("a", "b", "c"):
            tools["task_create"].invoke({"subject": s})

        tools["task_update"].invoke({"taskId": 1, "addBlockedBy": [2]})
        result = tools["task_update"].invoke({"taskId": 1, "addBlockedBy": [3, 2]})

        assert result["task"]["blockedBy"] == [2, 3]

    def test_revise_subject_and_description(self, tool_ctx):
        _, tools = _tools(tool_ctx)
        tools["task_create"].invoke({"subject": "old subject"})

        result = tools["task_update"].invoke(
            {
                "taskId": 1,
                "subject": "new subject",
                "description": "added context",
                "activeForm": "Working",
            }
        )

        assert result["task"]["subject"] == "new subject"
        assert result["task"]["description"] == "added context"
        assert result["task"]["activeForm"] == "Working"

    def test_unknown_raises(self, tool_ctx):
        _, tools = _tools(tool_ctx)

        with pytest.raises(ToolException, match="Task not found"):
            tools["task_update"].invoke({"taskId": 999, "status": "completed"})
