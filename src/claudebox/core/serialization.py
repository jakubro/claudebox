"""JSON serialization utilities with extended type support."""

import dataclasses
import json
import traceback
import types
import typing
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any


class JSONEncoder(json.JSONEncoder):
    """JSON encoder with support for asdict(), datetime, Path, Enum, and dataclasses."""

    def default(self, obj: Any) -> Any:  # ty: ignore[invalid-method-override]
        """Delegate to serialize(); raise TypeError for unhandled types."""

        if obj is None:
            return None

        rv = serialize(obj)

        if obj is rv:
            raise TypeError(f"Object of type {obj.__class__.__name__} is not serializable")

        return rv


def dumps(obj: Any, **kwargs) -> str:
    """Serialize object to JSON string using extended encoder."""

    return json.dumps(obj, cls=JSONEncoder, **kwargs)


def loads(s: str, **kwargs) -> Any:
    """Deserialize JSON string to Python object."""

    return json.loads(s, **kwargs)


def dump(obj: Any, fp: Any, **kwargs) -> None:
    """Serialize object as JSON to file-like object using extended encoder."""

    json.dump(obj, fp, cls=JSONEncoder, **kwargs)


def load(fp: Any, **kwargs) -> Any:
    """Deserialize JSON from file-like object to Python object."""

    return json.load(fp, **kwargs)


def serialize(obj: Any, *, _seen: set | None = None) -> Any:
    """Recursively convert an object tree into JSON-safe primitives.

    Handles asdict(), dataclasses, datetime/date/time, Decimal, Path, Enum,
    and nested dicts/lists/sets/tuples. Circular references resolve to None.
    Returns the original object unchanged for already-serializable primitives.
    """

    if obj is None:
        return None

    _seen = _seen or set()

    if id(obj) in _seen:
        return None

    _seen = _seen | {id(obj)}

    asdict = getattr(obj, "asdict", None)

    if callable(asdict):
        try:
            obj = asdict()
        except Exception:
            traceback.print_exc()
            pass

    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        obj = dataclasses.asdict(obj)

    if isinstance(obj, datetime | date | time):
        return obj.isoformat()
    elif isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, Path):
        return str(obj)
    elif isinstance(obj, Enum):
        return obj.value
    elif isinstance(obj, dict):
        return {serialize(k, _seen=_seen): serialize(v, _seen=_seen) for k, v in obj.items()}
    elif isinstance(obj, list | set | frozenset | tuple):
        return [serialize(item, _seen=_seen) for item in obj]
    else:
        return obj


def deserialize(node: Any, cls: type | types.UnionType | None) -> Any:
    """Recursively transform a JSON-loaded value into the desired type.

    Handles primitives (passthrough), 1-param collections (list, set, frozenset, tuple),
    dict[K, V], and dataclasses (fields resolved via type hints). Unknown types pass through.
    """

    if node is None or cls is None:
        return None

    origin = typing.get_origin(cls) or cls
    args = typing.get_args(cls)

    if cls is not None and not args and isinstance(node, cls):
        return node
    elif origin in (typing.Union, types.UnionType):
        non_none = [a for a in args if a is not type(None)]

        return deserialize(node, non_none[0]) if len(non_none) == 1 else node
    elif origin in (list, set, frozenset, tuple) and isinstance(node, list):
        args = args or (None,)

        return origin(deserialize(item, args[0]) for item in node)
    elif origin is dict and isinstance(node, dict):
        args = args or (None, None)

        return {deserialize(k, args[0]): deserialize(v, args[1]) for k, v in node.items()}
    elif dataclasses.is_dataclass(origin) and isinstance(node, dict):
        hints = typing.get_type_hints(origin)
        fields = {f.name for f in dataclasses.fields(origin)}
        kwargs = {k: deserialize(v, hints.get(k)) for k, v in node.items() if k in fields}

        return origin(**kwargs)
    elif origin in (datetime, date, time) and isinstance(node, str):
        return origin.fromisoformat(node)  # ty: ignore[unresolved-attribute]
    elif not callable(origin):
        return node
    else:
        return origin(node)
