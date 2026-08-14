"""Workspace data models."""

from dataclasses import dataclass
from pathlib import Path

from claudebox import DataClass


@dataclass
class RegisteredWorkspace(DataClass):
    """A workspace registered with the daemon; id is derived from the directory name."""

    id: str
    path: Path

    @property
    def available(self) -> bool:
        """True if the workspace directory exists on disk."""

        return self.path.is_dir() if self.path else False
