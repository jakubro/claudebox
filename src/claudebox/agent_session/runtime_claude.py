"""ClaudeRuntime - AgentSession adapter wrapping claude_agent_sdk's BaseClaudeSDKClient.

Composition (not inheritance) - `_sdk` holds the SDK client; methods forward
explicitly. This is the only file in claudebox/ that imports `claude_agent_sdk`;
the import is enforced via ruff (see GUIDELINES §SDK Containment).
"""

import asyncio
import dataclasses
import json
import logging
import shutil
import time
from collections import deque
from collections.abc import AsyncIterator
from typing import Any, Protocol

from claude_agent_sdk import (
    AssistantMessage as SdkAssistantMessage,
)
from claude_agent_sdk import (
    ClaudeAgentOptions,
    HookMatcher,
)
from claude_agent_sdk import (
    ClaudeSDKClient as BaseClaudeSDKClient,
)
from claude_agent_sdk import (
    RateLimitEvent as SdkRateLimitEvent,
)
from claude_agent_sdk import (
    ResultMessage as SdkResultMessage,
)
from claude_agent_sdk import (
    SystemMessage as SdkSystemMessage,
)
from claude_agent_sdk import (
    TextBlock as SdkTextBlock,
)
from claude_agent_sdk import (
    ThinkingBlock as SdkThinkingBlock,
)
from claude_agent_sdk import (
    ToolResultBlock as SdkToolResultBlock,
)
from claude_agent_sdk import (
    ToolUseBlock as SdkToolUseBlock,
)
from claude_agent_sdk import (
    UserMessage as SdkUserMessage,
)

from ._skills import walk_skills
from .catalogs import ContextUsage, EffortLevel, Model, PermissionMode, Skill
from .config import ClaudeAgentSessionConfig, RuntimeCapabilities
from .events import (
    AgentEvent,
    AssistantMessagePayload,
    ContentBlock,
    McpServerInit,
    RateLimitPayload,
    ResultPayload,
    SystemInitData,
    SystemInitPayload,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UnknownBlock,
    UserMessagePayload,
)
from .hooks import (
    CompactStartPayload,
    HookCallbacks,
    PostToolUsePayload,
    PreToolUsePayload,
)
from ..constants import claude_settings_file
from ..core.fs import touch_dir
from ..core.io import read_json, write_json
from ..core.logging import get_logger


LOG_LEVELS = logging.getLevelNamesMapping()

# Module-level logger for classmethod paths (instance loggers unreachable).
_logger = get_logger(__name__)


# SDK init data keys recognised at the pinned version. Unknown keys raise; a new
# SDK release adding fields requires an explicit ticket to extend SystemInitData
# and update this set - the fail-loud signal is by design.
KNOWN_INIT_FIELDS: frozenset[str] = frozenset(
    {f.name for f in dataclasses.fields(SystemInitData)}
    | {"type", "subtype", "session_id", "model"}
)


class ToolInputValidator(Protocol):
    """Per-tool input validator contract for the TOOL_INPUT_VALIDATORS registry."""

    def __call__(self, tool_use_id: str, input_data: dict[str, Any]) -> dict[str, Any]: ...


def _validate_ask_user_question(tool_use_id: str, input_data: dict[str, Any]) -> dict[str, Any]:
    """Coerce and validate AskUserQuestion `questions` payload.

    Two failure modes seen in the wild: (1) `questions` arrives as a
    JSON-encoded string instead of a list - recoverable via `json.loads`;
    (2) `questions` is some other non-list value - unrecoverable.

    On (1) the field is repaired silently with a warn log so the upstream
    regression is visible. On (2) the field is dropped with an error log so
    downstream consumers (which all expect a list) degrade gracefully rather
    than crash on `.map()` / iteration.
    """

    raw = input_data.get("questions")

    if isinstance(raw, list):
        return input_data

    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            _logger.error(
                "askuser_questions_unparseable_string",
                tool_use_id=tool_use_id,
                error=str(exc),
            )
            repaired = dict(input_data)
            repaired["questions"] = []

            return repaired

        if isinstance(parsed, list):
            _logger.warning(
                "askuser_questions_coerced_from_string",
                tool_use_id=tool_use_id,
            )
            repaired = dict(input_data)
            repaired["questions"] = parsed

            return repaired

        _logger.error(
            "askuser_questions_coerced_but_not_list",
            tool_use_id=tool_use_id,
            type=type(parsed).__name__,
        )
        repaired = dict(input_data)
        repaired["questions"] = []

        return repaired

    # Missing or other non-list shape (dict, number, bool, None).
    if raw is not None:
        _logger.error(
            "askuser_questions_not_list",
            tool_use_id=tool_use_id,
            type=type(raw).__name__,
        )

    repaired = dict(input_data)
    repaired["questions"] = []

    return repaired


# Per-tool-name input validators run at the SDK -> typed-payload boundary.
# Each entry's signature is `(tool_use_id: str, input_data: dict) -> dict` and
# must return the (possibly repaired) dict. Tools not in the registry pass
# through verbatim.
TOOL_INPUT_VALIDATORS: dict[str, ToolInputValidator] = {
    "AskUserQuestion": _validate_ask_user_question,
}


class ClaudeRuntime:
    """AgentSession adapter for the Claude Code SDK.

    Composes (does not subclass) `BaseClaudeSDKClient` via `self._sdk`. Owns
    the pre-connect query buffer, the per-session settings.json symlink, the
    effort-level side-channel write, and the SDK compact-trigger taxonomy
    translation.
    """

    runtime_name: str = "Claude"

    # PreCompact SDK trigger -> claudebox compact_metadata.trigger.
    SDK_COMPACT_TRIGGER_MAP = {"auto": "context_limit", "manual": "manual"}

    DEFAULT_MODEL = "claude-opus-4-8"
    DEFAULT_CONTEXT_WINDOW = 1_000_000
    DEFAULT_EFFORT_LEVEL = "xhigh"
    DEFAULT_PERMISSION_MODE = "default"

    CAPABILITIES = RuntimeCapabilities(
        supports_set_model_mid_session=True,
        supports_set_permission_mode=True,
        supports_set_effort_level=True,
        supports_pre_compact_hook=True,
        supports_mcp_delegation=True,
        supports_models=True,
        supports_effort_levels=True,
        supports_permission_modes=True,
        supports_skills=True,
        supports_context_usage=True,
        supports_cost_telemetry=True,
        supports_manual_compact=True,
        supports_session_resume=True,
        supports_session_fork=True,
        supports_session_rewind=True,
        supports_ask_user_question=True,
    )

    AVAILABLE_MODELS = [
        Model(id="claude-fable-5", name="Fable 5", context_window=1_000_000),
        Model(id="claude-mythos-5", name="Mythos 5", context_window=1_000_000),
        Model(id="claude-opus-4-8", name="Opus 4.8", context_window=1_000_000),
        Model(id="claude-opus-4-7", name="Opus 4.7", context_window=200_000),
        Model(id="claude-opus-4-6", name="Opus 4.6", context_window=200_000),
        Model(id="claude-sonnet-4-6", name="Sonnet 4.6", context_window=200_000),
        Model(id="claude-haiku-4-5-20251001", name="Haiku 4.5", context_window=200_000),
    ]

    AVAILABLE_EFFORT_LEVELS = [
        EffortLevel(id="max", name="Max"),
        EffortLevel(id="xhigh", name="XHigh"),
        EffortLevel(id="high", name="High"),
        EffortLevel(id="medium", name="Medium"),
        EffortLevel(id="low", name="Low"),
    ]

    AVAILABLE_PERMISSION_MODES = [
        PermissionMode(id="default", name="Default", description="Standard permission behavior"),
        PermissionMode(id="plan", name="Plan", description="Planning mode"),
        PermissionMode(id="acceptEdits", name="Accept Edits", description="Auto-accept file edits"),
        PermissionMode(
            id="bypassPermissions", name="Bypass", description="Bypass permission checks"
        ),
        PermissionMode(
            id="dontAsk", name="Don't Ask", description="Allow all tools without prompting"
        ),
        PermissionMode(
            id="auto", name="Auto", description="Automatically determine permission mode"
        ),
    ]

    def __init__(self, config: ClaudeAgentSessionConfig) -> None:
        """Initialize with a typed config; build the SDK client via composition."""

        self._config = config
        self._logger = get_logger(__name__)

        options = self._build_sdk_options(config)
        options.stderr = self._stderr
        # Hooks built post-options so adapters bind to this instance -
        # SDK hooks dict carries bound-method adapters that translate SDK
        # HookInput shapes into the typed HookCallbacks surface.
        options.hooks = self._build_sdk_hooks(self)
        self._sdk = BaseClaudeSDKClient(options)

        # Last value seen on the corresponding setter / SDK detector; gates
        # `_fire_*_changed` callbacks against first-call baseline + no-op writes.
        self._last_known_model: str | None = None
        self._last_known_permission_mode: str | None = None
        self._last_known_effort_level: str | None = None

        # Pre-connect buffering - queries and pending control-plane calls drain
        # in `_flush_on_ready` once `connect()` returns.
        self.ready = asyncio.Event()
        self._buffer: deque[str | list[dict]] = deque()
        self._pending_calls: deque[tuple[str, tuple, dict]] = deque()
        self._flush_task: asyncio.Task | None = None

        # Per-tool_use_id start time - PreToolUse pushes `time.monotonic()`;
        # PostToolUse / PostToolUseFailure pop and compute duration_ms. Missing
        # keys (callback unregistered, mid-restart) fall back to 0.
        self._tool_started_at: dict[str, float] = {}

    @property
    def capabilities(self) -> RuntimeCapabilities:
        """Static support matrix for this runtime - all features supported."""

        return self.CAPABILITIES

    # Connection lifecycle
    # ----------------------------------------------------------------------------------------------

    async def connect(self) -> None:
        """Establish SDK connection, isolate settings.json, signal readiness."""

        self._isolate_settings_file()
        self._flush_task = asyncio.create_task(self._flush_on_ready())
        await self._sdk.connect()
        self.ready.set()

    async def disconnect(self) -> None:
        """Close SDK connection and reset internal state."""

        try:
            await self._sdk.disconnect()
        finally:
            if self._flush_task:
                self._flush_task.cancel()
                self._flush_task = None

            self._buffer.clear()
            self._pending_calls.clear()
            self.ready.clear()

    # Queries
    # ----------------------------------------------------------------------------------------------

    async def query(self, prompt: str | list[dict]) -> None:
        """Send query to SDK or buffer if not ready.

        String prompts go through the SDK's string path; structured content
        blocks (list of dicts) are wrapped in a transport message and sent via
        the SDK's async-iterable path.
        """

        if self.ready.is_set():
            if isinstance(prompt, str):
                await self._sdk.query(prompt)
            else:
                await self._sdk.query(self._content_blocks_stream(prompt))
        else:
            self._buffer.append(prompt)

    async def interrupt(self) -> None:
        """Interrupt SDK or clear pre-connect buffer."""

        if self.ready.is_set():
            await self._sdk.interrupt()
        else:
            self._buffer.clear()

    async def set_model(self, model: str | None = None) -> None:
        """Set model for subsequent queries. Queued if not ready.

        Fires `_fire_model_changed` after the SDK mutation; the helper gates
        `on_model_changed` against the cached previous value.
        """

        if self.ready.is_set():
            await self._sdk.set_model(model)

            if model is not None:
                await self._fire_model_changed(model)
        else:
            self._pending_calls.append(("set_model", (model,), {}))

    async def set_permission_mode(self, mode: str) -> None:
        """Set permission mode for subsequent queries. Queued if not ready.

        Converges with the PostToolUse adapter on `_fire_permission_mode_changed`
        so both setter and SDK-detected paths go through one delta filter.
        """

        if self.ready.is_set():
            await self._sdk.set_permission_mode(mode)  # ty: ignore[invalid-argument-type]
            await self._fire_permission_mode_changed(mode)
        else:
            self._pending_calls.append(("set_permission_mode", (mode,), {}))

    async def set_effort_level(self, level: str) -> None:
        """Set effort level by writing effortLevel to ~/.claude/settings.json.

        The SDK has no set_effort control-plane subtype; the CLI re-reads
        settings.json on every query, so writing there propagates the change.
        """

        if self.ready.is_set():
            self._write_effort_to_settings(level)
            await self._fire_effort_level_changed(level)
        else:
            self._pending_calls.append(("set_effort_level", (level,), {}))

    async def reconnect_mcp_server(self, server_name: str) -> None:
        """Reconnect an MCP server. Queued if not ready."""

        if self.ready.is_set():
            await self._sdk.reconnect_mcp_server(server_name)
        else:
            self._pending_calls.append(("reconnect_mcp_server", (server_name,), {}))

    async def toggle_mcp_server(self, server_name: str, enabled: bool) -> None:
        """Toggle an MCP server enabled/disabled. Queued if not ready."""

        if self.ready.is_set():
            await self._sdk.toggle_mcp_server(server_name, enabled)
        else:
            self._pending_calls.append(("toggle_mcp_server", (server_name, enabled), {}))

    async def get_mcp_status(self) -> dict:
        """Return current MCP server status. Empty shape if not ready."""

        if self.ready.is_set():
            return await self._sdk.get_mcp_status()  # ty: ignore[invalid-return-type]

        return {"mcpServers": []}

    async def get_context_usage(self) -> ContextUsage | None:
        """Return current context-window usage. None if not ready or no data."""

        if not self.ready.is_set():
            return None

        usage = await self._sdk.get_context_usage()

        if not usage:
            return None

        total = usage.get("totalTokens")
        maximum = usage.get("maxTokens")

        if total is None or maximum is None:
            return None

        return ContextUsage(used_tokens=total, max_tokens=maximum)

    async def receive_events(self) -> AsyncIterator[AgentEvent]:
        """Yield SDK-free AgentEvents projected from the live SDK response stream."""

        async for msg in self._sdk.receive_response():
            yield self._translate_sdk_message(msg)

    @classmethod
    def _translate_sdk_message(cls, message) -> AgentEvent:
        """Project an SDK message into a runtime-neutral AgentEvent with a typed payload.

        Dispatches by ``isinstance`` against the SDK message classes so the
        type-checker narrows ``message`` to the concrete class on each branch.
        Unknown classes raise - loud failure is the right signal for an SDK
        contract change.
        """

        if isinstance(message, SdkSystemMessage):
            data = getattr(message, "data", {}) or {}
            unknown_keys = set(data.keys()) - KNOWN_INIT_FIELDS

            if unknown_keys:
                raise ValueError(
                    f"Unknown SDK init data fields: {sorted(unknown_keys)}. "
                    f"Extend SystemInitData + KNOWN_INIT_FIELDS to consume."
                )

            init_data = SystemInitData(
                agents=data.get("agents") or [],
                analytics_disabled=bool(data.get("analytics_disabled", False)),
                apiKeySource=data.get("apiKeySource"),
                claude_code_version=data.get("claude_code_version"),
                cwd=data.get("cwd"),
                fast_mode_state=data.get("fast_mode_state"),
                mcp_servers=[
                    McpServerInit(name=s.get("name", ""), status=s.get("status", ""))
                    for s in (data.get("mcp_servers") or [])
                    if isinstance(s, dict)
                ],
                memory_paths=data.get("memory_paths") or {},
                output_style=data.get("output_style"),
                permissionMode=data.get("permissionMode"),
                plugins=data.get("plugins") or [],
                product_feedback_disabled=bool(data.get("product_feedback_disabled", False)),
                skills=data.get("skills") or [],
                slash_commands=data.get("slash_commands") or [],
                tools=data.get("tools") or [],
                uuid=data.get("uuid"),
            )

            return AgentEvent(
                kind="system_init",
                payload=SystemInitPayload(
                    subtype=getattr(message, "subtype", ""),
                    session_id=data.get("session_id", ""),
                    model=data.get("model"),
                    data=init_data,
                ),
            )

        if isinstance(message, SdkUserMessage):
            return AgentEvent(
                kind="user_message",
                payload=UserMessagePayload(
                    uuid=getattr(message, "uuid", None),
                    content=cls._translate_content(getattr(message, "content", None)),
                    tool_use_result=getattr(message, "tool_use_result", None),
                    parent_tool_use_id=getattr(message, "parent_tool_use_id", None),
                ),
            )

        if isinstance(message, SdkAssistantMessage):
            content = cls._translate_content(getattr(message, "content", None))
            # AssistantMessagePayload.content is list[ContentBlock]; SDK assistant
            # messages always carry a block list, but coerce defensively.
            blocks = content if isinstance(content, list) else []

            return AgentEvent(
                kind="assistant_message",
                payload=AssistantMessagePayload(
                    uuid=getattr(message, "uuid", None),
                    content=blocks,
                    model=getattr(message, "model", None),
                    parent_tool_use_id=getattr(message, "parent_tool_use_id", None),
                ),
            )

        if isinstance(message, SdkResultMessage):
            return AgentEvent(
                kind="result",
                payload=ResultPayload(
                    subtype=getattr(message, "subtype", ""),
                    result=getattr(message, "result", None),
                    total_cost_usd=getattr(message, "total_cost_usd", None),
                    duration_ms=getattr(message, "duration_ms", None),
                    num_turns=getattr(message, "num_turns", None),
                    session_id=getattr(message, "session_id", None),
                    is_error=getattr(message, "is_error", None),
                ),
            )

        if isinstance(message, SdkRateLimitEvent):
            info = getattr(message, "rate_limit_info", None)

            return AgentEvent(
                kind="rate_limit",
                payload=RateLimitPayload(
                    status=getattr(info, "status", None),
                    resets_at=getattr(info, "resets_at", None),
                    rate_limit_type=getattr(info, "rate_limit_type", None),
                    utilization=getattr(info, "utilization", None),
                ),
            )

        raise ValueError(f"Unknown SDK message type: {type(message).__name__}")

    @classmethod
    def _translate_content(cls, content) -> str | list[ContentBlock]:
        """Translate SDK message content (str or block list) into runtime-neutral form.

        String content passes through; block lists are walked and each SDK block
        class is dispatched via ``isinstance`` to the matching ContentBlock
        dataclass. Unknown block classes are preserved as ``UnknownBlock`` and a
        warning is logged - wire-shape continuity beats silent data loss.
        """

        if content is None:
            return ""

        if isinstance(content, str):
            return content

        blocks: list[ContentBlock] = []

        for sdk_block in content:
            if isinstance(sdk_block, SdkTextBlock):
                blocks.append(TextBlock(text=sdk_block.text))
            elif isinstance(sdk_block, SdkThinkingBlock):
                blocks.append(ThinkingBlock(thinking=sdk_block.thinking))
            elif isinstance(sdk_block, SdkToolUseBlock):
                input_data = dict(sdk_block.input or {})
                validator = TOOL_INPUT_VALIDATORS.get(sdk_block.name)

                if validator is not None:
                    input_data = validator(sdk_block.id, input_data)

                blocks.append(
                    ToolUseBlock(
                        id=sdk_block.id,
                        name=sdk_block.name,
                        input=input_data,
                    )
                )
            elif isinstance(sdk_block, SdkToolResultBlock):
                blocks.append(
                    ToolResultBlock(
                        tool_use_id=sdk_block.tool_use_id,
                        content=sdk_block.content,
                        is_error=sdk_block.is_error,
                    )
                )
            else:
                class_name = type(sdk_block).__name__
                _logger.warning("unknown_sdk_block_class", class_name=class_name)

                if dataclasses.is_dataclass(sdk_block):
                    raw = dataclasses.asdict(sdk_block)
                else:
                    raw = {k: v for k, v in vars(sdk_block).items() if not k.startswith("_")}

                blocks.append(UnknownBlock(class_name=class_name, data=raw))

        return blocks

    # Catalog accessors
    # ----------------------------------------------------------------------------------------------

    @classmethod
    def get_models(cls) -> list[Model]:
        """Return the available models catalog."""

        return list(cls.AVAILABLE_MODELS)

    @classmethod
    def get_effort_levels(cls) -> list[EffortLevel]:
        """Return the available effort levels catalog."""

        return list(cls.AVAILABLE_EFFORT_LEVELS)

    @classmethod
    def get_permission_modes(cls) -> list[PermissionMode]:
        """Return the available permission modes catalog."""

        return list(cls.AVAILABLE_PERMISSION_MODES)

    @classmethod
    def get_default_model(cls) -> str:
        """Return the default model id."""

        return cls.DEFAULT_MODEL

    @classmethod
    def get_default_effort_level(cls) -> str:
        """Return the default effort level id."""

        return cls.DEFAULT_EFFORT_LEVEL

    @classmethod
    def get_default_permission_mode(cls) -> str:
        """Return the default permission mode id."""

        return cls.DEFAULT_PERMISSION_MODE

    @classmethod
    def get_model_context_window(cls, model_id: str) -> int:
        """Return context window size for model_id, falling back to DEFAULT_CONTEXT_WINDOW."""

        for model in cls.AVAILABLE_MODELS:
            if model.id == model_id:
                return model.context_window

        return cls.DEFAULT_CONTEXT_WINDOW

    @classmethod
    def get_skills(
        cls,
        commands_dir=None,
        skills_dir=None,
    ) -> list[Skill]:
        """Walk profile directories for SKILL.md and return parsed Skills.

        Defaults to in-container bind-mount paths; daemon callers pass
        profile-relative paths explicitly. Delegates to the shared
        runtime-neutral walker so both ClaudeRuntime and LangGraphRuntime
        produce identical catalogs against the same filesystem.
        """

        return walk_skills(commands_dir=commands_dir, skills_dir=skills_dir)

    @classmethod
    def _build_sdk_options(cls, cfg: ClaudeAgentSessionConfig) -> ClaudeAgentOptions:
        """Build SDK options from a typed config."""

        extra_args: dict = {"replay-user-messages": None}

        if cfg.resume_session_id:
            extra_args["resume"] = cfg.resume_session_id
        elif cfg.session_id:
            extra_args["session-id"] = cfg.session_id

        if cfg.debug_mode:
            extra_args["debug-to-stderr"] = None

        extra_args.update(cfg.sdk_passthrough)

        return ClaudeAgentOptions(
            system_prompt=cfg.system_prompt,
            permission_mode=cfg.permission_mode,  # ty: ignore[invalid-argument-type]
            setting_sources=cfg.setting_sources,  # ty: ignore[invalid-argument-type]
            env=cfg.env,
            cwd=cfg.cwd,
            extra_args=extra_args,
            max_buffer_size=cfg.max_buffer_size,
        )

    def _isolate_settings_file(self) -> None:
        """Symlink ~/.claude/settings.json to a per-session file.

        Containers in the same workspace share the host mount of ~/.claude/;
        without isolation, concurrent sessions would overwrite each other's
        settings (model, permission, effort). The symlink scopes SDK
        reads/writes to {session_dir}/claude.json while keeping the rest of
        ~/.claude/ (auth tokens, history, MCP state) shared.

        Seeds the per-session file from the current settings.json target when
        missing; preserves an existing per-session file on resume so prior
        runtime changes survive container restart.
        """

        src = self._config.session_dir / "claude.json"
        dst = claude_settings_file()

        if not src.exists():
            if dst.exists():
                shutil.copy(dst, src)
            else:
                src.touch()

        if dst.is_symlink() or dst.exists():
            dst.unlink()

        dst.symlink_to(src)

    @classmethod
    def _write_effort_to_settings(cls, level: str) -> None:
        """Write effortLevel to ~/.claude/settings.json."""

        path = claude_settings_file()

        try:
            settings = read_json(path, default={})
        except (ValueError, OSError):
            settings = {}

        settings["effortLevel"] = level

        touch_dir(path.parent)
        write_json(path, settings)

    def _stderr(self, line: str) -> None:
        """Parse SDK log line and route to the appropriate logger level, tagged as agent stderr.

        The ``source="agent"`` and ``stream="stderr"`` kvs flow through structlog
        into the broadcast log handler's event dict so ``claudebox logs`` can
        distinguish agent records from container API records.
        """

        try:
            _timestamp, level_str, message = line.split(" ", 2)
        except ValueError:
            self._logger.info(line, source="agent", stream="stderr")
        else:
            level_name = level_str.strip("[]").upper()
            level = LOG_LEVELS.get(level_name, logging.INFO)
            self._logger.log(level, message, source="agent", stream="stderr")

    @classmethod
    async def _content_blocks_stream(cls, content_blocks: list[dict]) -> AsyncIterator[dict]:
        """Yield a single transport message wrapping structured content blocks."""

        yield {
            "type": "user",
            "message": {"role": "user", "content": content_blocks},
            "parent_tool_use_id": None,
        }

    async def _flush_on_ready(self) -> None:
        """Drain pending control-plane calls and buffered queries after connect."""

        await self.ready.wait()

        while self._pending_calls:
            method, args, kwargs = self._pending_calls.popleft()
            func = getattr(self, method)
            await func(*args, **kwargs)

        while self._buffer:
            prompt = self._buffer.popleft()
            await self.query(prompt)

    # Delta-detection state machine
    # ----------------------------------------------------------------------------------------------
    #
    # Each `_fire_X_changed` updates the cached `_last_known_X` and invokes
    # `cfg.hooks.on_X_changed` iff (a) a previous baseline was established AND
    # (b) the new value differs from it. The first call after construction
    # silently adopts the baseline.
    #
    # Setter-driven changes (set_model etc.) and SDK-detected drift
    # (PostToolUse-as-permission-mode-detector adapter) converge on these
    # helpers so a single delta filter governs both paths.

    async def _fire_model_changed(self, new_model: str) -> None:
        """Fire on_model_changed if previous baseline established and value differs."""

        if (
            self._last_known_model is not None
            and new_model != self._last_known_model
            and self._config.hooks.on_model_changed is not None
        ):
            await self._config.hooks.on_model_changed(new_model)

        self._last_known_model = new_model

    async def _fire_permission_mode_changed(self, new_mode: str) -> None:
        """Fire on_permission_mode_changed if previous baseline established and value differs."""

        if (
            self._last_known_permission_mode is not None
            and new_mode != self._last_known_permission_mode
            and self._config.hooks.on_permission_mode_changed is not None
        ):
            await self._config.hooks.on_permission_mode_changed(new_mode)

        self._last_known_permission_mode = new_mode

    async def _fire_effort_level_changed(self, new_level: str) -> None:
        """Fire on_effort_level_changed if previous baseline established and value differs."""

        if (
            self._last_known_effort_level is not None
            and new_level != self._last_known_effort_level
            and self._config.hooks.on_effort_level_changed is not None
        ):
            await self._config.hooks.on_effort_level_changed(new_level)

        self._last_known_effort_level = new_level

    # SDK hook adapters - bridge SDK HookMatcher signature to claudebox-typed callbacks
    # ----------------------------------------------------------------------------------------------

    async def _adapt_session_start(self, _input_data, _tool_use_id, _context) -> dict:
        """SDK SessionStart -> on_session_start (no-arg callback)."""

        if self._config.hooks.on_session_start is not None:
            await self._config.hooks.on_session_start()

        return {}

    async def _adapt_pre_compact(self, input_data, _tool_use_id, _context) -> dict:
        """SDK PreCompact -> on_pre_compact(CompactStartPayload).

        Unknown / None triggers default to "manual".
        """

        if self._config.hooks.on_pre_compact is None:
            return {}

        sdk_trigger = input_data.get("trigger") if isinstance(input_data, dict) else None
        translated = (
            self.SDK_COMPACT_TRIGGER_MAP.get(sdk_trigger, sdk_trigger) if sdk_trigger else None
        )
        trigger = translated if translated in ("context_limit", "manual") else "manual"

        await self._config.hooks.on_pre_compact(CompactStartPayload(trigger=trigger))

        return {}

    async def _adapt_pre_tool_use(self, input_data, _tool_use_id, _context) -> dict:
        """SDK PreToolUse -> on_pre_tool_use + start-time bookkeeping.

        Always records a per-tool_use_id start timestamp so PostToolUse can
        compute duration_ms even when on_pre_tool_use is unregistered. The
        typed callback fires only when set.
        """

        if not isinstance(input_data, dict):
            return {}

        tool_use_id = str(input_data.get("tool_use_id") or "")

        if tool_use_id:
            self._tool_started_at[tool_use_id] = time.monotonic()

        if self._config.hooks.on_pre_tool_use is None:
            return {}

        await self._config.hooks.on_pre_tool_use(
            PreToolUsePayload(
                tool_use_id=tool_use_id,
                tool_name=str(input_data.get("tool_name") or ""),
                tool_input=input_data.get("tool_input") or {},
            )
        )

        return {}

    async def _adapt_post_tool_use(self, input_data, _tool_use_id, _context) -> dict:
        """SDK PostToolUse -> permission-mode-drift detector + on_post_tool_use.

        PostToolUse fires on every tool call, so this catches SDK-detected mode
        drift (mode changed by an internal SDK action rather than an explicit
        `set_permission_mode` call) AND projects the SDK payload into the typed
        `on_post_tool_use` callback for downstream observers.
        """

        if not isinstance(input_data, dict):
            return {}

        mode = input_data.get("permission_mode")

        if mode:
            await self._fire_permission_mode_changed(mode)

        if self._config.hooks.on_post_tool_use is not None:
            await self._config.hooks.on_post_tool_use(
                self._build_post_tool_use_payload(input_data, is_error=False)
            )

        return {}

    async def _adapt_post_tool_use_failure(self, input_data, _tool_use_id, _context) -> dict:
        """SDK PostToolUseFailure -> on_post_tool_use with `is_error=True`."""

        if not isinstance(input_data, dict) or self._config.hooks.on_post_tool_use is None:
            return {}

        await self._config.hooks.on_post_tool_use(
            self._build_post_tool_use_payload(input_data, is_error=True)
        )

        return {}

    def _build_post_tool_use_payload(
        self, input_data: dict, *, is_error: bool
    ) -> PostToolUsePayload:
        """Project the SDK input dict into a typed `PostToolUsePayload`."""

        tool_use_id = str(input_data.get("tool_use_id") or "")
        started_at = self._tool_started_at.pop(tool_use_id, None) if tool_use_id else None
        duration_ms = int((time.monotonic() - started_at) * 1000) if started_at is not None else 0

        result = input_data.get("tool_response")

        if isinstance(result, str) or isinstance(result, dict) or result is None:
            tool_use_result: str | dict | None = result
        else:
            tool_use_result = str(result)

        return PostToolUsePayload(
            tool_use_id=tool_use_id,
            tool_name=str(input_data.get("tool_name") or ""),
            tool_input=input_data.get("tool_input") or {},
            tool_use_result=tool_use_result,
            is_error=is_error,
            duration_ms=duration_ms,
        )

    @classmethod
    def _build_sdk_hooks(cls, runtime: "ClaudeRuntime") -> dict:
        """Translate typed HookCallbacks into the SDK's hooks dict shape.

        SessionStart dual-wires the session-start adapter and the
        permission-mode-detector adapter - the latter establishes
        `_last_known_permission_mode` silently from the initial value so the
        next real change fires `on_permission_mode_changed`.

        PreToolUse / PostToolUse / PostToolUseFailure register whenever any
        consumer cares - permission-mode-drift detection (existing) or the
        typed `on_pre_tool_use` / `on_post_tool_use` callbacks (new). The
        adapter bodies guard internally so multiple consumers compose cleanly.
        """

        callbacks = runtime._config.hooks
        hooks: dict[str, list[HookMatcher]] = {}

        sessionstart_hooks: list = []

        if callbacks.on_session_start is not None:
            sessionstart_hooks.append(runtime._adapt_session_start)

        if callbacks.on_permission_mode_changed is not None:
            sessionstart_hooks.append(runtime._adapt_post_tool_use)

        if sessionstart_hooks:
            hooks["SessionStart"] = [HookMatcher(hooks=sessionstart_hooks)]

        if callbacks.on_pre_compact is not None:
            hooks["PreCompact"] = [
                HookMatcher(hooks=[runtime._adapt_pre_compact]),  # ty: ignore[invalid-argument-type]
            ]

        if callbacks.on_pre_tool_use is not None:
            hooks["PreToolUse"] = [
                HookMatcher(hooks=[runtime._adapt_pre_tool_use]),  # ty: ignore[invalid-argument-type]
            ]

        if (
            callbacks.on_permission_mode_changed is not None
            or callbacks.on_post_tool_use is not None
        ):
            hooks["PostToolUse"] = [
                HookMatcher(hooks=[runtime._adapt_post_tool_use]),  # ty: ignore[invalid-argument-type]
            ]

        if callbacks.on_post_tool_use is not None:
            hooks["PostToolUseFailure"] = [
                HookMatcher(hooks=[runtime._adapt_post_tool_use_failure]),  # ty: ignore[invalid-argument-type]
            ]

        return hooks
