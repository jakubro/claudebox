"""Data structure utilities."""

import dataclasses
from typing import Self

from .serialization import deserialize


class DataClass:
    """Mixin providing dict serialization for dataclasses."""

    def asdict(self) -> dict:
        """Return deep dict representation via dataclasses.asdict."""

        # noinspection PyTypeChecker,PyDataclass
        return dataclasses.asdict(self)  # ty: ignore[invalid-argument-type]

    @classmethod
    def fromdict(cls, data) -> Self:
        """Create instance from a dict via recursive deserialization."""

        return deserialize(data, cls)


def invert(mapping: dict) -> dict:
    """Return a new dict with keys and values swapped."""

    return {v: k for k, v in mapping.items()}


def merge(*sources: dict) -> dict:
    """Deep merge multiple dictionaries, with later sources taking precedence.

    Example:
        >>> merge({'a': {'x': 1}}, {'a': {'y': 2}})
        {'a': {'x': 1, 'y': 2}}
    """

    rv = {}

    for source in sources:
        for key, new in source.items():
            old = rv.get(key, {})

            if isinstance(new, dict) and isinstance(old, dict):
                rv[key] = merge(old, new)
            else:
                rv[key] = new

    return rv
