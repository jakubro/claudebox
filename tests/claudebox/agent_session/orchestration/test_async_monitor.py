"""Tests for claudebox.agent_session.orchestration.async_monitor.AsyncTaskMonitor."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from claudebox.agent_session.orchestration.async_monitor import AsyncTaskMonitor
from claudebox.agent_session.orchestration.models import Event


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_monitor(
    tmp_path: Path,
    on_event: AsyncMock | None = None,
    filename: str = "output.jsonl",
    start_offset: int = 0,
) -> tuple[AsyncTaskMonitor, Path, AsyncMock]:
    """Create monitor with defaults pointing at a tmp file."""
    output_file = tmp_path / filename
    cb = on_event or AsyncMock()
    monitor = AsyncTaskMonitor(
        agent_id="agent-1",
        output_file=output_file,
        parent_tool_use_id="tu-1",
        on_event=cb,
        start_offset=start_offset,
    )
    return monitor, output_file, cb


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


class TestInit:
    """Basic construction and attribute assignment."""

    def test_stores_attributes(self, tmp_path):
        monitor, output_file, cb = _make_monitor(tmp_path)

        assert monitor.agent_id == "agent-1"
        assert monitor.output_file == output_file
        assert monitor.parent_tool_use_id == "tu-1"
        assert monitor.on_event is cb

    def test_accepts_string_path(self, tmp_path):
        cb = AsyncMock()
        monitor = AsyncTaskMonitor(
            agent_id="a",
            output_file=str(tmp_path / "out.jsonl"),
            parent_tool_use_id="tu",
            on_event=cb,
        )
        assert isinstance(monitor.output_file, Path)

    def test_default_offset_is_zero(self, tmp_path):
        monitor, _, _ = _make_monitor(tmp_path)
        assert monitor._offset == 0

    def test_custom_start_offset(self, tmp_path):
        monitor, _, _ = _make_monitor(tmp_path, start_offset=512)
        assert monitor._offset == 512


# ---------------------------------------------------------------------------
# stop()
# ---------------------------------------------------------------------------


class TestStop:
    """The stop method sets internal flag to halt the run loop."""

    def test_stop_sets_running_false(self, tmp_path):
        monitor, _, _ = _make_monitor(tmp_path)
        monitor._running = True
        monitor.stop()
        assert monitor._running is False


# ---------------------------------------------------------------------------
# _process_line — JSON parsing and event dispatch
# ---------------------------------------------------------------------------


class TestProcessLine:
    """Unit tests for _process_line — JSON parsing and event emission."""

    @pytest.mark.anyio
    async def test_valid_json_emits_events(self, tmp_path):
        monitor, _, cb = _make_monitor(tmp_path)

        data = {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "hello"}],
            },
        }
        await monitor._process_line(json.dumps(data))

        assert cb.call_count >= 1
        # First positional arg of first call is an Event
        event = cb.call_args_list[0][0][0]
        assert isinstance(event, Event)

    @pytest.mark.anyio
    async def test_empty_line_is_skipped(self, tmp_path):
        monitor, _, cb = _make_monitor(tmp_path)
        await monitor._process_line("")
        cb.assert_not_called()

    @pytest.mark.anyio
    async def test_malformed_json_does_not_raise(self, tmp_path):
        monitor, _, cb = _make_monitor(tmp_path)
        await monitor._process_line("not valid json {{{")
        cb.assert_not_called()

    @pytest.mark.anyio
    async def test_malformed_json_logs_warning(self, tmp_path):
        monitor, _, cb = _make_monitor(tmp_path)
        with patch.object(monitor._logger, "warning") as mock_warn:
            await monitor._process_line("{bad json")
            mock_warn.assert_called_once()

    @pytest.mark.anyio
    async def test_on_event_receives_output_file_and_offset(self, tmp_path):
        monitor, output_file, cb = _make_monitor(tmp_path)
        monitor._offset = 42

        data = {"type": "system", "message": {"subtype": "ping"}}
        await monitor._process_line(json.dumps(data))

        assert cb.call_count >= 1
        _, file_arg, offset_arg = cb.call_args_list[0][0]
        assert file_arg == str(output_file)
        assert offset_arg == 42


# ---------------------------------------------------------------------------
# run() — file tailing integration
# ---------------------------------------------------------------------------


class TestRun:
    """Integration tests for the run loop using real files."""

    @pytest.mark.anyio
    async def test_reads_existing_lines_then_stops(self, tmp_path):
        """Write lines before starting, then stop after they are consumed."""
        monitor, output_file, cb = _make_monitor(tmp_path)

        line1 = {"type": "system", "message": {"subtype": "init"}}
        line2 = {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "hi"}],
            },
        }
        output_file.write_text(json.dumps(line1) + "\n" + json.dumps(line2) + "\n")

        # Wrap on_event so we stop after receiving events
        original_cb = AsyncMock()
        call_count = 0

        async def _counting_cb(event, path, offset):
            nonlocal call_count
            call_count += 1
            await original_cb(event, path, offset)
            # line2 produces multiple events (text block); stop once we have some
            if call_count >= 2:
                monitor.stop()

        monitor.on_event = _counting_cb  # ty: ignore[invalid-assignment]  # Test callback structurally replaces the real on_event handler.

        await monitor.run()

        assert original_cb.call_count >= 2

    @pytest.mark.anyio
    async def test_offset_skips_already_read_bytes(self, tmp_path):
        """Starting with an offset skips content before that byte position."""
        _, output_file, _ = _make_monitor(tmp_path)

        first_line = json.dumps({"type": "system", "message": {"subtype": "a"}}) + "\n"
        second_line = json.dumps({"type": "system", "message": {"subtype": "b"}}) + "\n"
        output_file.write_text(first_line + second_line)

        offset = len(first_line)
        monitor, _, cb = _make_monitor(tmp_path, start_offset=offset)

        async def _stop_cb(event, path, off):
            await cb(event, path, off)
            monitor.stop()

        monitor.on_event = _stop_cb  # ty: ignore[invalid-assignment]  # Test callback structurally replaces the real on_event handler.
        await monitor.run()

        # Should only have seen the second line's event
        assert cb.call_count == 1
        event = cb.call_args_list[0][0][0]
        assert event.raw["message"]["subtype"] == "b"

    @pytest.mark.anyio
    async def test_waits_for_file_to_exist(self, tmp_path):
        """Monitor waits for the output file before reading."""
        import asyncio

        monitor, output_file, cb = _make_monitor(tmp_path)

        async def _stop_cb(event, path, off):
            await cb(event, path, off)
            monitor.stop()

        monitor.on_event = _stop_cb  # ty: ignore[invalid-assignment]  # Test callback structurally replaces the real on_event handler.

        # Create file after a short delay
        async def _create_file():
            await asyncio.sleep(0.15)
            line = json.dumps({"type": "system", "message": {"subtype": "delayed"}})
            output_file.write_text(line + "\n")

        async with asyncio.TaskGroup() as tg:
            tg.create_task(monitor.run())
            tg.create_task(_create_file())

        assert cb.call_count == 1

    @pytest.mark.anyio
    async def test_stops_before_file_exists(self, tmp_path):
        """If stopped while waiting for file, run exits cleanly."""
        import asyncio

        monitor, output_file, cb = _make_monitor(tmp_path)

        async def _stop_soon():
            await asyncio.sleep(0.15)
            monitor.stop()

        async with asyncio.TaskGroup() as tg:
            tg.create_task(monitor.run())
            tg.create_task(_stop_soon())

        cb.assert_not_called()

    @pytest.mark.anyio
    async def test_skips_blank_and_malformed_lines(self, tmp_path):
        """Blank lines and invalid JSON are silently skipped."""
        monitor, output_file, cb = _make_monitor(tmp_path)

        valid = json.dumps({"type": "system", "message": {"subtype": "ok"}})
        output_file.write_text("\n\nbad json\n" + valid + "\n")

        async def _stop_cb(event, path, off):
            await cb(event, path, off)
            monitor.stop()

        monitor.on_event = _stop_cb  # ty: ignore[invalid-assignment]  # Test callback structurally replaces the real on_event handler.
        await monitor.run()

        assert cb.call_count == 1

    @pytest.mark.anyio
    async def test_offset_advances_after_each_line(self, tmp_path):
        """The internal offset advances as lines are consumed."""
        monitor, output_file, cb = _make_monitor(tmp_path)

        line = json.dumps({"type": "system", "message": {"subtype": "x"}}) + "\n"
        output_file.write_text(line * 3)

        offsets_seen: list[int] = []

        async def _tracking_cb(event, path, off):
            offsets_seen.append(off)
            if len(offsets_seen) >= 3:
                monitor.stop()

        monitor.on_event = _tracking_cb  # ty: ignore[invalid-assignment]  # Test callback structurally replaces the real on_event handler.
        await monitor.run()

        # Each offset should be strictly greater than the previous
        assert len(offsets_seen) == 3
        assert offsets_seen == sorted(offsets_seen)
        assert offsets_seen[0] > 0
        assert offsets_seen[2] > offsets_seen[1] > offsets_seen[0]
