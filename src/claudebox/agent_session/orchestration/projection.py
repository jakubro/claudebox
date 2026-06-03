"""Session projection — aggregate events into session summaries."""

import asyncio
from datetime import UTC, datetime

from .models import PublishedEvent, SessionSummary
from ..runtime_claude import ClaudeRuntime
from ...constants import SESSION_METADATA_FILE
from ...core import serialization
from ...core.io import read_json, write_json
from ...core.logging import get_logger
from ...workspace import Workspace


# Claude Code built-in slash commands — excluded from custom command discovery.
BUILTIN_COMMANDS = frozenset(
    {
        "add-dir",
        "agents",
        "autofix-pr",
        "batch",
        "branch",
        "btw",
        "claude-api",
        "clear",
        "color",
        "compact",
        "config",
        "context",
        "copy",
        "cost",
        "debug",
        "diff",
        "doctor",
        "exit",
        "export",
        "extra-usage",
        "fast",
        "feedback",
        "fewer-permission-prompts",
        "heapdump",
        "help",
        "hooks",
        "ide",
        "init",
        "insights",
        "install-github-app",
        "install-slack-app",
        "login",
        "logout",
        "loop",
        "mcp",
        "memory",
        "mobile",
        "model",
        "passes",
        "permissions",
        "plan",
        "plugin",
        "powerup",
        "privacy-settings",
        "rate-limit-options",
        "reload-plugins",
        "remote-env",
        "rename",
        "resume",
        "review",
        "rewind",
        "sandbox",
        "security-review",
        "setup-bedrock",
        "simplify",
        "skills",
        "stats",
        "status",
        "statusline",
        "stickers",
        "tasks",
        "team-onboarding",
        "teleport",
        "terminal-setup",
        "theme",
        "update-config",
        "upgrade",
        "usage",
        "voice",
    }
)

# Debounce interval for projection saves (seconds).
SAVE_DEBOUNCE_SECONDS = 0.5


class Projection:
    """Running SessionSummary built from events; debounced save to session.json."""

    def __init__(self, session_id: str, workspace: Workspace):
        """Initialize projection, loading existing state or creating new summary."""

        self._logger = get_logger(__name__)

        session = workspace.ensure_session(session_id)
        self._session_id = session.id
        self._session_dir = session.path
        self._workspace = session.workspace.path
        self._path = session.path / SESSION_METADATA_FILE

        self._save_timer: asyncio.TimerHandle | None = None
        self._dirty = False

        data = read_json(self._path, default=None)

        if data:
            self._value = SessionSummary.fromdict(data)
            self._loaded_from_disk = True
        else:
            self._value = SessionSummary(
                session_id=self._session_id,
                session_dir=self._session_dir,
                workspace=self._workspace,
                started_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
                model=None,
                num_turns=0,
                todos=[],
                total_cost_usd=0.0,
                total_duration_ms=0,
                commands={},
            )
            self._loaded_from_disk = False

    # Fields written externally by the daemon (rename, fork) — not tracked via events.
    _DAEMON_OWNED_FIELDS = ("name", "parent_session_id")

    # Properties
    # ----------------------------------------------------------------------------------------------

    @property
    def session_id(self) -> str:
        return self._session_id

    @property
    def value(self) -> SessionSummary:
        """Return current projection, refreshing daemon-owned fields from disk."""

        self._refresh_daemon_fields()
        return self._value

    @property
    def loaded_from_disk(self) -> bool:
        """Whether projection was loaded from an existing session.json."""

        return self._loaded_from_disk

    # Update
    # ----------------------------------------------------------------------------------------------

    def update(self, event: PublishedEvent) -> None:
        """Accumulate fields from a single event into the session summary."""

        self._value.updated_at = datetime.now(UTC)

        if event.is_human:
            self._value.num_turns = (self._value.num_turns or 0) + 1
            if event.content:
                if not self._value.first_message:
                    self._value.first_message = event.content
                self._value.last_message = event.content

        if event.model:
            self._value.model = event.model

        if event.permission_mode:
            self._value.permission_mode = event.permission_mode

        if event.cost_usd:
            self._value.total_cost_usd = (self._value.total_cost_usd or 0) + event.cost_usd

        if event.duration_ms:
            self._value.total_duration_ms = (self._value.total_duration_ms or 0) + event.duration_ms

        if event.context_tokens:
            self._value.last_context_tokens = event.context_tokens

        if event.subtype == "effort_level_changed" and event.content:
            self._value.effort_level = event.content

        if event.tool_input and "todos" in event.tool_input:
            self._value.todos = event.tool_input["todos"]

        if event.message_data and "slash_commands" in event.message_data:
            self._value.commands = self._categorize_commands(event.message_data["slash_commands"])

    def update_fields(self, **kwargs) -> None:
        """Update arbitrary fields and save immediately."""

        if not self._value:
            self._logger.warning("update_fields called before projection initialized")
            return

        # Update only known attributes
        for key, value in kwargs.items():
            if hasattr(self._value, key):
                setattr(self._value, key, value)
            else:
                self._logger.warning("update_fields: ignoring unknown field %r", key)

        self.save()

    # Persistence
    # ----------------------------------------------------------------------------------------------

    def schedule_save(self) -> None:
        """Schedule a debounced save — coalesces rapid updates into a single write."""

        self._dirty = True

        if self._save_timer is not None:
            self._save_timer.cancel()

        loop = asyncio.get_event_loop()
        self._save_timer = loop.call_later(SAVE_DEBOUNCE_SECONDS, self._debounced_save)

    def _debounced_save(self) -> None:
        """Timer callback — kicks off async save."""

        self._save_timer = None
        asyncio.ensure_future(self._async_save())

    async def _async_save(self) -> None:
        """Write projection to disk off the event loop."""

        if not self._dirty:
            return

        self._dirty = False
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._write)

    def _write(self) -> None:
        """Synchronous disk write — called from executor thread."""

        write_json(self._path, self._value)

    def save(self) -> None:
        """Persist projection to disk synchronously (for update_fields and flush)."""

        self._dirty = False

        if self._save_timer is not None:
            self._save_timer.cancel()
            self._save_timer = None

        self._write()

    async def flush(self) -> None:
        """Force-write any pending changes before shutdown."""

        if self._save_timer is not None:
            self._save_timer.cancel()
            self._save_timer = None

        if self._dirty:
            await self._async_save()

    # Helpers
    # ----------------------------------------------------------------------------------------------

    def _refresh_daemon_fields(self) -> None:
        """Re-read session.json from disk and merge daemon-owned fields into memory."""

        if not self._value:
            return

        data = read_json(self._path, default=None)
        if not data:
            return

        for field in self._DAEMON_OWNED_FIELDS:
            disk_value = data.get(field)
            if disk_value != getattr(self._value, field, None):
                setattr(self._value, field, disk_value)

    @classmethod
    def _categorize_commands(cls, commands: list[str]) -> dict[str, list[dict[str, str]]]:
        """Categorize slash commands into custom, mcp, and builtin groups."""

        metadata = {s.name: s for s in ClaudeRuntime.get_skills()}

        rv = {
            "custom": [],
            "mcp": [],
            "builtin": [],
        }

        for cmd in commands:
            if meta := metadata.get(cmd):
                entry = serialization.serialize(meta)
            else:
                entry = {"name": cmd}

            if cmd.startswith("mcp__"):
                rv["mcp"].append(entry)
            elif cmd in BUILTIN_COMMANDS:
                rv["builtin"].append(entry)
            else:
                rv["custom"].append(entry)

        return rv
