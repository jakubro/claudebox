"""Global daemon configuration — registered workspaces, port, settings."""

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Self

from filelock import FileLock

from claudebox import DataClass, read_json, write_json
from claudebox.constants import daemon_config_path
from .errors import WorkspaceNotRegistered
from .workspaces.models import RegisteredWorkspace


@dataclass
class DaemonConfig(DataClass):
    """Global daemon configuration persisted at `daemon_config_path()`.

    Attributes:
        path: Filesystem path to the config file.
        workspaces: Registered workspace entries.
    """

    path: Path
    workspaces: list[RegisteredWorkspace] = field(default_factory=list)

    # Workspace Management
    # ----------------------------------------------------------------------------------------------

    def get_workspace(self, workspace_id: str) -> RegisteredWorkspace:
        """Look up a registered workspace by ID."""

        for workspace in self.workspaces:
            if workspace.id == workspace_id:
                return workspace

        raise WorkspaceNotRegistered(workspace_id=workspace_id)

    def register_workspace(self, workspace_path: str | Path) -> RegisteredWorkspace:
        """Register a workspace, returning existing entry if already registered."""

        workspace_path = Path(workspace_path).resolve()
        workspace_id = workspace_path.name

        try:
            existing = self.get_workspace(workspace_id)
        except WorkspaceNotRegistered:
            pass
        else:
            if existing.path == workspace_path:
                return existing

            # Basename collision — disambiguate with path hash
            path_hash = hashlib.sha256(str(workspace_path).encode()).hexdigest()[:8]
            workspace_id = f"{workspace_id}-{path_hash}"

        try:
            return self.get_workspace(workspace_id)
        except WorkspaceNotRegistered:
            workspace = RegisteredWorkspace(path=workspace_path, id=workspace_id)
            self._add(workspace)
            return workspace

    def deregister_workspace(self, workspace_id: str) -> bool:
        """Remove a workspace by ID, returning True if found."""

        try:
            workspace = self.get_workspace(workspace_id)
        except WorkspaceNotRegistered:
            return False
        else:
            self._remove(workspace)
            return True

    # Persistence
    # ----------------------------------------------------------------------------------------------

    @classmethod
    def load(cls, path: str | Path | None = None) -> Self:
        """Load daemon config from disk, returning empty config if missing."""

        path = Path(path if path is not None else daemon_config_path()).resolve()

        data = read_json(path, default={})
        data["path"] = path

        return cls.fromdict(data)

    def save(self) -> None:
        """Persist daemon config to disk with file locking."""

        with FileLock(self.path.with_suffix(".lock")):
            data = self.asdict()
            del data["path"]
            write_json(self.path, data)

    def _add(self, workspace: RegisteredWorkspace) -> None:
        """Append workspace and persist."""

        self.workspaces.append(workspace)
        self.save()

    def _remove(self, workspace: RegisteredWorkspace) -> None:
        """Remove workspace and persist."""

        self.workspaces.remove(workspace)
        self.save()
