"""Bidirectional drift check between Config's fields and etc/settings.sample.toml - the shipped
template must document every key Config accepts, and show nothing Config would reject."""

import re
import tomllib
from dataclasses import fields
from pathlib import Path

from claudebox.config import Config


LIB_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_PATH = LIB_ROOT / "etc" / "settings.sample.toml"

# Constructor-derived fields, never settings keys.
_NON_SETTINGS_FIELDS = {"work_dir", "config_dir"}

# Template-only key with no Config field: `root` stops the walk-up in Config._load_config_files.
_TEMPLATE_ONLY_KEYS = {"root"}

# Config field -> the exact dotted key it reads (see config.py's Config.load parse block, the
# source of truth this mirrors).
_EXACT_KEY_TO_FIELD = {
    "agent": "agent",
    "backend": "backend",
    "profile": "profile",
    "network.mode": "network_mode",
    "containers.nested": "containers_nested",
    "editor.url_template": "editor_url_template",
    "links.allow": "links_allow",
    "langgraph.model": "langgraph_model",
    "langgraph.max_tokens_override": "langgraph_max_tokens_override",
    "langgraph.web_search.provider": "langgraph_web_search_provider",
    "langgraph.web_search.api_key_env": "langgraph_web_search_api_key_env",
}

# Config field -> dotted PREFIX, for fields backed by a dict whose keys the user chooses.
_PREFIX_TO_FIELD = {
    "mounts": "mounts",
    "ports": "ports",
    "env": "env",
    "langgraph.mcp": "langgraph_mcp_servers",
    "langgraph.cost": "langgraph_cost_overrides",
    "langgraph.hooks": "langgraph_hooks",
}

# [langgraph.<x>] sub-tables config.py reserves for typed fields; any other name is a provider's
# own kwargs, so the forward check validates that field by classification, not by a fixed key.
_LANGGRAPH_RESERVED_SUBTABLES = frozenset({"web_search", "mcp", "cost", "hooks"})
_OPEN_ENDED_PROVIDER_FIELD = "langgraph_provider_kwargs"

_FIELD_TO_KEY = {
    **{v: k for k, v in _EXACT_KEY_TO_FIELD.items()},
    **{v: k for k, v in _PREFIX_TO_FIELD.items()},
}
_PREFIX_FIELDS = set(_PREFIX_TO_FIELD.values())


def _fully_uncomment(content: str) -> str:
    """Strip exactly one leading '#' from every line.
    A '#key = value' example becomes live; a '##' prose comment becomes an inert '#' one."""

    return re.sub(r"(?m)^#", "", content)


def _leaf_paths(data: dict, prefix: str = "") -> set[str]:
    """Flatten a nested dict into dotted leaf key paths; an empty table is its own leaf."""

    paths: set[str] = set()

    for key, value in data.items():
        path = f"{prefix}.{key}" if prefix else str(key)

        if isinstance(value, dict) and value:
            paths |= _leaf_paths(value, path)
        else:
            paths.add(path)

    return paths


def _template_key_paths() -> set[str]:
    """Every dotted leaf key path the template shows, commented or live."""

    uncommented = _fully_uncomment(TEMPLATE_PATH.read_text(encoding="utf-8"))

    return _leaf_paths(tomllib.loads(uncommented))


def _classify(path: str) -> str | None:
    """Map a template's dotted leaf key path to the Config field that owns it.
    None for an excluded template-only key, "<unmapped>" when nothing claims it."""

    if path in _TEMPLATE_ONLY_KEYS:
        return None

    if path in _EXACT_KEY_TO_FIELD:
        return _EXACT_KEY_TO_FIELD[path]

    for prefix, field_name in _PREFIX_TO_FIELD.items():
        if path == prefix or path.startswith(f"{prefix}."):
            return field_name

    if path == "langgraph" or path.startswith("langgraph."):
        sub = path.split(".")[1] if "." in path else ""

        if sub and sub not in _LANGGRAPH_RESERVED_SUBTABLES:
            return "langgraph_provider_kwargs"

    return "<unmapped>"


def _fields_without_mapping(field_names: set[str]) -> set[str]:
    """Settings fields with no entry in _FIELD_TO_KEY - what a genuinely new field looks like."""

    return field_names - _NON_SETTINGS_FIELDS - set(_FIELD_TO_KEY) - {_OPEN_ENDED_PROVIDER_FIELD}


class TestForwardDrift:
    """Every Config field the template should document actually appears there."""

    def test_every_config_field_has_a_template_key(self):
        template_paths = _template_key_paths()
        field_names = {f.name for f in fields(Config)} - _NON_SETTINGS_FIELDS

        assert not _fields_without_mapping(field_names), _fields_without_mapping(field_names)

        for name in sorted(field_names - {_OPEN_ENDED_PROVIDER_FIELD}):
            key = _FIELD_TO_KEY[name]

            if name in _PREFIX_FIELDS:
                matches = [p for p in template_paths if p == key or p.startswith(f"{key}.")]
                assert matches, f"Config.{name} ({key}.*) has no key in {TEMPLATE_PATH.name}"
            else:
                assert key in template_paths, (
                    f"Config.{name} ({key}) is missing from {TEMPLATE_PATH.name}"
                )

    def test_provider_kwargs_has_at_least_one_worked_example(self):
        template_paths = _template_key_paths()
        provider_examples = [
            p for p in template_paths if _classify(p) == _OPEN_ENDED_PROVIDER_FIELD
        ]

        assert provider_examples, "no [langgraph.<provider>] worked example in the template"


class TestReverseDrift:
    """Every key the template shows maps to a real Config field - a stale key misleads too."""

    def test_every_template_key_maps_to_a_config_field(self):
        template_paths = _template_key_paths()
        field_names = {f.name for f in fields(Config)}

        for path in sorted(template_paths):
            mapped = _classify(path)

            if mapped is None:
                continue

            assert mapped != "<unmapped>", f"template key '{path}' does not map to any Config field"
            assert mapped in field_names, f"template key '{path}' maps to unknown field '{mapped}'"


class TestMutationCheck:
    """The forward and reverse checks above are provably not vacuous."""

    def test_a_new_field_with_no_mapping_entry_is_caught(self):
        real_fields = {f.name for f in fields(Config)}
        mutated = real_fields | {"totally_new_field"}

        assert _fields_without_mapping(mutated) == {"totally_new_field"}

    def test_a_stray_template_key_with_no_field_is_caught(self):
        assert _classify("totally.new.key") == "<unmapped>"


class TestTemplateValidity:
    """The template, fully uncommented, is a config Config.load actually accepts."""

    def test_uncommented_template_parses_and_loads(self, tmp_path):
        uncommented = _fully_uncomment(TEMPLATE_PATH.read_text(encoding="utf-8"))

        settings = tmp_path / ".claudebox" / "settings.toml"
        settings.parent.mkdir(parents=True, exist_ok=True)
        settings.write_text(uncommented, encoding="utf-8")

        config = Config.load(workspace_path=tmp_path)

        assert config.agent == "claude"
        assert config.links_allow == ["/greet \\S+"]
