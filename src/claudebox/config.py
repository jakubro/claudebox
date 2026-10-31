"""Workspace configuration loading and hierarchy resolution."""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any, Self

from .constants import (
    ACCEPTED_BACKENDS,
    CLAUDEBOX_SETTINGS_FILE,
    CONFIG_DIR_NAME,
    DEFAULT_AGENT,
    DEFAULT_BACKEND,
    SESSION_MAX_AGE,
    SESSION_TMP_MAX_AGE,
    profile_dir,
)
from .core.fs import resolve_path, walk_up
from .core.io import read_toml
from .core.structures import DataClass, merge
from .paths import get_workspace_root


# Sub-tables under [langgraph.*] mapped to typed fields; anything else becomes provider_kwargs[<x>].
_LANGGRAPH_RESERVED_SUBTABLES = frozenset({"web_search", "mcp", "cost", "hooks"})

_BUNDLE_KEYS = frozenset(
    {
        "env",
        "mounts",
        "ports",
        "network",
        "model",
        "effort_level",
        "permission_mode",
        "session_prompt",
        "messages",
    },
)
_BUNDLE_NETWORK_KEYS = frozenset({"mode"})

# A bundle's name becomes part of a prompt filename inside the profile.
_BUNDLE_NAME_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")


@dataclass
class Config(DataClass):
    """Claudebox configuration merged from a workspace's settings.toml hierarchy."""

    work_dir: Path
    config_dir: Path

    agent: str = DEFAULT_AGENT
    backend: str = DEFAULT_BACKEND

    profile: Path | None = None
    mounts: dict[Path, Path] | None = None
    ports: dict[int, int] | None = None
    network_mode: str | None = None
    env: dict[str, str] | None = None

    # [containers] - opt-in nested podman-in-podman inside the session.
    containers_nested: bool = False

    # [editor] - URI template for "open in IDE" affordances; absent disables it, else {path}/{line}
    # are substituted client-side.
    editor_url_template: str | None = None

    # [links] allow - full-match regex allowlist for message text a URL may auto-submit.
    links_allow: list[str] | None = None

    # [prune] - days a session may go unused before prune removes it, and before it empties its tmp/.
    prune_session_days: int = SESSION_MAX_AGE.days
    prune_tmp_days: int = SESSION_TMP_MAX_AGE.days

    # LangGraph adapter knobs, populated when [langgraph] is present; adapter selection is the
    # top-level `agent` field, this section is adapter-private config.
    langgraph_model: str | None = None
    langgraph_max_tokens_override: int | None = None

    # [langgraph.web_search] - backend for the langgraph web_search tool.
    langgraph_web_search_provider: str = "duckduckgo"
    langgraph_web_search_api_key_env: str | None = None

    # [langgraph.mcp.<name>] - connection dict per sub-table keyed by name; empty dict means no MCP servers.
    langgraph_mcp_servers: dict[str, dict] | None = None

    # [langgraph.<provider>] - per-provider kwargs forwarded to init_chat_model; SessionService.start()
    # picks the entry for the active provider.
    langgraph_provider_kwargs: dict[str, dict[str, Any]] = field(default_factory=dict)

    # [langgraph.cost] - per-model USD-per-Mtok overrides keyed by bare model id; `lookup_price`
    # consumes these before the curated `PRICE_PER_MTOK` table.
    langgraph_cost_overrides: dict[str, dict[str, float]] = field(default_factory=dict)

    # [langgraph.hooks] - hook scripts keyed by lifecycle event, e.g. `session_start = "hooks/session_start.py"`.
    # Relative paths resolve against the installed profile directory; declaring nothing uses the conventional path.
    langgraph_hooks: dict[str, str] = field(default_factory=dict)

    # [bundles.<name>] - raw override tables by name; `resolve_bundle` layers one over the rest.
    bundles: dict[str, dict[str, Any]] | None = None

    # The bundle `resolve_bundle` applied; None for a plain `load`.
    bundle: str | None = None

    @classmethod
    def load(cls, workspace_path: str | Path | None = None) -> Self:
        """Load configuration from the workspace hierarchy and home directory, walking up from cwd
        for a `.workspace` marker unless workspace_path is given directly."""

        work_dir, config_root, files = cls._locate(workspace_path)

        return cls._parse(merge(*reversed(files.values())), files, work_dir, config_root)

    @classmethod
    def resolve_bundle(cls, workspace_path: str | Path, bundle: str) -> Self:
        """Load the workspace's configuration with the named bundle merged over it, the bundle
        winning per key; an undeclared name raises rather than falling back to the plain load."""

        work_dir, config_root, files = cls._locate(workspace_path)
        data = merge(*reversed(files.values()))
        bundles = cls._parse_bundles(data, files) or {}

        if bundle not in bundles:
            raise ValueError(
                f"claudebox: bundle {bundle!r} is not declared in "
                f"{config_root / CLAUDEBOX_SETTINGS_FILE}; declared bundles: {sorted(bundles)}",
            )

        config = cls._parse(merge(data, bundles[bundle]), files, work_dir, config_root)
        config.bundle = bundle

        return config

    @classmethod
    def _locate(cls, workspace_path: str | Path | None) -> tuple[Path, Path, dict[Path, dict]]:
        if workspace_path:
            workspace_root = Path(workspace_path).resolve()
        else:
            workspace_root = get_workspace_root()

        config_root = workspace_root or Path.home()
        work_dir = workspace_root or Path.cwd().resolve()

        return work_dir, config_root, cls._collect_config_files(work_dir)

    @classmethod
    def _parse(cls, data: dict, files: dict[Path, dict], work_dir: Path, config_root: Path) -> Self:
        backend = data.get("backend", DEFAULT_BACKEND)

        if backend not in ACCEPTED_BACKENDS:
            source = next(
                (path for path, file_data in files.items() if "backend" in file_data),
                None,
            )

            raise ValueError(
                f"claudebox: backend {backend!r} in {source} is not one of {sorted(ACCEPTED_BACKENDS)}",
            )

        profile = data.get("profile")

        if profile:
            profile = resolve_path(profile)
        elif profile_dir().is_dir():
            profile = profile_dir()

        mounts = data.get("mounts")
        mounts = mounts and {resolve_path(k): resolve_path(v) for k, v in mounts.items()}

        editor_section = data.get("editor") or {}
        links_section = data.get("links") or {}
        prune_section = data.get("prune") or {}

        langgraph_section: dict = {}
        raw_langgraph = data.get("langgraph")

        if isinstance(raw_langgraph, dict):
            langgraph_section = raw_langgraph

        web_search_section = langgraph_section.get("web_search") or {}
        mcp_section = langgraph_section.get("mcp") or {}
        mcp_servers: dict[str, dict] = {
            name: dict(server_config)
            for name, server_config in mcp_section.items()
            if isinstance(server_config, dict)
        }

        # Harvest every [langgraph.<x>] sub-table not in _LANGGRAPH_RESERVED_SUBTABLES; the isinstance
        # check skips scalars (model, max_tokens_override).
        provider_kwargs: dict[str, dict[str, Any]] = {
            name: dict(sub_table)
            for name, sub_table in langgraph_section.items()
            if name not in _LANGGRAPH_RESERVED_SUBTABLES and isinstance(sub_table, dict)
        }

        hooks_section = langgraph_section.get("hooks") or {}
        langgraph_hooks: dict[str, str] = {
            event: str(script) for event, script in hooks_section.items() if isinstance(script, str)
        }

        cost_section = langgraph_section.get("cost") or {}
        cost_overrides: dict[str, dict[str, float]] = {
            model_id: dict(rates)
            for model_id, rates in cost_section.items()
            if isinstance(rates, dict)
        }

        return cls(
            work_dir=work_dir,
            config_dir=config_root / CONFIG_DIR_NAME,
            profile=profile,
            agent=data.get("agent", DEFAULT_AGENT),
            backend=backend,
            mounts=mounts,
            ports=data.get("ports"),
            network_mode=data.get("network", {}).get("mode"),
            env=data.get("env"),
            containers_nested=data.get("containers", {}).get("nested", False),
            editor_url_template=editor_section.get("url_template"),
            links_allow=links_section.get("allow"),
            prune_session_days=_prune_days(prune_section, files, "session_days", SESSION_MAX_AGE),
            prune_tmp_days=_prune_days(prune_section, files, "tmp_days", SESSION_TMP_MAX_AGE),
            langgraph_model=langgraph_section.get("model"),
            langgraph_max_tokens_override=langgraph_section.get("max_tokens_override"),
            langgraph_web_search_provider=web_search_section.get("provider", "duckduckgo"),
            langgraph_web_search_api_key_env=web_search_section.get("api_key_env"),
            langgraph_mcp_servers=mcp_servers or None,
            langgraph_provider_kwargs=provider_kwargs,
            langgraph_cost_overrides=cost_overrides,
            langgraph_hooks=langgraph_hooks,
            bundles=cls._parse_bundles(data, files),
        )

    @classmethod
    def _parse_bundles(
        cls,
        data: dict,
        files: dict[Path, dict],
    ) -> dict[str, dict[str, Any]] | None:
        bundles: dict[str, dict[str, Any]] = {
            name: dict(table)
            for name, table in (data.get("bundles") or {}).items()
            if isinstance(table, dict)
        }

        for name, table in bundles.items():
            if not _BUNDLE_NAME_PATTERN.fullmatch(name):
                raise ValueError(
                    f"claudebox: bundle name {name!r} in {_bundle_source(files, name)} may hold "
                    "only letters, digits, '-' and '_', starting with a letter or digit",
                )

            network = table.get("network", {})
            refused = sorted(set(table) - _BUNDLE_KEYS)

            if isinstance(network, dict):
                refused += sorted(f"network.{key}" for key in set(network) - _BUNDLE_NETWORK_KEYS)
            else:
                refused.append("network")

            if refused:
                raise ValueError(
                    f"claudebox: bundle {name!r} in {_bundle_source(files, name, refused[0])} sets "
                    f"{refused[0]!r}, which a bundle may not carry; permitted keys: "
                    f"{sorted(_BUNDLE_KEYS)} and network.mode",
                )

        return bundles or None

    @classmethod
    def _load_config_files(cls, start_dir: Path) -> dict:
        """Collect and merge settings.toml files by walking up from start_dir through home; a file
        with `root = true` stops the walk."""

        return merge(*reversed(cls._collect_config_files(start_dir).values()))

    @classmethod
    def _collect_config_files(cls, start_dir: Path) -> dict[Path, dict]:
        """Collect settings.toml files walking up from start_dir through home, nearest first - an
        untrusted file is silently dropped (see `_is_trusted_settings_file`), unlike a bad backend value.
        """

        files = {}

        for directory in (*walk_up(start_dir), Path.home()):
            path = directory / CLAUDEBOX_SETTINGS_FILE

            if not path.exists():
                continue

            if not _is_trusted_settings_file(path):
                print(
                    f"claudebox: skipping settings file not owned by the current user: {path}",
                    file=sys.stderr,
                )
                continue

            data = read_toml(path, default={})
            files[path] = data

            if data.get("root", False):
                break

        return files


def _prune_days(section: dict, files: dict[Path, dict], key: str, default: timedelta) -> int:
    value = section.get(key, default.days)

    # bool is an int to isinstance, and `true` would otherwise read as one day.
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        source = next(
            (path for path, data in files.items() if key in (data.get("prune") or {})),
            None,
        )

        raise ValueError(
            f"claudebox: [prune] {key} = {value!r} in {source} is not a positive whole number of days",
        )

    return value


def _bundle_source(files: dict[Path, dict], name: str, key: str | None = None) -> Path | None:
    for path, file_data in files.items():
        table = file_data.get("bundles", {}).get(name)

        if isinstance(table, dict) and (key is None or key.split(".")[0] in table):
            return path

    return None


def _is_trusted_settings_file(path: Path) -> bool:
    """Whether `path` is owned by the user this process runs as - root always trusts, since a
    rootless/rootful backend can legitimately map the file's owner differently in-container.
    """

    return os.getuid() == 0 or path.stat().st_uid == os.getuid()
