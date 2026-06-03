"""Ticket domain data models — board, ticket, and swimlane representations."""

from dataclasses import dataclass, field

from ...core.structures import DataClass


@dataclass
class BoardState(DataClass):
    """Single column/state definition parsed from board.yaml.

    Attributes:
        id: Unique state identifier used as YAML key and API field (e.g. 'in-progress').
        label: Human-readable display name (e.g. 'In Progress').
        folder: Filesystem directory name for tickets in this state (e.g. 'in-progress').
        terminal: If true, column is collapsible and shows archive action. Default false.
        active: If true, tickets are auto-moved to this state on assign. Default false.
    """

    id: str
    label: str
    folder: str
    terminal: bool = False
    active: bool = False


@dataclass
class Swimlane(DataClass):
    """Swimlane definition within a board.

    Attributes:
        id: Unique identifier (slugified from name).
        name: Display name.
    """

    id: str
    name: str


@dataclass
class BoardTicket(DataClass):
    """Ticket entry within a board column.

    Attributes:
        path: Ticket file path relative to workspace root.
        swimlane: Swimlane ID this ticket belongs to, or None for unsorted.
        session: Session ID assigned to this ticket, or None.
        title: Resolved title from markdown heading or filename.
    """

    path: str
    swimlane: str | None = None
    session: str | None = None
    title: str | None = None


@dataclass
class Board(DataClass):
    """Parsed board state from a board.yaml file.

    Attributes:
        id: Board identifier derived from board.yaml path.
        name: Display name derived from containing directory.
        yaml_path: Absolute path to the board.yaml file.
        prompt: Prompt sequence configuration for session assignment.
        states: Ordered list of column/state definitions.
        swimlanes: Ordered list of swimlane definitions.
        columns: Mapping of column name to ticket list.
    """

    id: str
    name: str
    yaml_path: str
    prompt: dict = field(default_factory=dict)
    states: list[BoardState] = field(default_factory=list)
    swimlanes: list[Swimlane] = field(default_factory=list)
    columns: dict[str, list[BoardTicket]] = field(default_factory=dict)


@dataclass
class BoardSummary(DataClass):
    """Lightweight board reference for listing.

    Attributes:
        id: Board identifier.
        name: Display name.
        path: Path to board.yaml relative to workspace root.
    """

    id: str
    name: str
    path: str
