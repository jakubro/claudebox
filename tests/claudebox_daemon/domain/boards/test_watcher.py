"""Tests for BoardWatcher: a changed board file or ticket file is announced as its owning board's update."""

from __future__ import annotations

import os
from pathlib import Path
from time import time_ns
from unittest.mock import AsyncMock

import pytest

from claudebox.core import file_cache
from claudebox_daemon.domain.boards.watcher import BoardWatcher


@pytest.fixture
def watcher(tmp_path, monkeypatch):
    monkeypatch.setattr(file_cache, "time_ns", lambda: time_ns() + 3600 * 10**9)
    events = AsyncMock()
    board_watcher = BoardWatcher(workspace_id="ws", workspace_root=tmp_path, events=events)
    board_watcher._debounce = 0

    return board_watcher


def _rewrite(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2 * 10**9))


def _announced(watcher: BoardWatcher) -> list[tuple[str, str]]:
    return [
        (call.args[0].workspace_id, call.args[0].board_id)
        for call in watcher._events.broadcast.await_args_list  # ty: ignore[unresolved-attribute]
    ]


@pytest.mark.anyio
async def test_a_changed_board_yaml_announces_its_board(watcher, tmp_path):
    board = tmp_path / "board.yaml"
    board.write_text("name: A\n")
    watcher.sync({board: "sprint"})

    _rewrite(board, "name: B\n")
    await watcher._poll()

    assert _announced(watcher) == [("ws", "sprint")]


@pytest.mark.anyio
async def test_a_changed_ticket_file_announces_its_owning_board(watcher, tmp_path):
    board, ticket = tmp_path / "board.yaml", tmp_path / "t1.md"
    board.write_text("name: A\n")
    ticket.write_text("# One\n")
    watcher.sync({board: "sprint", ticket: "sprint"})

    _rewrite(ticket, "# One renamed\n")
    await watcher._poll()

    assert _announced(watcher) == [("ws", "sprint")]


@pytest.mark.anyio
async def test_an_unchanged_file_announces_nothing(watcher, tmp_path):
    board = tmp_path / "board.yaml"
    board.write_text("name: A\n")
    watcher.sync({board: "sprint"})

    await watcher._poll()

    assert _announced(watcher) == []


@pytest.mark.anyio
async def test_a_file_dropped_by_sync_announces_nothing(watcher, tmp_path):
    board, ticket = tmp_path / "board.yaml", tmp_path / "t1.md"
    board.write_text("name: A\n")
    ticket.write_text("# One\n")
    watcher.sync({board: "sprint", ticket: "sprint"})
    watcher.sync({board: "sprint"})

    _rewrite(ticket, "# One renamed\n")
    await watcher._poll()

    assert _announced(watcher) == []
