"""UI state data models for daemon-side state management."""

from dataclasses import dataclass
from typing import Self

from claudebox import DataClass, invert


# API key aliases for serialization.
_FIELD_TO_KEY = {"global_state": "global", "session_state": "session"}
_KEY_TO_FIELD = invert(_FIELD_TO_KEY)


@dataclass
class UIState(DataClass):
    """Global and session-scoped UI state.

    Attributes:
        global_state: Workspace-wide UI preferences.
        session_state: Per-session UI preferences.
    """

    global_state: dict
    session_state: dict

    def asdict(self) -> dict:
        """Serialize with API-compatible keys (global, session)."""

        return {_FIELD_TO_KEY[k]: v for k, v in super().asdict().items()}

    @classmethod
    def fromdict(cls, data) -> Self:
        """Deserialize from API-compatible keys."""

        mapped = {_KEY_TO_FIELD.get(k, k): v for k, v in data.items()}

        return super().fromdict(mapped)
