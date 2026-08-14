"""Ticket domain data models - board, ticket, and swimlane representations."""

from dataclasses import dataclass, field

from ...core.structures import DataClass


@dataclass
class BoardState(DataClass):
    """Single column/state definition parsed from board.yaml.

    `id` doubles as the YAML key and the API field. `terminal` makes the column collapsible with
    an archive action; `active` auto-moves assigned tickets into this state. Both default false.
    """

    id: str
    label: str
    folder: str
    terminal: bool = False
    active: bool = False


@dataclass
class Swimlane(DataClass):
    """Swimlane definition within a board; `id` is slugified from `name`."""

    id: str
    name: str


@dataclass
class BoardTicket(DataClass):
    """Ticket entry within a board column.

    `path` is relative to workspace root. `swimlane` is None when unsorted. `title` resolves from
    a markdown heading, falling back to the filename.
    """

    path: str
    swimlane: str | None = None
    session: str | None = None
    title: str | None = None


@dataclass
class Board(DataClass):
    """Parsed board state from a board.yaml file.

    `id`/`name` derive from the board.yaml path and its containing directory; `yaml_path` is
    absolute. `prompt` configures session-assignment order; `columns` maps state id to its
    ticket list.
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
    """Lightweight board reference for listing; `path` is relative to workspace root."""

    id: str
    name: str
    path: str
