"""Tests for claudebox.structures — DataClass mixin and deep merge."""

import dataclasses

import pytest

from claudebox.core.structures import DataClass, merge


# --- Helpers ---


@dataclasses.dataclass
class Inner(DataClass):
    value: int


@dataclasses.dataclass
class Outer(DataClass):
    name: str
    inner: Inner | None = None


# --- merge ---


class TestMerge:
    """Test deep dictionary merging."""

    def test_flat_dicts(self):
        assert merge({"a": 1}, {"b": 2}) == {"a": 1, "b": 2}

    def test_nested_recursive(self):
        assert merge({"a": {"x": 1}}, {"a": {"y": 2}}) == {"a": {"x": 1, "y": 2}}

    def test_later_overrides_earlier(self):
        assert merge({"a": 1}, {"a": 2}) == {"a": 2}

    def test_non_dict_replaces_dict(self):
        assert merge({"a": {"x": 1}}, {"a": "flat"}) == {"a": "flat"}

    def test_empty_sources(self):
        assert merge() == {}

    def test_single_source(self):
        assert merge({"a": 1}) == {"a": 1}

    def test_three_sources(self):
        result = merge({"a": 1}, {"b": 2}, {"a": 3, "c": 4})
        assert result == {"a": 3, "b": 2, "c": 4}

    def test_none_value_overwrites(self):
        assert merge({"a": 1}, {"a": None}) == {"a": None}

    def test_dict_replaces_non_dict(self):
        assert merge({"a": "flat"}, {"a": {"x": 1}}) == {"a": {"x": 1}}

    def test_three_level_nesting(self):
        a = {"l1": {"l2": {"l3": 1}}}
        b = {"l1": {"l2": {"l3b": 2}}}
        result = merge(a, b)
        assert result == {"l1": {"l2": {"l3": 1, "l3b": 2}}}


# --- DataClass ---


class TestDataClass:
    """Test DataClass mixin roundtrip serialization."""

    def test_asdict_simple(self):
        inner = Inner(value=42)
        assert inner.asdict() == {"value": 42}

    def test_fromdict_simple(self):
        inner = Inner.fromdict({"value": 42})
        assert inner == Inner(value=42)

    def test_roundtrip_nested(self):
        original = Outer(name="test", inner=Inner(value=7))
        data = original.asdict()
        restored = Outer.fromdict(data)
        assert restored.name == original.name
        assert restored.inner == original.inner

    def test_roundtrip_with_none(self):
        original = Outer(name="test", inner=None)
        restored = Outer.fromdict(original.asdict())
        assert restored.inner is None

    def test_fromdict_missing_required_raises(self):
        """Missing required fields should raise TypeError."""

        with pytest.raises(TypeError):
            Inner.fromdict({})
