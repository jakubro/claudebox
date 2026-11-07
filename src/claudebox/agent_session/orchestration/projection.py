"""Session projection - aggregate events into session summaries."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import UTC, datetime

from .cost import cost_added
from .models import EventSubtype, EventType, PublishedEvent, SessionSummary
from .._needs_user import NEEDS_USER_TOOL_NAMES, first_line, needs_user_replies
from .._ports import PORT_OPEN_TOOL_NAMES, PORT_REFUSAL_PREFIX, is_port
from ..protocol import AgentSession
from ...constants import SESSION_METADATA_FILE
from ...core import serialization
from ...core.io import read_json, write_json
from ...core.logging import get_logger
from ...workspace import Workspace


# Claude Code built-in slash commands - excluded from custom command discovery.
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
    },
)

SAVE_DEBOUNCE_SECONDS = 0.5

# Both runtimes' question-form tool names; plan approval exists only under Claude.
_QUESTION_TOOL_NAMES = frozenset({"AskUserQuestion", "ask_user_question"})
_PLAN_TOOL_NAME = "ExitPlanMode"
_BASH_TOOL_NAMES = frozenset({"Bash", "bash"})


class Projection:
    """Running SessionSummary built from events; debounced save to session.json."""

    def __init__(
        self,
        session_id: str,
        workspace: Workspace,
        runtime: AgentSession | None = None,
        provider: str | None = None,
    ):
        """Initialize projection, loading existing state or creating a new summary.
        `runtime` feeds `_categorize_commands` skill metadata; None only for throwaway projections.
        `provider` is LangGraph's `provider:model` prefix; None under Claude, fresh summaries only.
        """

        self._logger = get_logger(__name__)
        self._runtime = runtime

        session = workspace.ensure_session(session_id)
        self._session_id = session.id
        self._session_dir = session.path
        self._workspace = session.workspace.path
        self._path = session.path / SESSION_METADATA_FILE

        self._save_timer: asyncio.TimerHandle | None = None
        self._dirty = False
        self._port_request: str | None = None

        # Background work since the last container restart, as the browser's own rule counts it.
        self._bash_tool_uses: set[str] = set()
        self._launched: set[str] = set()
        self._notified: set[str] = set()

        data = read_json(self._path, default=None) or {}

        # The daemon may stamp a new session before its first save; that alone is not a session.
        if not set(data) <= {*self._DAEMON_OWNED_FIELDS, *self._SEEDED_FIELDS}:
            self._value = SessionSummary.fromdict(data)
            self._loaded_from_disk = True
        else:
            self._value = SessionSummary(
                session_id=self._session_id,
                fork_point_cost_usd=0.0,
                session_dir=str(self._session_dir),
                workspace=self._workspace,
                started_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
                model=None,
                # Stamped once at creation; a later runtime change must surface as a mismatch.
                runtime=runtime.runtime_name if runtime else None,
                provider=provider,
                session_prompt=data.get("session_prompt"),
                num_turns=0,
                todos=[],
                total_cost_usd=0.0,
                total_duration_ms=0,
                commands={},
            )
            self._loaded_from_disk = False

    # Fields written outside the projection (rename, fork, spawn, promotion) - not tracked via events.
    _DAEMON_OWNED_FIELDS = (
        "name",
        "parent_session_id",
        "is_side_thread",
        "is_promoted",
        "spawned_from_session_id",
        "bundle",
    )

    # Starting values the daemon may write before the first save; the container owns them after.
    _SEEDED_FIELDS = ("session_prompt",)

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

    def update(self, event: PublishedEvent) -> bool:
        """Accumulate fields from a single event into the session summary; True when `activity` changed."""

        activity = self._value.activity
        self._value.updated_at = datetime.now(UTC)

        if event.is_human and event.parent_tool_use_id is None:
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
            added = cost_added(
                event.cost_usd,
                self._value.last_result_cost_usd,
                runtime=self._runtime.runtime_name if self._runtime else self._value.runtime,
            )
            self._value.total_cost_usd = (self._value.total_cost_usd or 0) + added
            self._value.last_result_cost_usd = event.cost_usd

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

        # Subagent prompts and tool calls arrive nested under a tool; only the session's own count.
        if event.parent_tool_use_id is None:
            if event.is_human:
                self._value.needs_user = None
                self._value.needs_user_replies = None
            elif (reason := _needs_user_reason(event)) and self._may_need_user():
                self._value.needs_user = reason
                self._value.needs_user_replies = _needs_user_replies(event)
                self._port_request = (
                    event.tool_use_id if event.tool_name in PORT_OPEN_TOOL_NAMES else None
                )
            elif event.tool_use_id == self._port_request and _failed_tool_result(event):
                self._value.needs_user = None
                self._value.needs_user_replies = None

            self._fold_activity(event)

        return self._value.activity != activity

    def seed_background_work(self, history: Sequence[PublishedEvent]) -> None:
        """Take the background work still open from `history` since its last container restart."""

        restarts = [i for i, event in enumerate(history) if _is_restart(event)]
        self._reset_background_work()

        for event in history[restarts[-1] + 1 if restarts else 0 :]:
            if event.parent_tool_use_id is None:
                self._track_background_work(event)

    def seed_last_result_cost(self, history: Sequence[PublishedEvent]) -> None:
        """Take the cost baseline from `history` if the record has none - a fork's never does."""

        if self._value.last_result_cost_usd is not None:
            return

        self._value.last_result_cost_usd = next(
            (event.cost_usd for event in reversed(history) if event.cost_usd),
            None,
        )

    def update_fields(self, **kwargs) -> None:
        """Update arbitrary fields and save immediately."""

        if not self._value:
            self._logger.warning("update_fields called before projection initialized")

            return

        for key, value in kwargs.items():
            if hasattr(self._value, key):
                setattr(self._value, key, value)
            else:
                self._logger.warning("update_fields: ignoring unknown field %r", key)

        self.save()

    # Persistence
    # ----------------------------------------------------------------------------------------------

    def schedule_save(self) -> None:
        """Schedule a debounced save - coalesces rapid updates into a single write."""

        self._dirty = True

        if self._save_timer is not None:
            self._save_timer.cancel()

        loop = asyncio.get_event_loop()
        self._save_timer = loop.call_later(SAVE_DEBOUNCE_SECONDS, self._debounced_save)

    def _debounced_save(self) -> None:
        """Timer callback - kicks off async save."""

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
        """Synchronous disk write - called from executor thread."""

        # Daemon-owned fields live on disk only, so a snapshot taken without them reverts a rename.
        self._refresh_daemon_fields()

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

    def _fold_activity(self, event: PublishedEvent) -> None:
        if _is_restart(event):
            self._reset_background_work()
            self._value.activity = None

            return

        self._track_background_work(event)

        if (
            (event.type == EventType.USER and event.is_human)
            or event.type == EventType.ASSISTANT
            or event.subtype in (EventSubtype.TASK_NOTIFICATION, EventSubtype.SIBLING_MESSAGE)
        ):
            self._value.activity = "working"
        elif event.type == EventType.RESULT or (
            event.type == EventType.SYSTEM and event.subtype == EventSubtype.ERROR
        ):
            self._value.activity = "waiting" if self._launched - self._notified else None

    def _track_background_work(self, event: PublishedEvent) -> None:
        if event.subtype == EventSubtype.TOOL_USE:
            if event.content in _BASH_TOOL_NAMES and event.tool_use_id:
                self._bash_tool_uses.add(event.tool_use_id)
        elif event.subtype == EventSubtype.TASK_NOTIFICATION:
            if task_id := (event.message_data or {}).get("task_id"):
                self._notified.add(task_id)
        elif event.subtype == EventSubtype.TOOL_RESULT:
            result = event.tool_use_result or {}
            from_bash = event.tool_use_id in self._bash_tool_uses
            self._bash_tool_uses.discard(event.tool_use_id)

            if from_bash and isinstance(result.get("backgroundTaskId"), str):
                self._launched.add(result["backgroundTaskId"])
            elif (result.get("isAsync") or result.get("status") == "async_launched") and isinstance(
                result.get("agentId"),
                str,
            ):
                self._launched.add(result["agentId"])

    def _reset_background_work(self) -> None:
        self._bash_tool_uses.clear()
        self._launched.clear()
        self._notified.clear()

    def _may_need_user(self) -> bool:
        """Spawned sessions and side threads ask elsewhere; lineage is re-read from disk first."""

        self._refresh_daemon_fields()

        return not (self._value.spawned_from_session_id or self._value.is_side_thread)

    def _categorize_commands(self, commands: list[str]) -> dict[str, list[dict[str, str]]]:
        """Categorize slash commands into custom, mcp, and builtin groups.

        Skill metadata comes from the active runtime's `get_skills()`; a throwaway projection (no
        runtime) falls back to name-only entries, though this method is normally only reached during
        live `update()` flows where a runtime is always present.
        """

        if self._runtime is not None:
            metadata = {s.name: s for s in self._runtime.get_skills()}
        else:
            self._logger.warning("_categorize_commands called without a runtime; metadata empty")
            metadata = {}

        rv: dict[str, list[dict[str, str]]] = {
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


def _is_restart(event: PublishedEvent) -> bool:
    return event.type == EventType.SYSTEM and event.subtype == EventSubtype.CONTAINER_RESTARTED


def _needs_user_reason(event: PublishedEvent) -> str | None:
    """Return why a tool use leaves the session needing the user, or None when it does not.

    A form counts only when it would show: a question needs a non-empty list, a plan needs its text.
    """

    tool_input = event.tool_input or {}

    if event.subtype != "tool_use":
        return None
    elif event.tool_name in NEEDS_USER_TOOL_NAMES:
        return first_line(tool_input.get("reason")) or "Needs you"
    elif event.tool_name in _QUESTION_TOOL_NAMES:
        return _question_reason(tool_input.get("questions"))
    elif event.tool_name in PORT_OPEN_TOOL_NAMES and is_port(port := tool_input.get("port")):
        return f"Approve: open port {port}"
    elif (
        event.tool_name == _PLAN_TOOL_NAME
        and isinstance(plan := tool_input.get("plan"), str)
        and plan
    ):
        return "Approve the plan"
    else:
        return None


def _failed_tool_result(event: PublishedEvent) -> bool:
    return event.subtype == "tool_result" and bool(
        event.is_error or str(event.content or "").startswith(PORT_REFUSAL_PREFIX),
    )


def _question_reason(questions: object) -> str | None:
    """Name the first question's text, else its header; None when no form would show."""

    if not isinstance(questions, list) or not questions:
        return None

    first = questions[0] if isinstance(questions[0], dict) else {}

    return (
        first_line(first.get("question")) or first_line(first.get("header")) or "Answer a question"
    )


def _needs_user_replies(event: PublishedEvent) -> list[str] | None:
    """Replies a needs_user call offers; a form or a call without any leaves None."""

    if event.tool_name not in NEEDS_USER_TOOL_NAMES:
        return None

    replies, _ = needs_user_replies((event.tool_input or {}).get("replies"))

    return replies or None
