"""Tests for claudebox.serialization — JSON encoding and deserialization."""

import dataclasses
import json
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from pathlib import Path

import pytest

from claudebox.core.serialization import deserialize, dump, dumps, load, loads, serialize


# --- Helpers ---


class Color(Enum):
    RED = "red"
    BLUE = "blue"


@dataclasses.dataclass
class Address:
    city: str
    zip_code: str


@dataclasses.dataclass
class Person:
    name: str
    age: int
    address: Address | None = None
    tags: list[str] = dataclasses.field(default_factory=list)


class HasAsdict:
    def asdict(self):
        return {"custom": True}


# --- JSONEncoder.default ---


class TestJSONEncoder:
    """Test extended JSON type serialization."""

    def test_datetime(self):
        dt = datetime(2026, 3, 6, 12, 30, 0)
        assert json.loads(dumps(dt)) == "2026-03-06T12:30:00"

    def test_date(self):
        d = date(2026, 3, 6)
        assert json.loads(dumps(d)) == "2026-03-06"

    def test_time(self):
        t = time(12, 30, 0)
        assert json.loads(dumps(t)) == "12:30:00"

    def test_decimal(self):
        assert json.loads(dumps(Decimal("3.14"))) == 3.14

    def test_path(self):
        assert json.loads(dumps(Path("/fake/test"))) == "/fake/test"

    def test_enum(self):
        assert json.loads(dumps(Color.RED)) == "red"

    def test_stdlib_dataclass(self):
        addr = Address(city="Prague", zip_code="10000")
        result = json.loads(dumps(addr))
        assert result == {"city": "Prague", "zip_code": "10000"}

    def test_object_with_asdict(self):
        obj = HasAsdict()
        result = json.loads(dumps(obj))
        assert result == {"custom": True}

    def test_asdict_takes_priority_over_dataclass(self):
        """Objects with .asdict() use that method, not dataclasses.asdict()."""
        person = Person(name="Test", age=1)
        # Person is a dataclass but doesn't have custom asdict — uses dataclasses.asdict
        result = json.loads(dumps(person))
        assert result["name"] == "Test"

    def test_unknown_type_raises(self):
        with pytest.raises(TypeError):
            dumps(object())


# --- deserialize ---


class TestDeserialize:
    """Test recursive type-aware deserialization."""

    def test_primitive_passthrough_str(self):
        assert deserialize("hello", str) == "hello"

    def test_primitive_passthrough_int(self):
        assert deserialize(42, int) == 42

    def test_primitive_passthrough_float(self):
        assert deserialize(3.14, float) == 3.14

    def test_primitive_passthrough_bool(self):
        assert deserialize(True, bool) is True

    def test_none_node_returns_none(self):
        assert deserialize(None, str) is None

    def test_none_cls_returns_node(self):
        assert deserialize("hello", None) is None

    def test_optional_with_none(self):
        assert deserialize(None, str | None) is None

    def test_optional_with_value(self):
        assert deserialize("hello", str | None) == "hello"

    def test_list_of_ints(self):
        assert deserialize([1, 2, 3], list[int]) == [1, 2, 3]

    def test_set_of_strings(self):
        assert deserialize(["a", "b"], set[str]) == {"a", "b"}

    def test_dict_str_int(self):
        assert deserialize({"a": 1, "b": 2}, dict[str, int]) == {"a": 1, "b": 2}

    def test_dataclass_from_dict(self):
        data = {"city": "Prague", "zip_code": "10000"}
        result = deserialize(data, Address)
        assert result == Address(city="Prague", zip_code="10000")

    def test_nested_dataclass(self):
        data = {"name": "Alice", "age": 30, "address": {"city": "Prague", "zip_code": "10000"}}
        result = deserialize(data, Person)
        assert result.name == "Alice"
        assert result.address == Address(city="Prague", zip_code="10000")

    def test_dataclass_with_list_field(self):
        data = {"name": "Bob", "age": 25, "tags": ["dev", "test"]}
        result = deserialize(data, Person)
        assert result.tags == ["dev", "test"]

    def test_extra_keys_ignored(self):
        data = {"city": "Prague", "zip_code": "10000", "country": "CZ"}
        result = deserialize(data, Address)
        assert result == Address(city="Prague", zip_code="10000")

    def test_datetime_from_iso_string(self):
        result = deserialize("2026-03-06T12:30:00", datetime)
        assert result == datetime(2026, 3, 6, 12, 30, 0)

    def test_date_from_iso_string(self):
        result = deserialize("2026-03-06", date)
        assert result == date(2026, 3, 6)

    def test_time_from_iso_string(self):
        result = deserialize("12:30:00", time)
        assert result == time(12, 30, 0)


# --- dumps/loads roundtrip ---


class TestDumpsLoads:
    """Test serialization roundtrip."""

    def test_roundtrip_dict(self):
        data = {"key": "value", "num": 42}
        assert loads(dumps(data)) == data

    def test_roundtrip_with_extended_types(self):
        data = {"path": Path("/fake"), "color": Color.BLUE}
        result = loads(dumps(data))
        assert result == {"path": "/fake", "color": "blue"}


# --- dump/load (file-based) ---


class TestDumpLoad:
    """Test file-based JSON serialization."""

    def test_dump_and_load(self, tmp_path):
        path = tmp_path / "data.json"
        data = {"key": "value", "num": 42}
        with open(path, "w") as f:
            dump(data, f)
        with open(path) as f:
            result = load(f)
        assert result == data

    def test_dump_extended_types(self, tmp_path):
        path = tmp_path / "data.json"
        with open(path, "w") as f:
            dump({"path": Path("/fake"), "dt": datetime(2026, 1, 1)}, f)
        with open(path) as f:
            result = load(f)
        assert result["path"] == "/fake"
        assert result["dt"] == "2026-01-01T00:00:00"


# --- deserialize edge cases ---


class TestDeserializeEdgeCases:
    """Test deserialize edge cases and multi-type unions."""

    def test_multi_type_union_passthrough(self):
        result = deserialize("hello", str | int)
        assert result == "hello"

    def test_frozenset(self):
        result = deserialize([1, 2, 3], frozenset[int])
        assert result == frozenset({1, 2, 3})

    def test_tuple(self):
        result = deserialize([1, 2], tuple[int])
        assert result == (1, 2)

    def test_asdict_exception_fallthrough(self):
        class BrokenAsdict:
            def asdict(self):
                raise RuntimeError("broken")

        # Should fall through to dataclass check, then to super().default()
        with pytest.raises(TypeError):
            dumps(BrokenAsdict())


# --- serialize ---


class TestSerialize:
    """Test recursive serialize() conversion to JSON-safe primitives."""

    def test_none(self):
        assert serialize(None) is None

    def test_primitive_passthrough(self):
        assert serialize("hello") == "hello"
        assert serialize(42) == 42
        assert serialize(3.14) == 3.14
        assert serialize(True) is True

    def test_datetime(self):
        assert serialize(datetime(2026, 3, 6, 12, 30)) == "2026-03-06T12:30:00"

    def test_date(self):
        assert serialize(date(2026, 3, 6)) == "2026-03-06"

    def test_time(self):
        assert serialize(time(12, 30)) == "12:30:00"

    def test_decimal(self):
        assert serialize(Decimal("3.14")) == 3.14

    def test_path(self):
        assert serialize(Path("/fake/test")) == "/fake/test"

    def test_enum(self):
        assert serialize(Color.RED) == "red"

    def test_dataclass(self):
        addr = Address(city="Prague", zip_code="10000")
        assert serialize(addr) == {"city": "Prague", "zip_code": "10000"}

    def test_nested_dataclass(self):
        person = Person(name="Alice", age=30, address=Address("Prague", "10000"))
        result = serialize(person)
        assert result == {
            "name": "Alice",
            "age": 30,
            "address": {"city": "Prague", "zip_code": "10000"},
            "tags": [],
        }

    def test_asdict_method_priority(self):
        obj = HasAsdict()
        assert serialize(obj) == {"custom": True}

    def test_dict_recursive(self):
        data = {"path": Path("/tmp"), "nested": {"dt": datetime(2026, 1, 1)}}
        result = serialize(data)
        assert result == {"path": "/tmp", "nested": {"dt": "2026-01-01T00:00:00"}}

    def test_list_recursive(self):
        result = serialize([Path("/a"), Path("/b")])
        assert result == ["/a", "/b"]

    def test_set_to_list(self):
        result = serialize({42})
        assert result == [42]

    def test_frozenset_to_list(self):
        result = serialize(frozenset({1}))
        assert result == [1]

    def test_tuple_to_list(self):
        result = serialize((1, "two", Path("/three")))
        assert result == [1, "two", "/three"]

    def test_circular_reference_returns_none(self):
        d: dict = {"key": "value"}
        d["self"] = d
        result = serialize(d)
        assert result == {"key": "value", "self": None}

    def test_dict_with_non_string_keys(self):
        result = serialize({Path("/k"): "v"})
        assert result == {"/k": "v"}
