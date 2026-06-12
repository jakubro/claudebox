"""Tests for claudebox.agent_session.orchestration.async_tasks - background task lifecycle."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

from claudebox.agent_session.orchestration.async_tasks import AsyncTaskManager
from ._helpers import make_published_event as _make_event


# --- check_event launch ---


class TestCheckEventLaunch:
    """Test async task launch detection from tool_result events."""

    def test_launch_detected(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        event = _make_event(
            subtype="tool_result",
            tool_use_id="tu-1",
            tool_use_result={
                "isAsync": True,
                "agentId": "agent-1",
                "outputFile": "/fake/output.jsonl",
            },
        )

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.check_event(event)
            mock_start.assert_called_once_with(
                agent_id="agent-1",
                output_file="/fake/output.jsonl",
                parent_tool_use_id="tu-1",
            )

    def test_launch_with_snake_case_keys(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        event = _make_event(
            subtype="tool_result",
            tool_use_id="tu-1",
            tool_use_result={
                "is_async": True,
                "agent_id": "agent-2",
                "output_file": "/fake/out2.jsonl",
            },
        )

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.check_event(event)
            mock_start.assert_called_once()

    def test_launch_with_status_async_launched(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        event = _make_event(
            subtype="tool_result",
            tool_use_id="tu-1",
            tool_use_result={
                "status": "async_launched",
                "agentId": "agent-3",
                "outputFile": "/fake/out3.jsonl",
            },
        )

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.check_event(event)
            mock_start.assert_called_once()

    def test_no_launch_without_async_flag(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        event = _make_event(
            subtype="tool_result",
            tool_use_id="tu-1",
            tool_use_result={"status": "success"},
        )

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.check_event(event)
            mock_start.assert_not_called()

    def test_no_launch_missing_agent_id(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        event = _make_event(
            subtype="tool_result",
            tool_use_id="tu-1",
            tool_use_result={"isAsync": True, "outputFile": "/fake/out.jsonl"},
        )

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.check_event(event)
            mock_start.assert_not_called()

    def test_duplicate_launch_idempotent(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)
        mgr._monitors["agent-1"] = (MagicMock(), MagicMock())

        mgr._start_monitor(
            agent_id="agent-1",
            output_file="/fake/out.jsonl",
            parent_tool_use_id="tu-1",
        )

        # Still only the original entry
        assert len(mgr._monitors) == 1


# --- check_event notification ---


class TestCheckEventNotification:
    """Test task completion detection."""

    def test_notification_stops_monitor(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        mock_monitor = MagicMock()
        mock_task = MagicMock()
        mgr._monitors["agent-1"] = (mock_monitor, mock_task)

        event = _make_event(
            type="system",
            subtype="task_notification",
            message_data={"task_id": "agent-1"},
        )
        mgr.check_event(event)

        assert "agent-1" not in mgr._monitors
        mock_monitor.stop.assert_called_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    def test_unknown_agent_notification_noop(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        event = _make_event(
            type="system",
            subtype="task_notification",
            message_data={"task_id": "unknown"},
        )
        # Should not raise
        mgr.check_event(event)


# --- stop_all ---


class TestStopAll:
    """Test force-stopping all monitors."""

    def test_stop_all_cancels_tasks(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        task1, task2 = MagicMock(), MagicMock()
        mgr._monitors["a1"] = (MagicMock(), task1)
        mgr._monitors["a2"] = (MagicMock(), task2)

        mgr.stop_all()

        task1.cancel.assert_called_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        task2.cancel.assert_called_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert len(mgr._monitors) == 0


# --- enrich_notification ---


class TestEnrichNotification:
    """Test notification enrichment from output files."""

    def test_enriches_with_last_assistant_text(self, tmp_path):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        output_file = tmp_path / "output.jsonl"
        output_file.write_text(
            json.dumps(
                {
                    "type": "assistant",
                    "message": {"content": [{"type": "text", "text": "Final answer"}]},
                }
            )
            + "\n"
        )

        mgr._output_files["task-1"] = str(output_file)

        event = _make_event(
            type="system",
            subtype="task_notification",
            message_data={"task_id": "task-1", "summary": "Task completed"},
        )
        mgr.enrich_notification(event)

        assert event.message_data["content"] == "Final answer"  # ty: ignore[not-subscriptable]
        assert event.message_data["summary"] == "Final answer"  # ty: ignore[not-subscriptable]

    def test_enrichment_skips_missing_output(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        event = _make_event(
            type="system",
            subtype="task_notification",
            message_data={"task_id": "unknown", "summary": "Original"},
        )
        mgr.enrich_notification(event)

        assert event.message_data["summary"] == "Original"  # ty: ignore[not-subscriptable]

    def test_enrichment_handles_empty_file(self, tmp_path):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        output_file = tmp_path / "empty.jsonl"
        output_file.write_text("")
        mgr._output_files["task-1"] = str(output_file)

        event = _make_event(
            type="system",
            subtype="task_notification",
            message_data={"task_id": "task-1", "summary": "Original"},
        )
        mgr.enrich_notification(event)

        # No text extracted - summary unchanged
        assert event.message_data["summary"] == "Original"  # ty: ignore[not-subscriptable]

    def test_enrichment_handles_malformed_json(self, tmp_path):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        output_file = tmp_path / "bad.jsonl"
        output_file.write_text("not json\n")
        mgr._output_files["task-1"] = str(output_file)

        event = _make_event(
            type="system",
            subtype="task_notification",
            message_data={"task_id": "task-1", "summary": "Original"},
        )
        mgr.enrich_notification(event)

        assert event.message_data["summary"] == "Original"  # ty: ignore[not-subscriptable]


# --- _detect_in_progress ---


class TestDetectInProgress:
    """Test detection of in-progress async tasks from event history."""

    def test_detects_launched_without_completion(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                subtype="tool_result",
                tool_use_id="tu-1",
                tool_use_result={
                    "isAsync": True,
                    "agentId": "agent-1",
                    "outputFile": "/fake/out.jsonl",
                },
            ),
        ]

        result = mgr._detect_in_progress(events)
        assert "agent-1" in result

    def test_excludes_completed_tasks(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                subtype="tool_result",
                tool_use_id="tu-1",
                tool_use_result={
                    "isAsync": True,
                    "agentId": "agent-1",
                    "outputFile": "/fake/out.jsonl",
                },
            ),
            _make_event(
                type="system",
                subtype="task_notification",
                message_data={"task_id": "agent-1"},
            ),
        ]

        result = mgr._detect_in_progress(events)
        assert "agent-1" not in result


# --- _get_resume_offset ---


class TestGetResumeOffset:
    """Test resume offset calculation for async task reattachment."""

    def test_returns_max_offset_for_agent(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                parent_tool_use_id="tu-1",
                source_file="/fake/agent-1/output.jsonl",
                source_offset=100,
            ),
            _make_event(
                parent_tool_use_id="tu-1",
                source_file="/fake/agent-1/output.jsonl",
                source_offset=500,
            ),
            _make_event(
                parent_tool_use_id="tu-1",
                source_file="/fake/agent-1/output.jsonl",
                source_offset=300,
            ),
        ]

        offset = mgr._get_resume_offset(events, "agent-1")
        assert offset == 500

    def test_returns_zero_for_no_matching_events(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                parent_tool_use_id="tu-1",
                source_file="/fake/agent-2/output.jsonl",
                source_offset=100,
            ),
        ]

        offset = mgr._get_resume_offset(events, "agent-1")
        assert offset == 0

    def test_returns_zero_for_empty_events(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        assert mgr._get_resume_offset([], "agent-1") == 0

    def test_ignores_events_without_offset(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                parent_tool_use_id="tu-1",
                source_file="/fake/agent-1/output.jsonl",
                source_offset=None,
            ),
        ]

        assert mgr._get_resume_offset(events, "agent-1") == 0


# --- reattach ---


class TestReattach:
    """Test session resume reattachment of monitors."""

    def test_reattaches_in_progress_tasks(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                subtype="tool_result",
                tool_use_id="tu-1",
                tool_use_result={
                    "isAsync": True,
                    "agentId": "agent-1",
                    "outputFile": "/fake/out.jsonl",
                },
            ),
        ]

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.reattach(events)
            mock_start.assert_called_once_with(
                agent_id="agent-1",
                output_file="/fake/out.jsonl",
                parent_tool_use_id="tu-1",
                start_offset=0,
            )

    def test_skips_completed_tasks(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                subtype="tool_result",
                tool_use_id="tu-1",
                tool_use_result={
                    "isAsync": True,
                    "agentId": "agent-1",
                    "outputFile": "/fake/out.jsonl",
                },
            ),
            _make_event(
                type="system",
                subtype="task_notification",
                message_data={"task_id": "agent-1"},
            ),
        ]

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.reattach(events)
            mock_start.assert_not_called()

    def test_resumes_with_correct_offset(self):
        on_event = AsyncMock()
        mgr = AsyncTaskManager(on_event=on_event)

        events = [
            _make_event(
                subtype="tool_result",
                tool_use_id="tu-1",
                tool_use_result={
                    "isAsync": True,
                    "agentId": "agent-1",
                    "outputFile": "/fake/out.jsonl",
                },
            ),
            _make_event(
                parent_tool_use_id="tu-1",
                source_file="/fake/agent-1/stream.jsonl",
                source_offset=1024,
            ),
        ]

        with patch.object(mgr, "_start_monitor") as mock_start:
            mgr.reattach(events)
            mock_start.assert_called_once_with(
                agent_id="agent-1",
                output_file="/fake/out.jsonl",
                parent_tool_use_id="tu-1",
                start_offset=1024,
            )
