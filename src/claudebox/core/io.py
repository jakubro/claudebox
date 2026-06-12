"""File I/O utilities for text, JSON, JSONL, and TOML."""

import hashlib
import json
import tomllib
from collections.abc import Iterable
from pathlib import Path
from typing import Any, TypeVar

from . import serialization
from ..core.fs import touch_dir


T = TypeVar("T")
NOT_PROVIDED = object()


def write_text(path: str | Path, data) -> None:
    """Write text data to file, creating parent directories if needed."""

    path = Path(path)
    touch_dir(path.parent)
    path.write_text(str(data))


def append_text(path: str | Path, data) -> None:
    """Append text data to file with trailing newline, creating parents if needed."""

    path = Path(path)
    touch_dir(path.parent)

    with open(path, "a") as f:
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
        text = Path(path).read_text().strip()
    except FileNotFoundError:
        pass
    else:
        if text:
            return serialization.loads(text)

    if default is not NOT_PROVIDED:
        return default

    raise FileNotFoundError(path)


def read_toml(path: str | Path, default: T = NOT_PROVIDED) -> dict | T:  # ty: ignore[invalid-parameter-default]
    """Read and parse a TOML file, returning default if missing or empty (else raises)."""

    try:
        text = Path(path).read_text().strip()
    except FileNotFoundError:
        pass
    else:
        if text:
            return tomllib.loads(text)

    if default is not NOT_PROVIDED:
        return default

    raise FileNotFoundError(path)


def read_jsonl(path: str | Path) -> Iterable:
    """Yield parsed objects from JSONL file (nothing if missing, skips malformed lines)."""

    try:
        with open(path) as f:
            for line in f:
                if line.strip():
                    try:
                        yield serialization.loads(line)
                    except (json.JSONDecodeError, ValueError):
                        continue
    except FileNotFoundError:
        return
