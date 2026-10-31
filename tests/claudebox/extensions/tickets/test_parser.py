"""Tests for board YAML parser."""

from __future__ import annotations

import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from filelock import FileLock
from ruamel.yaml import YAML

from claudebox.extensions.tickets.errors import (
    BoardLocked,
    BoardParseError,
    InvalidLabel,
    StateNotFound,
    SwimlaneNotFound,
    TicketMoveRefused,
    TicketNotFound,
)
from claudebox.extensions.tickets.models import Board, BoardState, BoardSummary, Swimlane
from claudebox.extensions.tickets.parser import (
    _resolve_title,
    _write_yaml,
    add_swimlane,
    archive_ticket,
    assign_ticket,
    board_id_from_path,
    board_name_from_path,
    board_summary,
    delete_swimlane,
    move_ticket,
    parse_board,
    rename_board,
    rename_state,
    rename_swimlane,
    reorder_states,
    reorder_swimlanes,
)


_yaml = YAML()
_yaml.preserve_quotes = True


# --- Helpers ---


_STATES_YAML = (
    "states:\n"
    "  - id: backlog\n"
    "    label: Backlog\n"
    "    folder: tickets/backlog/\n"
    "  - id: in-progress\n"
    "    label: In Progress\n"
    "    folder: tickets/in-progress/\n"
    "  - id: review\n"
    "    label: Review\n"
    "    folder: tickets/review/\n"
    "  - id: done\n"
    "    label: Done\n"
    "    folder: tickets/completed/\n"
    "    terminal: true\n"
    "  - id: rejected\n"
    "    label: Rejected\n"
    "    folder: tickets/rejected/\n"
    "    terminal: true\n"
    "  - id: definitely-rejected\n"
    "    label: Definitely Rejected\n"
    "    folder: tickets/definitely-rejected/\n"
    "    terminal: true\n"
)


def _minimal_board_yaml() -> str:
    """Return minimal valid board.yaml content."""

    return (
        _STATES_YAML + "backlog:\n"
        "  - path: tickets/backlog/t1.md\n"
        "in-progress: []\n"
        "review: []\n"
        "done: []\n"
        "rejected: []\n"
        "definitely-rejected: []\n"
    )


def _full_board_yaml() -> str:
    """Return a board.yaml with swimlanes and multiple tickets."""

    return (
        _STATES_YAML + "prompt:\n"
        "  system: Do the thing\n"
        "swimlanes:\n"
        "  - id: frontend\n"
        "    name: Frontend\n"
        "  - id: backend\n"
        "    name: Backend\n"
        "backlog:\n"
        "  - path: tickets/backlog/t1.md\n"
        "    swimlane: frontend\n"
        "  - path: tickets/backlog/t2.md\n"
        "    swimlane: backend\n"
        "in-progress:\n"
        "  - path: tickets/in-progress/t3.md\n"
        "    session: sess-1\n"
        "review: []\n"
        "done: []\n"
        "rejected: []\n"
        "definitely-rejected: []\n"
    )


def _write_board(tmp_path: Path, content: str) -> Path:
    """Write board.yaml to a temp directory and return its path."""
    board_dir = tmp_path / "project" / "tickets"
    board_dir.mkdir(parents=True)
    yaml_path = board_dir / "board.yaml"
    yaml_path.write_text(content)

    return yaml_path


def _read_yaml(path: Path) -> dict:
    """Read YAML from path and return as dict."""

    return _yaml.load(path)


# --- board_id_from_path ---


class TestBoardIdFromPath:
    """Tests for board_id_from_path."""

    def test_nested_path(self, tmp_path: Path) -> None:
        """Derive board ID from nested directory path."""
        yaml_path = tmp_path / "docs" / "tickets" / "board.yaml"
        result = board_id_from_path(yaml_path, tmp_path)
        assert result == "docs-tickets"

    def test_root_path(self, tmp_path: Path) -> None:
        """Return 'root' when board.yaml is at workspace root."""
        yaml_path = tmp_path / "board.yaml"
        result = board_id_from_path(yaml_path, tmp_path)
        assert result == "root"

    def test_single_level(self, tmp_path: Path) -> None:
        """Derive board ID from single-level directory."""
        yaml_path = tmp_path / "boards" / "board.yaml"
        result = board_id_from_path(yaml_path, tmp_path)
        assert result == "boards"


# --- board_name_from_path ---


class TestBoardNameFromPath:
    """Tests for board_name_from_path."""

    def test_named_directory(self, tmp_path: Path) -> None:
        """Return parent directory name."""
        yaml_path = tmp_path / "tickets" / "board.yaml"
        assert board_name_from_path(yaml_path) == "tickets"

    def test_root_directory(self) -> None:
        """Return 'root' when parent directory has no name."""
        yaml_path = Path("/board.yaml")
        assert board_name_from_path(yaml_path) == "root"


# --- board_summary ---


class TestBoardSummary:
    """Tests for board_summary."""

    def test_returns_summary(self, tmp_path: Path) -> None:
        """Create BoardSummary from yaml path and workspace root."""
        yaml_path = tmp_path / "project" / "board.yaml"
        result = board_summary(yaml_path, tmp_path)
        assert isinstance(result, BoardSummary)
        assert result.id == "project"
        assert result.name == "project"
        assert result.path == "project/board.yaml"


# --- parse_board ---


class TestParseBoard:
    """Tests for parse_board."""

    def test_valid_minimal(self, tmp_path: Path) -> None:
        """Parse a minimal valid board.yaml."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        board = parse_board(yaml_path, tmp_path)

        assert isinstance(board, Board)
        assert board.name == "tickets"
        assert len(board.columns["backlog"]) == 1
        assert board.columns["backlog"][0].path == "tickets/backlog/t1.md"

    def test_valid_full(self, tmp_path: Path) -> None:
        """Parse board.yaml with swimlanes, prompt, and multiple tickets."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        board = parse_board(yaml_path, tmp_path)

        assert board.prompt == {"system": "Do the thing"}
        assert len(board.swimlanes) == 2
        assert board.swimlanes[0] == Swimlane(id="frontend", name="Frontend")
        assert len(board.columns["backlog"]) == 2
        assert board.columns["in-progress"][0].session == "sess-1"

    def test_missing_file(self, tmp_path: Path) -> None:
        """Raise BoardParseError when board.yaml does not exist."""
        yaml_path = tmp_path / "nonexistent" / "board.yaml"

        with pytest.raises(BoardParseError):
            parse_board(yaml_path, tmp_path)

    def test_invalid_yaml(self, tmp_path: Path) -> None:
        """Raise BoardParseError when YAML is malformed."""
        yaml_path = _write_board(tmp_path, ":\n  :\n  - [invalid{yaml")

        with pytest.raises(BoardParseError):
            parse_board(yaml_path, tmp_path)

    def test_non_mapping_root(self, tmp_path: Path) -> None:
        """Raise BoardParseError when root is not a mapping."""
        yaml_path = _write_board(tmp_path, "- item1\n- item2\n")

        with pytest.raises(BoardParseError) as exc_info:
            parse_board(yaml_path, tmp_path)

        assert "Expected YAML mapping" in str(exc_info.value.context)

    def test_empty_columns(self, tmp_path: Path) -> None:
        """Parse board with all empty columns."""
        content = (
            _STATES_YAML
            + "\n".join(
                f"{col}: []"
                for col in [
                    "backlog",
                    "in-progress",
                    "review",
                    "done",
                    "rejected",
                    "definitely-rejected",
                ]
            )
            + "\n"
        )
        yaml_path = _write_board(tmp_path, content)
        board = parse_board(yaml_path, tmp_path)

        for col_tickets in board.columns.values():
            assert col_tickets == []

    def test_missing_columns_default_empty(self, tmp_path: Path) -> None:
        """Missing column keys result in empty ticket lists."""
        yaml_path = _write_board(tmp_path, _STATES_YAML + "backlog: []\n")
        board = parse_board(yaml_path, tmp_path)
        assert board.columns["backlog"] == []
        assert board.columns["in-progress"] == []

    def test_missing_states_raises(self, tmp_path: Path) -> None:
        """Raise BoardParseError when states: section is missing."""
        yaml_path = _write_board(tmp_path, "backlog: []\n")

        with pytest.raises(BoardParseError):
            parse_board(yaml_path, tmp_path)

    def test_resolves_title_from_markdown(self, tmp_path: Path) -> None:
        """Resolve ticket title from markdown heading relative to board.yaml parent."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# My Cool Ticket\n\nBody here.\n")

        board = parse_board(yaml_path, tmp_path)
        assert board.columns["backlog"][0].title == "My Cool Ticket"


# --- move_ticket ---


class TestMoveTicket:
    """Tests for move_ticket."""

    def test_column_change(self, tmp_path: Path) -> None:
        """Move ticket from backlog to in-progress column."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")

        result = move_ticket(
            yaml_path,
            "tickets/backlog/t1.md",
            root=tmp_path,
            column="in-progress",
        )

        assert result["path"] == "tickets/in-progress/t1.md"
        data = _read_yaml(yaml_path)
        assert len(data["backlog"]) == 0
        assert len(data["in-progress"]) == 1

    def test_swimlane_change(self, tmp_path: Path) -> None:
        """Change ticket swimlane without changing column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        result = move_ticket(yaml_path, "tickets/backlog/t1.md", root=tmp_path, swimlane="backend")

        assert result["swimlane"] == "backend"
        data = _read_yaml(yaml_path)
        # Ticket should remain in backlog
        paths = [str(t["path"]) for t in data["backlog"]]
        assert "tickets/backlog/t1.md" in paths

    def test_column_and_swimlane_change(self, tmp_path: Path) -> None:
        """Move ticket to new column and new swimlane simultaneously."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")

        result = move_ticket(
            yaml_path,
            "tickets/backlog/t1.md",
            root=tmp_path,
            column="review",
            swimlane="backend",
        )

        assert result["swimlane"] == "backend"
        assert result["path"] == "tickets/review/t1.md"

    def test_invalid_column_raises(self, tmp_path: Path) -> None:
        """Raise KeyError when target column is not a valid key."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")

        with pytest.raises(KeyError):
            move_ticket(yaml_path, "tickets/backlog/t1.md", root=tmp_path, column="nonexistent")

    def test_ticket_not_found(self, tmp_path: Path) -> None:
        """Raise TicketNotFound when ticket path is not in any column."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())

        with pytest.raises(TicketNotFound):
            move_ticket(yaml_path, "tickets/backlog/missing.md", root=tmp_path, column="done")

    def test_index_none_appends(self, tmp_path: Path) -> None:
        """Default behavior (index=None) appends to the target column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # No index: t1 pops from backlog and re-appends, landing after t2 -> [t2, t1].
        move_ticket(yaml_path, "tickets/backlog/t1.md", root=tmp_path)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_zero_inserts_at_top(self, tmp_path: Path) -> None:
        """index=0 inserts at the start of the target column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # backlog: [t1, t2] -> move t2 to index 0 -> [t2, t1]
        move_ticket(yaml_path, "tickets/backlog/t2.md", root=tmp_path, index=0)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_inserts_between_existing(self, tmp_path: Path) -> None:
        """index value lands between existing entries."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # backlog [t1, t2] -> in-progress [t3]; move t1 to index 1 -> in-progress [t3, t1].
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")
        move_ticket(
            yaml_path,
            "tickets/backlog/t1.md",
            root=tmp_path,
            column="in-progress",
            index=1,
        )
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["in-progress"]]
        assert paths == ["tickets/in-progress/t3.md", "tickets/in-progress/t1.md"]

    def test_index_intra_column_reorder(self, tmp_path: Path) -> None:
        """index moves a ticket within its current column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # backlog: [t1, t2] -> move t2 to index 0 (intra-column) -> [t2, t1]
        move_ticket(yaml_path, "tickets/backlog/t2.md", root=tmp_path, index=0)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_clamps_above_length(self, tmp_path: Path) -> None:
        """index larger than list length clamps to len(target_list)."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # After popping t1 backlog has 1 entry [t2]; index=999 clamps to 1 -> append.
        move_ticket(yaml_path, "tickets/backlog/t1.md", root=tmp_path, index=999)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_clamps_negative(self, tmp_path: Path) -> None:
        """Negative index clamps to 0 (avoids list.insert(-1) semantics)."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        move_ticket(yaml_path, "tickets/backlog/t2.md", root=tmp_path, index=-5)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_with_column_and_swimlane_change(self, tmp_path: Path) -> None:
        """Combining column, swimlane, and index - entry mutation occurs before insert."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")
        result = move_ticket(
            yaml_path,
            "tickets/backlog/t1.md",
            root=tmp_path,
            column="review",
            swimlane="backend",
            index=0,
        )
        assert result["swimlane"] == "backend"
        assert result["path"] == "tickets/review/t1.md"
        data = _read_yaml(yaml_path)
        assert str(data["review"][0]["path"]) == "tickets/review/t1.md"
        assert str(data["review"][0]["swimlane"]) == "backend"

    def test_index_into_empty_target_column(self, tmp_path: Path) -> None:
        """Index into an empty target column inserts at position 0."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")
        # 'done' state maps to folder 'completed/' per the test board's states.
        move_ticket(yaml_path, "tickets/backlog/t1.md", root=tmp_path, column="done", index=0)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["done"]]
        assert paths == ["tickets/completed/t1.md"]


class TestWriteYamlAtomicity:
    """A board save is all-or-nothing - a reader concurrent with it never meets a partial file."""

    def test_reader_never_meets_a_partial_file_during_repeated_saves(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        workspace_root = yaml_path.parent.parent
        unpatched = Path.write_text

        def _slow_write_text(self, content, *args, **kwargs):
            unpatched(self, content, *args, **kwargs)
            time.sleep(0.01)

        monkeypatch.setattr(Path, "write_text", _slow_write_text)

        stop = threading.Event()
        failures: list[Exception] = []

        def _read_repeatedly() -> None:
            while not stop.is_set():
                try:
                    parse_board(yaml_path, workspace_root)
                except Exception as exc:  # noqa: BLE001
                    failures.append(exc)

        reader = threading.Thread(target=_read_repeatedly)
        reader.start()

        try:
            for _ in range(20):
                _write_yaml(yaml_path, _yaml.load(yaml_path))
        finally:
            stop.set()
            reader.join(timeout=5)

        assert failures == []

    def test_save_that_raises_midway_leaves_previous_file_intact(
        self,
        tmp_path: Path,
        monkeypatch,
    ) -> None:
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        original = yaml_path.read_text()
        data = _yaml.load(yaml_path)
        data["backlog"][0]["path"] = "tickets/backlog/changed.md"

        def _boom(self, *args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(Path, "write_text", _boom)

        with pytest.raises(OSError):
            _write_yaml(yaml_path, data)

        assert yaml_path.read_text() == original
        siblings = [p.name for p in yaml_path.parent.iterdir() if p.name.startswith(yaml_path.name)]
        assert siblings == [yaml_path.name]

    def test_comments_and_key_order_survive_a_save(self, tmp_path: Path) -> None:
        yaml_path = _write_board(
            tmp_path,
            _STATES_YAML + "backlog:\n"
            "  - path: tickets/backlog/t1.md  # keep this note\n"
            "in-progress: []\n"
            "review: []\n"
            "done: []\n"
            "rejected: []\n"
            "definitely-rejected: []\n",
        )

        data = _yaml.load(yaml_path)
        data["backlog"].append({"path": "tickets/backlog/t2.md"})
        _write_yaml(yaml_path, data)

        content = yaml_path.read_text()
        assert "# keep this note" in content
        assert content.index("states:") < content.index("backlog:")


class TestFileLockTimeout:
    """Tests for lock acquisition timeout in move_ticket."""

    def test_move_ticket_raises_when_lock_is_held(self, tmp_path: Path) -> None:
        """Raise BoardLocked when board.yaml's lock is already held."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")

        holder = FileLock(str(yaml_path) + ".lock")
        holder.acquire()

        try:
            with patch("claudebox.extensions.tickets.parser.FILE_LOCK_TIMEOUT_SECONDS", 0.2):
                started = time.monotonic()

                with pytest.raises(BoardLocked) as exc_info:
                    move_ticket(
                        yaml_path,
                        "tickets/backlog/t1.md",
                        root=tmp_path,
                        column="in-progress",
                    )

                elapsed = time.monotonic() - started
        finally:
            holder.release()

        # Bounded, not blocked forever - and comfortably under the suite's own patience.
        assert elapsed < 5.0
        assert exc_info.value.context["path"] == str(yaml_path)


# --- archive_ticket ---


class TestArchiveTicket:
    """Tests for archive_ticket."""

    def test_removes_ticket(self, tmp_path: Path) -> None:
        """Remove ticket entry from board.yaml."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        archive_ticket(yaml_path, "tickets/backlog/t1.md")

        data = _read_yaml(yaml_path)
        assert len(data["backlog"]) == 0

    def test_ticket_not_found(self, tmp_path: Path) -> None:
        """Raise TicketNotFound when ticket path is not in any column."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())

        with pytest.raises(TicketNotFound):
            archive_ticket(yaml_path, "tickets/backlog/missing.md")


# --- add_swimlane ---


class TestAddSwimlane:
    """Tests for add_swimlane."""

    def test_adds_swimlane(self, tmp_path: Path) -> None:
        """Add a new swimlane to board.yaml."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        result = add_swimlane(yaml_path, "My Feature")

        assert isinstance(result, Swimlane)
        assert result.id == "my-feature"
        assert result.name == "My Feature"

        data = _read_yaml(yaml_path)
        assert len(data["swimlanes"]) == 1
        assert data["swimlanes"][0]["id"] == "my-feature"

    def test_adds_to_existing_swimlanes(self, tmp_path: Path) -> None:
        """Append swimlane when swimlanes already exist."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        add_swimlane(yaml_path, "DevOps")

        data = _read_yaml(yaml_path)
        assert len(data["swimlanes"]) == 3


# --- rename_swimlane ---


class TestRenameSwimlane:
    """Tests for rename_swimlane."""

    def test_renames_swimlane(self, tmp_path: Path) -> None:
        """Rename an existing swimlane."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        result = rename_swimlane(yaml_path, "frontend", "UI/UX")

        assert result == Swimlane(id="frontend", name="UI/UX")
        data = _read_yaml(yaml_path)
        names = [str(s["name"]) for s in data["swimlanes"]]
        assert "UI/UX" in names

    def test_not_found(self, tmp_path: Path) -> None:
        """Raise SwimlaneNotFound for unknown swimlane ID."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())

        with pytest.raises(SwimlaneNotFound):
            rename_swimlane(yaml_path, "nonexistent", "New Name")


# --- rename_state ---


class TestRenameState:
    """Tests for rename_state - display label rename, folder/id immutable."""

    def test_renames_label(self, tmp_path: Path) -> None:
        """Update the display label and persist to YAML."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        result = rename_state(yaml_path, "in-progress", "Working On")

        assert result == BoardState(
            id="in-progress",
            label="Working On",
            folder="tickets/in-progress",
            terminal=False,
            active=False,
        )
        data = _read_yaml(yaml_path)
        in_progress = next(s for s in data["states"] if str(s["id"]) == "in-progress")
        assert str(in_progress["label"]) == "Working On"

    def test_folder_and_id_unchanged(self, tmp_path: Path) -> None:
        """Folder and id stay intact - only the display label changes."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        rename_state(yaml_path, "backlog", "To Do")

        data = _read_yaml(yaml_path)
        backlog = next(s for s in data["states"] if str(s["id"]) == "backlog")
        assert str(backlog["id"]) == "backlog"
        assert str(backlog["folder"]) == "tickets/backlog/"

    def test_strips_whitespace(self, tmp_path: Path) -> None:
        """Trim surrounding whitespace before saving."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        rename_state(yaml_path, "review", "  Code Review  ")

        data = _read_yaml(yaml_path)
        review = next(s for s in data["states"] if str(s["id"]) == "review")
        assert str(review["label"]) == "Code Review"

    def test_empty_label_raises(self, tmp_path: Path) -> None:
        """Reject empty/whitespace labels with InvalidLabel."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())

        with pytest.raises(InvalidLabel):
            rename_state(yaml_path, "backlog", "   ")

    def test_unknown_state_raises(self, tmp_path: Path) -> None:
        """Raise StateNotFound for unknown state ID."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())

        with pytest.raises(StateNotFound):
            rename_state(yaml_path, "nonexistent", "New")


# --- delete_swimlane ---


class TestDeleteSwimlane:
    """Tests for delete_swimlane."""

    def test_deletes_swimlane(self, tmp_path: Path) -> None:
        """Delete a swimlane and clear references on tickets."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        delete_swimlane(yaml_path, "frontend")

        data = _read_yaml(yaml_path)
        ids = [str(s["id"]) for s in data["swimlanes"]]
        assert "frontend" not in ids

        # Tickets that had swimlane=frontend should have it cleared
        for ticket in data["backlog"]:
            if str(ticket["path"]) == "tickets/backlog/t1.md":
                assert "swimlane" not in ticket

    def test_not_found(self, tmp_path: Path) -> None:
        """Raise SwimlaneNotFound for unknown swimlane ID."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())

        with pytest.raises(SwimlaneNotFound):
            delete_swimlane(yaml_path, "nonexistent")


# --- reorder_swimlanes ---


class TestReorderSwimlanes:
    """Tests for reorder_swimlanes."""

    def test_reverses_order(self, tmp_path: Path) -> None:
        """Reorder swimlanes in reverse."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        result = reorder_swimlanes(yaml_path, ["backend", "frontend"])

        assert result == [
            Swimlane(id="backend", name="Backend"),
            Swimlane(id="frontend", name="Frontend"),
        ]
        data = _read_yaml(yaml_path)
        assert str(data["swimlanes"][0]["id"]) == "backend"

    def test_subset_drops_missing(self, tmp_path: Path) -> None:
        """Reorder with a subset of IDs drops unlisted swimlanes."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        result = reorder_swimlanes(yaml_path, ["frontend"])

        assert len(result) == 1
        assert result[0].id == "frontend"


# --- _resolve_title ---


class TestResolveTitle:
    """Tests for _resolve_title."""

    def test_h1_heading(self, tmp_path: Path) -> None:
        """Extract title from first h1 heading."""
        md = tmp_path / "ticket.md"
        md.write_text("# My Great Ticket\n\nSome body text.\n")
        assert _resolve_title(md) == "My Great Ticket"

    def test_h1_with_leading_blank_lines(self, tmp_path: Path) -> None:
        """Extract h1 even if preceded by blank lines."""
        md = tmp_path / "ticket.md"
        md.write_text("\n\n# Heading After Blanks\n")
        assert _resolve_title(md) == "Heading After Blanks"

    def test_fallback_to_filename(self, tmp_path: Path) -> None:
        """Fall back to deslugified filename when no h1 exists."""
        md = tmp_path / "my-cool-ticket.md"
        md.write_text("No heading here, just text.\n")
        assert _resolve_title(md) == "my cool ticket"

    def test_nonexistent_file(self, tmp_path: Path) -> None:
        """Return None for a file that does not exist."""
        assert _resolve_title(tmp_path / "nope.md") is None

    @pytest.mark.parametrize(
        "filename,expected",
        [
            ("hello-world.md", "hello world"),
            ("use_underscore.md", "use underscore"),
        ],
    )
    def test_filename_deslugify(self, tmp_path: Path, filename: str, expected: str) -> None:
        """Deslugify filename with hyphens and underscores."""
        md = tmp_path / filename
        md.write_text("No heading.\n")
        assert _resolve_title(md) == expected


# --- assign_ticket ---


class TestAssignTicket:
    """Tests for assign_ticket."""

    def test_assigns_session(self, tmp_path: Path) -> None:
        """Set session ID on a ticket entry."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        assign_ticket(yaml_path, "tickets/backlog/t1.md", "sess-42")

        data = _read_yaml(yaml_path)
        ticket = next(t for t in data["backlog"] if str(t["path"]) == "tickets/backlog/t1.md")
        assert ticket["session"] == "sess-42"

    def test_ticket_not_found(self, tmp_path: Path) -> None:
        """Raise TicketNotFound when ticket path is not in any column."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())

        with pytest.raises(TicketNotFound):
            assign_ticket(yaml_path, "tickets/backlog/missing.md", "sess-1")


# --- rename_board ---


class TestRenameBoard:
    """Tests for rename_board."""

    def test_renames_board(self, tmp_path: Path) -> None:
        """Set the top-level name field."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        result = rename_board(yaml_path, "New Board Name")

        assert result == "New Board Name"
        data = _read_yaml(yaml_path)
        assert str(data["name"]) == "New Board Name"


# --- reorder_states ---


class TestReorderStates:
    """Tests for reorder_states."""

    def test_reverses_order(self, tmp_path: Path) -> None:
        """Reorder states in reverse order."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        original_ids = [
            "backlog",
            "in-progress",
            "review",
            "done",
            "rejected",
            "definitely-rejected",
        ]
        reversed_ids = list(reversed(original_ids))

        result = reorder_states(yaml_path, reversed_ids)

        assert [s.id for s in result] == reversed_ids
        data = _read_yaml(yaml_path)
        assert [str(s["id"]) for s in data["states"]] == reversed_ids

    def test_subset_drops_missing(self, tmp_path: Path) -> None:
        """Reorder with a subset of IDs drops unlisted states."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())
        result = reorder_states(yaml_path, ["done", "backlog"])

        assert len(result) == 2
        assert result[0].id == "done"
        assert result[1].id == "backlog"


# --- _parse_states ---


class TestParseStates:
    """Tests for _parse_states edge cases."""

    def test_duplicate_state_id_raises(self, tmp_path: Path) -> None:
        """Raise BoardParseError on duplicate state IDs."""
        content = (
            "states:\n"
            "  - id: backlog\n"
            "    label: Backlog\n"
            "    folder: tickets/backlog/\n"
            "  - id: backlog\n"
            "    label: Backlog Again\n"
            "    folder: backlog2/\n"
            "backlog: []\n"
        )
        yaml_path = _write_board(tmp_path, content)

        with pytest.raises(BoardParseError):
            parse_board(yaml_path, tmp_path / "project")


# --- board_summary with name field ---


class TestBoardSummaryWithName:
    """Tests for board_summary when YAML has a name field."""

    def test_reads_name_from_yaml(self, tmp_path: Path) -> None:
        """Use name field from YAML instead of directory name."""
        yaml_path = _write_board(tmp_path, "name: My Project Board\n" + _STATES_YAML)
        result = board_summary(yaml_path, tmp_path)
        assert result.name == "My Project Board"


class TestMoveTicketConfinement:
    """A ticket move stays inside the workspace and never overwrites another file."""

    @staticmethod
    def _board(tmp_path: Path, *, done_folder: str = "t/done", ticket: str = "t/todo/x.md") -> Path:
        workspace = tmp_path / "ws"
        (workspace / "t" / "todo").mkdir(parents=True)
        (workspace / "t" / "todo" / "x.md").write_text("a")
        yaml_path = workspace / "board.yaml"
        yaml_path.write_text(
            "states:\n"
            "  - id: todo\n"
            "    label: Todo\n"
            "    folder: t/todo\n"
            "  - id: done\n"
            "    label: Done\n"
            f"    folder: {done_folder}\n"
            "todo:\n"
            f"  - path: {ticket}\n"
            "done: []\n",
        )

        return yaml_path

    def test_a_same_name_destination_is_refused_and_nothing_changes(self, tmp_path):
        yaml_path = self._board(tmp_path)
        workspace = yaml_path.parent
        (workspace / "t" / "done").mkdir()
        (workspace / "t" / "done" / "x.md").write_text("b")
        board_before = yaml_path.read_bytes()

        with pytest.raises(TicketMoveRefused) as excinfo:
            move_ticket(yaml_path, "t/todo/x.md", root=workspace, column="done")

        assert excinfo.value.context["reason"] == "destination_exists"
        assert (workspace / "t" / "todo" / "x.md").read_text() == "a"
        assert (workspace / "t" / "done" / "x.md").read_text() == "b"
        assert yaml_path.read_bytes() == board_before

    def test_a_folder_climbing_out_of_the_workspace_is_refused(self, tmp_path):
        yaml_path = self._board(tmp_path, done_folder="../outside")
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "x.md").write_text("sentinel")

        with pytest.raises(TicketMoveRefused) as excinfo:
            move_ticket(yaml_path, "t/todo/x.md", root=yaml_path.parent, column="done")

        assert excinfo.value.context["reason"] == "outside_workspace"
        assert (outside / "x.md").read_text() == "sentinel"
        assert (yaml_path.parent / "t" / "todo" / "x.md").read_text() == "a"

    def test_a_ticket_path_climbing_out_is_refused(self, tmp_path):
        outside = tmp_path / "todo"
        outside.mkdir()
        (outside / "secret.md").write_text("host file")
        yaml_path = self._board(tmp_path, ticket="../todo/secret.md")

        with pytest.raises(TicketMoveRefused):
            move_ticket(yaml_path, "../todo/secret.md", root=yaml_path.parent, column="done")

        assert (outside / "secret.md").read_text() == "host file"
        assert not (tmp_path / "done").exists()

    def test_a_normal_move_lands_the_file_and_updates_the_entry(self, tmp_path):
        yaml_path = self._board(tmp_path)
        workspace = yaml_path.parent

        entry = move_ticket(yaml_path, "t/todo/x.md", root=workspace, column="done")

        assert entry["path"] == "t/done/x.md"
        assert (workspace / "t" / "done" / "x.md").read_text() == "a"
        assert not (workspace / "t" / "todo" / "x.md").exists()


class TestMoveTicketFolders:
    """A column change moves the file only between states keeping tickets in different folders."""

    @staticmethod
    def _board(tmp_path: Path, open_folder: str, done_folder: str, ticket: str) -> Path:
        (tmp_path / ticket).parent.mkdir(parents=True)
        (tmp_path / ticket).write_text("# T1\n")
        yaml_path = tmp_path / "board.yaml"
        yaml_path.write_text(
            "states:\n"
            + "".join(
                f"  - id: {state}\n    label: {state}\n    folder: {open_folder}\n"
                for state in ("backlog", "in-progress", "review")
            )
            + f"  - id: done\n    label: Done\n    folder: {done_folder}\n    terminal: true\n"
            + f"backlog:\n  - path: {ticket}\n"
            + "in-progress: []\nreview: []\ndone: []\n",
        )

        return yaml_path

    def test_a_move_between_open_columns_sharing_a_folder_moves_only_the_card(self, tmp_path):
        yaml_path = self._board(
            tmp_path,
            "tickets/active/",
            "tickets/completed/",
            "tickets/active/t1.md",
        )

        entry = move_ticket(yaml_path, "tickets/active/t1.md", root=tmp_path, column="in-progress")

        assert entry["path"] == "tickets/active/t1.md"
        assert (tmp_path / "tickets" / "active" / "t1.md").read_text() == "# T1\n"
        assert _read_yaml(yaml_path)["backlog"] == []
        assert [str(t["path"]) for t in _read_yaml(yaml_path)["in-progress"]] == [
            "tickets/active/t1.md",
        ]

    @pytest.mark.parametrize(
        "spelling",
        ["tickets/active", "./tickets/active/", "tickets//active/", "tickets/./active"],
        ids=["no-trailing-slash", "leading-dot", "doubled-slash", "inner-dot"],
    )
    def test_two_spellings_of_one_directory_are_one_folder(self, tmp_path, spelling):
        yaml_path = self._board(
            tmp_path,
            "tickets/active/",
            "tickets/completed/",
            "tickets/active/t1.md",
        )
        yaml_path.write_text(
            yaml_path.read_text().replace(
                "folder: tickets/active/\n",
                f"folder: {spelling}\n",
                1,
            ),
        )

        entry = move_ticket(yaml_path, "tickets/active/t1.md", root=tmp_path, column="in-progress")

        assert entry["path"] == "tickets/active/t1.md"
        assert (tmp_path / "tickets" / "active" / "t1.md").read_text() == "# T1\n"

    @pytest.mark.parametrize(
        ("open_folder", "done_folder", "ticket", "moved_to"),
        [
            (
                "tickets/active/",
                "tickets/completed/",
                "tickets/active/t1.md",
                "tickets/completed/t1.md",
            ),
            (
                "./tickets/active/",
                "tickets//completed",
                "tickets/active/t1.md",
                "tickets/completed/t1.md",
            ),
            ("active", "completed", "active/t1.md", "completed/t1.md"),
            (
                "active/",
                "completed/",
                "active/drafts/active/t1.md",
                "completed/drafts/active/t1.md",
            ),
        ],
        ids=[
            "shared-open-folder",
            "spelled-differently",
            "beside-the-board",
            "kept-below-the-folder",
        ],
    )
    def test_a_move_to_a_closing_column_moves_the_file_to_its_folder(
        self,
        tmp_path,
        open_folder,
        done_folder,
        ticket,
        moved_to,
    ):
        yaml_path = self._board(tmp_path, open_folder, done_folder, ticket)

        entry = move_ticket(yaml_path, ticket, root=tmp_path, column="done")

        assert entry["path"] == moved_to
        assert (tmp_path / moved_to).read_text() == "# T1\n"
        assert not (tmp_path / ticket).exists()
        assert [str(t["path"]) for t in _read_yaml(yaml_path)["done"]] == [moved_to]

    @pytest.mark.parametrize(
        "ticket",
        ["tickets/inactive/t1.md", "tickets/elsewhere/t1.md", "tickets/active"],
        ids=["folder-only-as-a-substring", "another-folder", "the-folder-itself"],
    )
    def test_a_file_outside_its_columns_folder_is_refused_and_nothing_changes(
        self,
        tmp_path,
        ticket,
    ):
        yaml_path = self._board(tmp_path, "tickets/active/", "tickets/completed/", ticket)
        board_before = yaml_path.read_bytes()

        with pytest.raises(TicketMoveRefused) as excinfo:
            move_ticket(yaml_path, ticket, root=tmp_path, column="done")

        assert excinfo.value.context["reason"] == "not_in_column_folder"
        assert (tmp_path / ticket).read_text() == "# T1\n"
        assert yaml_path.read_bytes() == board_before

    @pytest.mark.parametrize(
        "done_folder",
        ["completed/", "tickets/completed/"],
        ids=["bare-board", "mixed-board"],
    )
    def test_a_bare_folder_names_the_boards_own_subdirectory(self, tmp_path, done_folder):
        yaml_path = self._board(tmp_path, "active/", done_folder, "tickets/active/t1.md")
        board_before = yaml_path.read_bytes()

        with pytest.raises(TicketMoveRefused) as excinfo:
            move_ticket(yaml_path, "tickets/active/t1.md", root=tmp_path, column="done")

        assert excinfo.value.context["reason"] == "not_in_column_folder"
        assert (tmp_path / "tickets" / "active" / "t1.md").read_text() == "# T1\n"
        assert not (tmp_path / "tickets" / "tickets").exists()
        assert yaml_path.read_bytes() == board_before
