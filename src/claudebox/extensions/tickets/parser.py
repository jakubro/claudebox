"""Board YAML parser - read/write board.yaml with comment preservation."""

import contextlib
import re
import shutil
from collections.abc import Iterator
from pathlib import Path

from filelock import FileLock, Timeout
from ruamel.yaml import YAML

from .errors import (
    BoardLocked,
    BoardParseError,
    InvalidLabel,
    StateNotFound,
    SwimlaneNotFound,
    TicketNotFound,
)
from .models import Board, BoardState, BoardSummary, BoardTicket, Swimlane
from ...constants import FILE_LOCK_TIMEOUT_SECONDS
from ...core.logging import get_logger


logger = get_logger(__name__)

_yaml = YAML()
_yaml.preserve_quotes = True
_yaml.default_flow_style = False


def board_id_from_path(yaml_path: Path, workspace_root: Path) -> str:
    """Derive board ID from board.yaml path relative to workspace root.

    Slugifies the relative directory path: ``docs/tickets/board.yaml`` -> ``docs-tickets``.
    """

    rel = yaml_path.parent.relative_to(workspace_root)

    return str(rel).replace("/", "-") if str(rel) != "." else "root"


def board_name_from_path(yaml_path: Path) -> str:
    """Derive display name from the directory containing board.yaml."""

    return yaml_path.parent.name or "root"


def parse_board(yaml_path: Path, workspace_root: Path) -> Board:
    """Parse a board.yaml file into a Board model, resolving ticket titles from disk."""

    try:
        data = _yaml.load(yaml_path)
    except Exception as exc:
        raise BoardParseError(path=str(yaml_path), reason=str(exc)) from exc

    if not isinstance(data, dict):
        raise BoardParseError(path=str(yaml_path), reason="Expected YAML mapping at root")

    bid = board_id_from_path(yaml_path, workspace_root)
    name = str(data["name"]) if data.get("name") else board_name_from_path(yaml_path)

    prompt = dict(data.get("prompt") or {})
    states = _parse_states(data, yaml_path)

    swimlanes = [_swimlane_from_entry(entry) for entry in data.get("swimlanes") or []]

    columns: dict[str, list[BoardTicket]] = {}

    for state in states:
        tickets = []

        for entry in data.get(state.id) or []:
            path = str(entry["path"])
            title = _resolve_title(yaml_path.parent / path)
            tickets.append(
                BoardTicket(
                    path=path,
                    swimlane=entry.get("swimlane"),
                    session=entry.get("session"),
                    title=title,
                ),
            )

        columns[state.id] = tickets

    return Board(
        id=bid,
        name=name,
        yaml_path=str(yaml_path),
        prompt=prompt,
        states=states,
        swimlanes=swimlanes,
        columns=columns,
    )


def board_summary(yaml_path: Path, workspace_root: Path) -> BoardSummary:
    """Create a lightweight board summary without parsing ticket contents."""

    name = _read_name_field(yaml_path) or board_name_from_path(yaml_path)

    return BoardSummary(
        id=board_id_from_path(yaml_path, workspace_root),
        name=name,
        path=str(yaml_path.relative_to(workspace_root)),
    )


def move_ticket(
    yaml_path: Path,
    ticket_path: str,
    *,
    column: str | None = None,
    swimlane: str | None = None,
    index: int | None = None,
) -> dict:
    """Move a ticket between columns and/or swimlanes, optionally at a given index.

    Updates board.yaml atomically under a file lock. Changing ``column`` also relocates the
    ticket file; ``index`` is clamped to ``[0, len(target_list)]``.
    """

    board_dir = yaml_path.parent

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)
        col_keys = _column_keys(data)
        folders = _folder_map(data)

        source_col = None
        entry = None

        for col_key in col_keys:
            items = data.get(col_key) or []

            for i, item in enumerate(items):
                if str(item["path"]) == ticket_path:
                    source_col = col_key
                    entry = items.pop(i)
                    break

            if entry is not None:
                break

        if entry is None:
            raise TicketNotFound(ticket_path=ticket_path)

        target_col = column or source_col

        if swimlane is not None:
            entry["swimlane"] = swimlane

        if column and source_col and column != source_col:
            old_abs = board_dir / ticket_path

            if old_abs.exists():
                new_dir_name = folders[column]
                old_dir_name = folders[source_col]
                new_path = ticket_path.replace(f"/{old_dir_name}/", f"/{new_dir_name}/", 1)

                new_abs = board_dir / new_path
                new_abs.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(old_abs), str(new_abs))

                entry["path"] = new_path

        if data.get(target_col) is None:
            data[target_col] = []

        target_list = data[target_col]

        if index is None:
            target_list.append(entry)
        else:
            # Clamp explicitly: list.insert(-1, ...) lands before the last element, not at the end.
            clamped = max(0, min(int(index), len(target_list)))
            target_list.insert(clamped, entry)

        _write_yaml(yaml_path, data)

    return dict(entry)


def archive_ticket(yaml_path: Path, ticket_path: str) -> None:
    """Remove a ticket entry from board.yaml. File stays on disk."""

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        for col_key in _column_keys(data):
            items = data.get(col_key) or []

            for i, item in enumerate(items):
                if str(item["path"]) == ticket_path:
                    items.pop(i)
                    _write_yaml(yaml_path, data)

                    return

        raise TicketNotFound(ticket_path=ticket_path)


def assign_ticket(yaml_path: Path, ticket_path: str, session_id: str) -> None:
    """Set the session ID on a ticket entry in board.yaml."""

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        for col_key in _column_keys(data):
            items = data.get(col_key) or []

            for item in items:
                if str(item["path"]) == ticket_path:
                    item["session"] = session_id
                    _write_yaml(yaml_path, data)

                    return

        raise TicketNotFound(ticket_path=ticket_path)


def add_swimlane(yaml_path: Path, name: str) -> Swimlane:
    """Add a new swimlane to board.yaml."""

    sid = _slugify(name)

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        if data.get("swimlanes") is None:
            data["swimlanes"] = []

        data["swimlanes"].append({"id": sid, "name": name})
        _write_yaml(yaml_path, data)

    return Swimlane(id=sid, name=name)


def rename_swimlane(yaml_path: Path, swimlane_id: str, name: str) -> Swimlane:
    """Rename a swimlane in board.yaml."""

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        for entry in data.get("swimlanes") or []:
            if str(entry["id"]) == swimlane_id:
                entry["name"] = name
                _write_yaml(yaml_path, data)

                return Swimlane(id=swimlane_id, name=name)

        raise SwimlaneNotFound(swimlane_id=swimlane_id)


def rename_state(yaml_path: Path, state_id: str, label: str) -> BoardState:
    """Rename a state's display label in board.yaml. Folder name unchanged."""

    label = label.strip()

    if not label:
        raise InvalidLabel(state_id=state_id)

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        for entry in data.get("states") or []:
            if str(entry["id"]) == state_id:
                entry["label"] = label
                _write_yaml(yaml_path, data)

                return _state_from_entry(entry)

        raise StateNotFound(state_id=state_id)


def delete_swimlane(yaml_path: Path, swimlane_id: str) -> None:
    """Delete a swimlane from board.yaml. Tickets in it become unsorted."""

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        lanes = data.get("swimlanes") or []
        found = False

        for i, entry in enumerate(lanes):
            if str(entry["id"]) == swimlane_id:
                lanes.pop(i)
                found = True
                break

        if not found:
            raise SwimlaneNotFound(swimlane_id=swimlane_id)

        for col_key in _column_keys(data):
            for item in data.get(col_key) or []:
                if item.get("swimlane") == swimlane_id:
                    del item["swimlane"]

        _write_yaml(yaml_path, data)


def rename_board(yaml_path: Path, name: str) -> str:
    """Set the top-level ``name:`` field in board.yaml. Returns the new name."""

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)
        data["name"] = name
        _write_yaml(yaml_path, data)

    return name


def reorder_states(yaml_path: Path, keys: list[str]) -> list[BoardState]:
    """Reorder states in board.yaml to match the given key order."""

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        raw = data.get("states") or []
        by_id = {str(entry["id"]): entry for entry in raw}

        reordered = []

        for key in keys:
            if key in by_id:
                reordered.append(by_id[key])

        data["states"] = reordered
        _write_yaml(yaml_path, data)

    return _parse_states(data)


def reorder_swimlanes(yaml_path: Path, ids: list[str]) -> list[Swimlane]:
    """Reorder swimlanes in board.yaml to match the given ID order."""

    with _locked(yaml_path):
        data = _yaml.load(yaml_path)

        lanes = data.get("swimlanes") or []
        by_id = {str(entry["id"]): entry for entry in lanes}

        reordered = []

        for sid in ids:
            if sid in by_id:
                reordered.append(by_id[sid])

        data["swimlanes"] = reordered
        _write_yaml(yaml_path, data)

    return [_swimlane_from_entry(entry) for entry in reordered]


# States
# -------------------------------------------------------------------------------------------------


def _parse_states(data: dict, yaml_path: Path | None = None) -> list[BoardState]:
    """Parse states: section from raw YAML data."""

    raw = data.get("states")

    if not raw or not isinstance(raw, list):
        path_info = f" in {yaml_path}" if yaml_path else ""

        raise BoardParseError(
            path=str(yaml_path or ""),
            reason=f"Missing or invalid 'states:' list{path_info}",
        )

    seen_ids: set[str] = set()
    states = []

    for entry in raw:
        sid = str(entry["id"])

        if sid in seen_ids:
            raise BoardParseError(
                path=str(yaml_path or ""),
                reason=f"Duplicate state id: {sid}",
            )

        seen_ids.add(sid)
        states.append(_state_from_entry(entry))

    return states


def _state_from_entry(entry: dict) -> BoardState:
    """Build a BoardState from a raw YAML state entry."""

    return BoardState(
        id=str(entry["id"]),
        label=str(entry["label"]),
        folder=str(entry["folder"]).rstrip("/"),
        terminal=bool(entry.get("terminal", False)),
        active=bool(entry.get("active", False)),
    )


def _swimlane_from_entry(entry: dict) -> Swimlane:
    """Build a Swimlane from a raw YAML swimlane entry."""

    return Swimlane(id=str(entry["id"]), name=str(entry["name"]))


def _column_keys(data: dict) -> list[str]:
    """Extract ordered column keys from states: in raw YAML data."""

    return [str(entry["id"]) for entry in (data.get("states") or [])]


def _folder_map(data: dict) -> dict[str, str]:
    """Build {state_id: folder_name} from states: in raw YAML data."""

    return {str(e["id"]): str(e["folder"]).rstrip("/") for e in (data.get("states") or [])}


# Internal
# -------------------------------------------------------------------------------------------------


@contextlib.contextmanager
def _locked(yaml_path: Path) -> Iterator[None]:
    """Acquire board.yaml's lock within FILE_LOCK_TIMEOUT_SECONDS, else raise BoardLocked."""

    lock = FileLock(str(yaml_path) + ".lock", timeout=FILE_LOCK_TIMEOUT_SECONDS)

    try:
        with lock:
            yield
    except Timeout as exc:
        raise BoardLocked(path=str(yaml_path)) from exc


def _read_name_field(yaml_path: Path) -> str | None:
    """Extract the top-level ``name:`` field from a board YAML without full parse."""

    try:
        data = _yaml.load(yaml_path)

        if isinstance(data, dict) and data.get("name"):
            return str(data["name"])
    except Exception as exc:  # noqa: BLE001
        # Best-effort peek - a malformed board.yaml falls back to the directory name below.
        logger.debug("board_name_field_read_failed", path=str(yaml_path), error=str(exc))

    return None


def _write_yaml(yaml_path: Path, data: dict) -> None:
    """Write YAML data to file, preserving comments and formatting."""

    with open(yaml_path, "w") as f:
        _yaml.dump(data, f)


def _resolve_title(ticket_path: Path) -> str | None:
    """Extract a ticket's title: first ``# `` heading, else the deslugified filename."""

    if not ticket_path.exists():
        return None

    try:
        with open(ticket_path) as f:
            for line in f:
                match = re.match(r"^#\s+(.+)", line.strip())

                if match:
                    return match.group(1)
    except OSError:
        pass

    stem = ticket_path.stem

    return stem.replace("-", " ").replace("_", " ")


def _slugify(name: str) -> str:
    """Convert a name to a URL-safe slug."""

    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)

    return slug.strip("-")
