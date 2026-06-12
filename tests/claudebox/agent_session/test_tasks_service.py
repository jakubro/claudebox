"""TaskService unit tests - in-memory store + event-replay rebuild."""

import json
from pathlib import Path

import pytest

from claudebox.agent_session._tasks import TaskNotFound, TaskService


@pytest.fixture
def service() -> TaskService:
    return TaskService(session_id="test-session")


class TestCreate:
    def test_first_task_gets_id_one(self, service):
        task = service.create(subject="Audit auth flow")

        assert task.id == 1
        assert task.subject == "Audit auth flow"
        assert task.status == "pending"
        assert task.blocked_by == ()

    def test_monotonic_ids(self, service):
        a = service.create(subject="a")
        b = service.create(subject="b")
        c = service.create(subject="c")

        assert (a.id, b.id, c.id) == (1, 2, 3)

    def test_carries_optional_fields(self, service):
        task = service.create(
            subject="Run probe",
            description="Investigate auth race",
            active_form="Running auth probe",
            parent_tool_use_id="tool_42",
        )

        assert task.description == "Investigate auth race"
        assert task.active_form == "Running auth probe"
        assert task.parent_tool_use_id == "tool_42"


class TestGet:
    def test_get_unknown_raises(self, service):
        with pytest.raises(TaskNotFound):
            service.get(999)

    def test_get_returns_task(self, service):
        created = service.create(subject="x")

        fetched = service.get(created.id)

        assert fetched is created  # frozen dataclass identity-stable until mutation


class TestList:
    def test_empty(self, service):
        assert service.list() == []

    def test_returns_all_sorted_by_id(self, service):
        a = service.create(subject="a")
        b = service.create(subject="b")
        c = service.create(subject="c")

        assert [t.id for t in service.list()] == [a.id, b.id, c.id]

    def test_filter_by_status(self, service):
        first = service.create(subject="first")
        service.create(subject="second")
        service.update(first.id, status="in_progress")

        in_progress = service.list(status_filter="in_progress")
        pending = service.list(status_filter="pending")

        assert [t.subject for t in in_progress] == ["first"]
        assert [t.subject for t in pending] == ["second"]


class TestUpdate:
    def test_status_transition(self, service):
        task = service.create(subject="x")

        updated = service.update(task.id, status="in_progress")

        assert updated.status == "in_progress"
        assert service.get(task.id).status == "in_progress"

    def test_subject_and_description(self, service):
        task = service.create(subject="x")

        updated = service.update(task.id, subject="x revised", description="more context")

        assert updated.subject == "x revised"
        assert updated.description == "more context"

    def test_add_blocked_by_merges_unique_sorted(self, service):
        task = service.create(subject="x")
        service.create(subject="y")
        service.create(subject="z")

        service.update(task.id, add_blocked_by=[3])
        service.update(task.id, add_blocked_by=[2, 3])
        final = service.update(task.id, add_blocked_by=[2])

        assert final.blocked_by == (2, 3)

    def test_unknown_raises(self, service):
        with pytest.raises(TaskNotFound):
            service.update(999, status="completed")


class TestStop:
    def test_marks_completed(self, service):
        task = service.create(subject="x")

        stopped = service.stop(task.id)

        assert stopped.status == "completed"


class TestAppendOutput:
    def test_first_append_sets_buffer(self, service):
        task = service.create(subject="x")

        updated = service.append_output(task.id, "first line")

        assert updated.output == "first line"

    def test_subsequent_appends_newline_joined(self, service):
        task = service.create(subject="x")

        service.append_output(task.id, "first")
        service.append_output(task.id, "second")
        final = service.append_output(task.id, "third")

        assert final.output == "first\nsecond\nthird"

    def test_unknown_raises(self, service):
        with pytest.raises(TaskNotFound):
            service.append_output(999, "anything")


class TestAsdict:
    def test_camelcase_wire_keys(self, service):
        task = service.create(
            subject="Run probe",
            description="d",
            active_form="Running",
            parent_tool_use_id="tool_5",
        )
        service.update(task.id, add_blocked_by=[7, 9])

        wire = service.get(task.id).asdict()

        assert set(wire.keys()) == {
            "id",
            "subject",
            "description",
            "activeForm",
            "status",
            "parentToolUseId",
            "blockedBy",
            "output",
            "createdAt",
            "updatedAt",
        }
        assert wire["activeForm"] == "Running"
        assert wire["parentToolUseId"] == "tool_5"
        assert wire["blockedBy"] == [7, 9]
        # createdAt is an ISO-8601 string, not a datetime.
        assert isinstance(wire["createdAt"], str)


class TestRebuildFromEvents:
    def _write(self, path: Path, events: list[dict]) -> None:
        path.write_text("\n".join(json.dumps(e) for e in events) + "\n")

    def test_missing_file_is_noop(self, service, tmp_path):
        service.rebuild_from_events(tmp_path / "absent.jsonl")

        assert service.list() == []

    def test_malformed_lines_skipped(self, service, tmp_path):
        path = tmp_path / "events.jsonl"
        path.write_text(
            "not-json\n"
            + json.dumps(
                {
                    "subtype": "tool_use",
                    "tool_name": "task_create",
                    "tool_input": {"subject": "ok"},
                }
            )
            + "\n"
        )

        service.rebuild_from_events(path)

        assert [t.subject for t in service.list()] == ["ok"]

    def test_full_lifecycle_replay(self, service, tmp_path):
        path = tmp_path / "events.jsonl"
        self._write(
            path,
            [
                {
                    "subtype": "tool_use",
                    "tool_name": "task_create",
                    "tool_input": {"subject": "first", "activeForm": "Running first"},
                },
                {
                    "subtype": "tool_use",
                    "tool_name": "task_create",
                    "tool_input": {"subject": "second"},
                },
                {
                    "subtype": "tool_use",
                    "tool_name": "task_update",
                    "tool_input": {"taskId": 1, "status": "in_progress"},
                },
                {
                    "subtype": "tool_use",
                    "tool_name": "task_output",
                    "tool_input": {"taskId": 1, "output": "probe started"},
                },
                {
                    "subtype": "tool_use",
                    "tool_name": "task_stop",
                    "tool_input": {"taskId": 2},
                },
            ],
        )

        service.rebuild_from_events(path)

        all_tasks = service.list()
        assert [t.id for t in all_tasks] == [1, 2]
        assert all_tasks[0].subject == "first"
        assert all_tasks[0].active_form == "Running first"
        assert all_tasks[0].status == "in_progress"
        assert all_tasks[0].output == "probe started"
        assert all_tasks[1].status == "completed"

    def test_update_against_unknown_id_ignored(self, service, tmp_path):
        path = tmp_path / "events.jsonl"
        self._write(
            path,
            [
                {
                    "subtype": "tool_use",
                    "tool_name": "task_update",
                    "tool_input": {"taskId": 5, "status": "completed"},
                },
            ],
        )

        # Should not raise even though id 5 was never created.
        service.rebuild_from_events(path)

        assert service.list() == []

    def test_non_tool_use_events_ignored(self, service, tmp_path):
        path = tmp_path / "events.jsonl"
        self._write(
            path,
            [
                {"subtype": "text", "content": "hello"},
                {"subtype": "tool_result", "tool_use_id": "x", "content": "ok"},
                {
                    "subtype": "tool_use",
                    "tool_name": "task_create",
                    "tool_input": {"subject": "only-one"},
                },
            ],
        )

        service.rebuild_from_events(path)

        assert [t.subject for t in service.list()] == ["only-one"]
