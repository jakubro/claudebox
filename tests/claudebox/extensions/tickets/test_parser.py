"""Tests for board YAML parser."""

from pathlib import Path

import pytest
from ruamel.yaml import YAML

from claudebox.extensions.tickets.errors import (
    BoardParseError,
    InvalidLabel,
    StateNotFound,
    SwimlaneNotFound,
    TicketNotFound,
)
from claudebox.extensions.tickets.models import Board, BoardState, BoardSummary, Swimlane
from claudebox.extensions.tickets.parser import (
    _resolve_title,
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
    "    folder: backlog/\n"
    "  - id: in-progress\n"
    "    label: In Progress\n"
    "    folder: in-progress/\n"
    "  - id: review\n"
    "    label: Review\n"
    "    folder: review/\n"
    "  - id: done\n"
    "    label: Done\n"
    "    folder: completed/\n"
    "    terminal: true\n"
    "  - id: rejected\n"
    "    label: Rejected\n"
    "    folder: rejected/\n"
    "    terminal: true\n"
    "  - id: definitely-rejected\n"
    "    label: Definitely Rejected\n"
    "    folder: definitely-rejected/\n"
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
        # Ticket file at yaml_path.parent / path (board-file-relative)
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
        # Create the ticket file relative to board.yaml parent
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")

        result = move_ticket(yaml_path, "tickets/backlog/t1.md", column="in-progress")

        assert result["path"] == "tickets/in-progress/t1.md"
        data = _read_yaml(yaml_path)
        assert len(data["backlog"]) == 0
        assert len(data["in-progress"]) == 1

    def test_swimlane_change(self, tmp_path: Path) -> None:
        """Change ticket swimlane without changing column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        result = move_ticket(yaml_path, "tickets/backlog/t1.md", swimlane="backend")

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
            move_ticket(yaml_path, "tickets/backlog/t1.md", column="nonexistent")

    def test_ticket_not_found(self, tmp_path: Path) -> None:
        """Raise TicketNotFound when ticket path is not in any column."""
        yaml_path = _write_board(tmp_path, _minimal_board_yaml())

        with pytest.raises(TicketNotFound):
            move_ticket(yaml_path, "tickets/backlog/missing.md", column="done")

    def test_index_none_appends(self, tmp_path: Path) -> None:
        """Default behavior (index=None) appends to the target column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # backlog: t1 (frontend), t2 (backend) -> move t1 within backlog with no index
        # should land at the end (append). Source pop + append -> [t2, t1].
        move_ticket(yaml_path, "tickets/backlog/t1.md")
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_zero_inserts_at_top(self, tmp_path: Path) -> None:
        """index=0 inserts at the start of the target column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # backlog: [t1, t2] -> move t2 to index 0 -> [t2, t1]
        move_ticket(yaml_path, "tickets/backlog/t2.md", index=0)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_inserts_between_existing(self, tmp_path: Path) -> None:
        """index value lands between existing entries."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # Source list: backlog has [t1, t2]; target list: in-progress has [t3].
        # Move t1 to in-progress at index 1 -> in-progress becomes [t3, t1].
        ticket_file = yaml_path.parent / "tickets" / "backlog" / "t1.md"
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        ticket_file.write_text("# T1\n")
        move_ticket(yaml_path, "tickets/backlog/t1.md", column="in-progress", index=1)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["in-progress"]]
        assert paths == ["tickets/in-progress/t3.md", "tickets/in-progress/t1.md"]

    def test_index_intra_column_reorder(self, tmp_path: Path) -> None:
        """index moves a ticket within its current column."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # backlog: [t1, t2] -> move t2 to index 0 (intra-column) -> [t2, t1]
        move_ticket(yaml_path, "tickets/backlog/t2.md", index=0)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_clamps_above_length(self, tmp_path: Path) -> None:
        """index larger than list length clamps to len(target_list)."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        # After popping t1 backlog has 1 entry [t2]; index=999 clamps to 1 -> append.
        move_ticket(yaml_path, "tickets/backlog/t1.md", index=999)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["backlog"]]
        assert paths == ["tickets/backlog/t2.md", "tickets/backlog/t1.md"]

    def test_index_clamps_negative(self, tmp_path: Path) -> None:
        """Negative index clamps to 0 (avoids list.insert(-1) semantics)."""
        yaml_path = _write_board(tmp_path, _full_board_yaml())
        move_ticket(yaml_path, "tickets/backlog/t2.md", index=-5)
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
        move_ticket(yaml_path, "tickets/backlog/t1.md", column="done", index=0)
        data = _read_yaml(yaml_path)
        paths = [str(t["path"]) for t in data["done"]]
        assert paths == ["tickets/completed/t1.md"]


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
            folder="in-progress",
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
        assert str(backlog["folder"]) == "backlog/"

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
            "    folder: backlog/\n"
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
