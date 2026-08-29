"""Workspace configuration loading and hierarchy resolution."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Self

from .constants import CLAUDEBOX_SETTINGS_FILE, CONFIG_DIR_NAME, DEFAULT_AGENT, DEFAULT_BACKEND
from .core.fs import resolve_path, walk_up
from .core.io import read_toml
from .core.structures import DataClass, merge
from .paths import get_workspace_root


# Sub-tables under [langgraph.*] mapped to typed fields; anything else becomes provider_kwargs[<x>].
_LANGGRAPH_RESERVED_SUBTABLES = frozenset({"web_search", "mcp", "cost", "hooks"})


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

    @classmethod
    def load(cls, workspace_path: str | Path | None = None) -> Self:
        """Load configuration from the workspace hierarchy and home directory, walking up from cwd
        for a `.workspace` marker unless workspace_path is given directly."""

        if workspace_path:
            workspace_root = Path(workspace_path).resolve()
        else:
            workspace_root = get_workspace_root()

        config_root = workspace_root or Path.home()
        work_dir = workspace_root or Path.cwd().resolve()

        data = cls._load_config_files(work_dir)

        profile = data.get("profile")
        profile = profile and resolve_path(profile)

        mounts = data.get("mounts")
        mounts = mounts and {resolve_path(k): resolve_path(v) for k, v in mounts.items()}

        editor_section = data.get("editor") or {}
        links_section = data.get("links") or {}

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
            backend=data.get("backend", DEFAULT_BACKEND),
            mounts=mounts,
            ports=data.get("ports"),
            network_mode=data.get("network", {}).get("mode"),
            env=data.get("env"),
            containers_nested=data.get("containers", {}).get("nested", False),
            editor_url_template=editor_section.get("url_template"),
            links_allow=links_section.get("allow"),
            langgraph_model=langgraph_section.get("model"),
            langgraph_max_tokens_override=langgraph_section.get("max_tokens_override"),
            langgraph_web_search_provider=web_search_section.get("provider", "duckduckgo"),
            langgraph_web_search_api_key_env=web_search_section.get("api_key_env"),
            langgraph_mcp_servers=mcp_servers or None,
            langgraph_provider_kwargs=provider_kwargs,
            langgraph_cost_overrides=cost_overrides,
            langgraph_hooks=langgraph_hooks,
        )

    @classmethod
    def _load_config_files(cls, start_dir: Path) -> dict:
        """Collect and merge settings.toml files by walking up from start_dir through home; a file
        with `root = true` stops the walk."""

        files = {}

        for directory in (*walk_up(start_dir), Path.home()):
            path = directory / CLAUDEBOX_SETTINGS_FILE

            if not path.exists():
                continue

            data = read_toml(path, default={})
            files[path] = data

            if data.get("root", False):
                break

        return merge(*reversed(files.values()))
