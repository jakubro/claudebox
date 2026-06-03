"""Workspace configuration loading and hierarchy resolution."""

from dataclasses import dataclass
from pathlib import Path
from typing import Self

from .constants import CLAUDEBOX_SETTINGS_FILE, CONFIG_DIR_NAME, DEFAULT_AGENT, DEFAULT_BACKEND
from .core.fs import resolve_path, walk_up
from .core.io import read_toml
from .core.structures import DataClass, merge
from .paths import get_workspace_root


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

    @classmethod
    def load(cls, workspace_path: str | Path | None = None) -> Self:
        """Load configuration from workspace hierarchy and home directory.

        When workspace_path is provided, uses it directly as the workspace root
        without walking up from cwd. When omitted, walks up from the current
        directory looking for a `.workspace` marker.
        """

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
        )

    @classmethod
    def _load_config_files(cls, start_dir: Path) -> dict:
        """Collect and merge config files from directory hierarchy.

        Walks up from start_dir through home, merging settings.toml files.
        A file with ``root = true`` stops the upward walk.
        """

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
