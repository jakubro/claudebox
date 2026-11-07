"""File I/O utilities for text, JSON, JSONL, and TOML."""

from __future__ import annotations

import hashlib
import json
import os
import tomllib
import uuid
from collections.abc import Iterable
from pathlib import Path
from typing import Any, TypeVar

from . import serialization
from ..core.fs import touch_dir


T = TypeVar("T")
NOT_PROVIDED = object()
# Bytes read per step while walking back to the last newline; bounds memory, not the tail's size.
_TAIL_CHUNK = 64 * 1024
_DECODER = json.JSONDecoder()
# (path, position) pairs already reported: a reader of a log it also writes to would re-report on every read.
_reported_damage: set[tuple[str, str, int]] = set()


def write_text(path: str | Path, data) -> None:
    """Write text data to file, creating parent directories if needed.

    Temp file plus rename, so a concurrent reader sees the old file or the new one, never a partial.
    """

    path = Path(path)
    # A rename swaps the link itself, so a symlinked path is followed to keep its indirection.
    target = Path(os.path.realpath(path)) if path.is_symlink() else path

    touch_dir(target.parent)
    tmp = target.with_name(f"{target.name}.tmp-{uuid.uuid4().hex}")

    try:
        tmp.write_text(str(data), encoding="utf-8")

        # A fresh temp file carries the umask; without this the rename resets the target's mode.
        if target.exists():
            tmp.chmod(target.stat().st_mode & 0o7777)

        os.replace(tmp, target)
    except OSError:
        tmp.unlink(missing_ok=True)

        raise


def append_text(path: str | Path, data) -> None:
    """Append text data to file with trailing newline, creating parents if needed."""

    path = Path(path)
    touch_dir(path.parent)

    with open(path, "a", encoding="utf-8") as f:
        f.write(str(data) + "\n")


def write_json(path: str | Path, data) -> None:
    """Write data as JSON to file, creating parent directories if needed."""

    write_text(path, serialization.dumps(data))


def append_json(path: str | Path, data) -> None:
    """Append data as JSON line to file (JSONL format), creating parents if needed."""

    append_text(path, serialization.dumps(data))


def count_lines(path: str | Path) -> int:
    """Count lines in file, returning 0 if file doesn't exist."""

    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f)
    except FileNotFoundError:
        return 0


def calculate_hash(path: str | Path) -> str:
    """Calculate SHA256 hash of file contents."""

    content = Path(path).read_bytes()

    return hashlib.sha256(content).hexdigest()


def read_json(path: str | Path, default: Any = NOT_PROVIDED) -> Any:
    """Read and parse a JSON file, returning default if missing or empty (else raises)."""

    try:
        text = Path(path).read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        pass
    else:
        if text:
            return serialization.loads(text)

    if default is not NOT_PROVIDED:
        return default

    raise FileNotFoundError(path)


def read_toml[T](path: str | Path, default: T = NOT_PROVIDED) -> dict | T:  # ty: ignore[invalid-parameter-default]
    """Read and parse a TOML file, returning default if missing or empty (else raises)."""

    try:
        text = Path(path).read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        pass
    else:
        if text:
            return tomllib.loads(text)

    if default is not NOT_PROVIDED:
        return default

    raise FileNotFoundError(path)


def read_jsonl(path: str | Path) -> Iterable:
    """Yield objects from a JSONL file; a damaged line yields the records it ends with (reported once
    per process), and an unterminated last line - a write in flight - is skipped silently."""

    try:
        with open(path, encoding="utf-8") as f:
            for number, line in enumerate(f, start=1):
                if not line.strip():
                    continue

                try:
                    yield serialization.loads(line)
                except (json.JSONDecodeError, ValueError) as exc:
                    if line.endswith("\n"):
                        yield from _recover_damaged_line(path, ("line", number), line, exc)
    except FileNotFoundError:
        return


def read_jsonl_from(path: str | Path, offset: int) -> tuple[list, int]:
    """Return the objects on the complete lines after byte `offset`, and the offset past them.

    Lines decode as `read_jsonl`'s do; an unterminated last line waits for a later read.
    """

    records: list = []
    position = offset

    try:
        with open(path, "rb") as f:
            f.seek(offset)

            for raw in f:
                if not raw.endswith(b"\n"):
                    break

                start = position
                position += len(raw)
                line = raw.decode("utf-8")

                if not line.strip():
                    continue

                try:
                    records.append(serialization.loads(line))
                except (json.JSONDecodeError, ValueError) as exc:
                    records.extend(_recover_damaged_line(path, ("offset", start), line, exc))
    except FileNotFoundError:
        return [], 0

    return records, position


def read_jsonl_tail(path: str | Path, limit: int) -> list:
    """Return the objects on a JSONL file's last `limit` lines, oldest first, as `read_jsonl` would.

    The file is read back from its end, so the cost tracks `limit`, not the file's size.
    """

    try:
        with open(path, "rb") as f:
            start, data = _read_tail(f, limit)
    except FileNotFoundError:
        return []

    lines = data.split(b"\n")
    terminated = [True] * (len(lines) - 1) + [False]
    offsets = []
    offset = start

    for line in lines:
        offsets.append(offset)
        offset += len(line) + 1

    # Reading began mid-file, so the first piece is the tail of a line that is not wanted.
    first = 1 if start > 0 else 0
    kept = [i for i in range(first, len(lines)) if lines[i].strip()][-limit:]
    records = []

    for i in kept:
        line = lines[i].decode("utf-8")

        try:
            records.append(serialization.loads(line))
        except (json.JSONDecodeError, ValueError) as exc:
            if terminated[i]:
                records.extend(_recover_damaged_line(path, ("offset", offsets[i]), line, exc))

    return records


def repair_jsonl_tail(path: str | Path) -> None:
    """Make the next append to a JSONL file start on a fresh line.

    A final record that lost only its newline gets it back; an unparseable fragment is truncated.
    """

    path = Path(path)

    try:
        with open(path, "rb") as f:
            size = f.seek(0, os.SEEK_END)

            if size == 0:
                return

            f.seek(size - 1)

            if f.read(1) == b"\n":
                return

            start = _last_line_start(f, size)
            f.seek(start)
            tail = f.read()
    except FileNotFoundError:
        return

    with open(path, "r+b") as f:
        if _is_json_object(tail):
            f.seek(size)
            f.write(b"\n")
        else:
            f.truncate(start)
            _logger().warning(
                "Truncated a torn JSONL tail",
                path=str(path),
                offset=start,
                bytes_dropped=size - start,
            )


def _last_line_start(f, size: int) -> int:
    pos = size

    while pos > 0:
        step = min(_TAIL_CHUNK, pos)
        pos -= step
        f.seek(pos)
        newline = f.read(step).rfind(b"\n")

        if newline != -1:
            return pos + newline + 1

    return 0


def _read_tail(f, limit: int) -> tuple[int, bytes]:
    pos = f.seek(0, os.SEEK_END)
    data = b""

    # One newline more than `limit`, so the earliest kept line is known to start where it seems to.
    while pos > 0 and data.count(b"\n") <= limit:
        step = min(_TAIL_CHUNK, pos)
        pos -= step
        f.seek(pos)
        data = f.read(step) + data

    return pos, data


def _recover_damaged_line(
    path: str | Path,
    position: tuple[str, int],
    line: str,
    exc: Exception,
) -> list:
    text = line.rstrip()
    start = text.find("{")
    records: list = []

    while start != -1:
        if records := _decode_records(text, start):
            break

        start = text.find("{", start + 1)

    key = (str(path), *position)

    if key not in _reported_damage:
        _reported_damage.add(key)

        if records:
            _logger().warning(
                "Recovered records from a damaged JSONL line",
                path=str(path),
                **{position[0]: position[1]},
                records=len(records),
                bytes_dropped=len(text[:start].encode()),
            )
        else:
            _logger().warning(
                "Skipped unparseable JSONL line",
                path=str(path),
                **{position[0]: position[1]},
                error=str(exc),
            )

    return records


def _decode_records(text: str, start: int) -> list:
    records = []
    index = start

    try:
        while index < len(text):
            record, index = _DECODER.raw_decode(text, index)

            if not isinstance(record, dict):
                return []

            records.append(record)

            while index < len(text) and text[index].isspace():
                index += 1
    except json.JSONDecodeError:
        return []

    return records


def _is_json_object(data: bytes) -> bool:
    try:
        return isinstance(serialization.loads(data.decode("utf-8")), dict)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        return False


def _logger():
    # Resolved at call time: a module-level logger here would configure logging on import.
    from .logging import get_logger

    return get_logger(__name__)
