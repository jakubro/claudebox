"""Board YAML parser - read/write board.yaml with comment preservation."""

from __future__ import annotations

import contextlib
import io
import os
import re
import shutil
from collections.abc import Generator
from pathlib import Path

from filelock import FileLock, Timeout
from ruamel.yaml import YAML

from .errors import (
    BoardLocked,
    BoardParseError,
    InvalidLabel,
    StateNotFound,
    SwimlaneNotFound,
    TicketMoveRefused,
    TicketNotFound,
)
from .models import Board, BoardState, BoardSummary, BoardTicket, Swimlane
from ...constants import FILE_LOCK_TIMEOUT_SECONDS
from ...core.io import write_text
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
    root: Path,
    column: str | None = None,
    swimlane: str | None = None,
    index: int | None = None,
) -> dict:
    """Move a ticket between columns and/or swimlanes, optionally at a given index.

    A ``column`` change moves the file only between states whose folders - paths under the board's
    directory, however written - name different directories, keeping its path below them.
    It is refused before board.yaml changes for a file outside its folder, a path leaving ``root``
    or a taken destination; ``index`` is clamped to the target list.
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

        if column and source_col and column != source_col and (board_dir / ticket_path).exists():
            new_path = _move_file(
                board_dir,
                ticket_path,
                folders[source_col],
                folders[column],
                root,
            )

            if new_path != ticket_path:
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
        terminal=bool(entry.get("terminal")),
        active=bool(entry.get("active")),
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
def _locked(yaml_path: Path) -> Generator[None]:
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
    """Write YAML data to file, preserving comments and formatting - dumps to a string first,
    then hands it to the shared atomic writer, since ruamel has no temp-file-and-rename mode of its own.
    """

    buffer = io.StringIO()
    _yaml.dump(data, buffer)
    write_text(yaml_path, buffer.getvalue())


def _resolve_title(ticket_path: Path) -> str | None:
    """Extract a ticket's title: first ``# `` heading, else the deslugified filename."""

    if not ticket_path.exists():
        return None

    try:
        with open(ticket_path, encoding="utf-8") as f:
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


def _move_file(
    board_dir: Path,
    ticket_path: str,
    old_folder: str,
    new_folder: str,
    root: Path,
) -> str:
    old_dir, new_dir = _normalized(board_dir, old_folder), _normalized(board_dir, new_folder)

    if old_dir == new_dir:
        return ticket_path

    old_abs = _normalized(board_dir, ticket_path)

    if old_dir not in old_abs.parents:
        raise TicketMoveRefused(ticket_path=ticket_path, reason="not_in_column_folder")

    new_abs = new_dir / old_abs.relative_to(old_dir)
    _refuse_unsafe_move(old_abs, new_abs, root, ticket_path)
    new_abs.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(old_abs), str(new_abs))

    return Path(os.path.relpath(new_abs, _normalized(board_dir, "."))).as_posix()


def _normalized(board_dir: Path, path: str) -> Path:
    return Path(os.path.normpath(board_dir / path))


def _refuse_unsafe_move(old_abs: Path, new_abs: Path, root: Path, ticket_path: str) -> None:
    # board.yaml is writable from inside the container, so neither path it names is trusted.
    resolved_root = root.resolve()

    if not (
        old_abs.resolve().is_relative_to(resolved_root)
        and new_abs.resolve().is_relative_to(resolved_root)
    ):
        raise TicketMoveRefused(ticket_path=ticket_path, reason="outside_workspace")

    if new_abs.exists() or new_abs.is_symlink():
        raise TicketMoveRefused(ticket_path=ticket_path, reason="destination_exists")
