"""Persistent key-value store for UI state with global and per-session namespaces."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from filelock import FileLock

from claudebox import read_json, write_json
from claudebox.constants import CONFIG_DIR_NAME, SESSION_MAX_AGE
from .models import UIState
from ...constants import UI_STATE_FILE


if TYPE_CHECKING:
    from ..workspaces import RegisteredWorkspace


class UIStateService:
    """Read and patch UI state backed by a per-workspace JSON file with versioning and pruning."""

    VERSION = 2

    def __init__(self, workspace: "RegisteredWorkspace") -> None:
        self._state_path = workspace.path / CONFIG_DIR_NAME / UI_STATE_FILE

    # Service
    # ----------------------------------------------------------------------------------------------

    def get(self, session_id: str | None = None) -> UIState:
        """Get UI state for global and session-specific data."""

        _, virtual = self._load(session_id)

        return UIState(global_state=virtual["global"], session_state=virtual["session"])

    def patch(self, session_id: str | None, **data) -> UIState:
        """Apply operations to global and session-specific UI state."""

        if "session" in data and not session_id:
            raise ValueError("session_id required when patching session")

        with FileLock(self._state_path.with_suffix(".lock")):
            physical, virtual = self._load(session_id)

            if "global" in data:
                updated_global = self._apply_operations(virtual["global"], data["global"])
                physical["global"] = virtual["global"] = updated_global

            if "session" in data:
                updated_session = self._apply_operations(virtual["session"], data["session"])
                physical["sessions"][session_id] = virtual["session"] = updated_session

            physical["sessions"] = self._prune_old_sessions(physical["sessions"])

            write_json(self._state_path, physical)

            return UIState(global_state=virtual["global"], session_state=virtual["session"])

    # State Management
    # ----------------------------------------------------------------------------------------------

    def _load(self, session_id: str | None) -> tuple[dict, dict]:
        """Load ui-state.json and split into physical and virtual representations."""

        physical = read_json(self._state_path, default={})

        if "version" not in physical or physical.get("version", 0) < self.VERSION:
            physical = {
                "version": self.VERSION,
                "global": {},
                "sessions": {},
            }

        virtual = {
            "global": physical.get("global", {}),
            "session": self._get_session(session_id, physical),
        }

        return physical, virtual

    def _get_session(self, session_id: str | None, state: dict) -> dict:
        """Resolve session state by id, inheriting from latest if new."""

        sessions = state.get("sessions", {})

        if not session_id:
            return self._get_latest_session(sessions)
        elif session_id in sessions:
            return sessions[session_id]
        else:
            return {}

    @classmethod
    def _get_latest_session(cls, sessions: dict) -> dict:
        """Get full snapshot of the most recent session for inheritance."""

        if not sessions:
            return {}

        _, latest = max(
            sessions.items(),
            key=lambda x: x[1]["updated_at"],
            default=(None, {}),
        )

        return dict(latest)

    # Patch Operations
    # ----------------------------------------------------------------------------------------------

    @classmethod
    def _apply_operations(cls, state: dict, operations: list[dict[str, Any]]) -> dict:
        """Apply a list of operations to state dict and stamp updated_at."""

        for op_def in operations:
            op = op_def.get("op")
            path = op_def.get("path")
            value = op_def.get("value")

            if not op or not path:
                raise ValueError(f"Invalid UI state patch operation: {op_def}")

            parent, key = UIStateService._resolve_path(state, path)

            if op == "set":
                parent[key] = value
            elif op == "unset":
                parent.pop(key, None)
            elif op == "add":
                # Set semantics: add to list if not present
                if key not in parent or not isinstance(parent[key], list):
                    parent[key] = []

                if value not in parent[key]:
                    parent[key].append(value)
            elif op == "append":
                # Array semantics: always append (allows duplicates)
                if key not in parent or not isinstance(parent[key], list):
                    parent[key] = []

                parent[key].append(value)
            elif op == "remove":
                # Remove first occurrence from list
                if key in parent and isinstance(parent[key], list):
                    try:
                        parent[key].remove(value)
                    except ValueError:
                        pass

        state["updated_at"] = datetime.now(UTC).isoformat()

        return state

    @classmethod
    def _resolve_path(cls, state: dict, path: str) -> tuple[dict, str]:
        """Walk dot-path to parent container, creating intermediary dicts."""

        keys = path.split(".")
        current = state

        for key in keys[:-1]:
            if key not in current or not isinstance(current[key], dict):
                current[key] = {}

            current = current[key]

        return current, keys[-1]

    @classmethod
    def _prune_old_sessions(cls, sessions: dict) -> dict:
        """Remove sessions older than expiry threshold."""

        cutoff = datetime.now(UTC) - SESSION_MAX_AGE
        cutoff_iso = cutoff.isoformat()

        return {
            session_id: data
            for session_id, data in sessions.items()
            if data["updated_at"] >= cutoff_iso
        }
