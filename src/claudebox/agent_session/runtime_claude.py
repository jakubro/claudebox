"""ClaudeRuntime — AgentSession adapter wrapping claude_agent_sdk's BaseClaudeSDKClient.

Composition (not inheritance) — `_sdk` holds the SDK client; methods forward
explicitly. This is the only file in claudebox/ that imports `claude_agent_sdk`;
the import is enforced via ruff (see GUIDELINES §SDK Containment).
"""

import asyncio
import dataclasses
import logging
import shutil
from collections import deque
from collections.abc import AsyncIterator

import inflection
from claude_agent_sdk import ClaudeAgentOptions, HookMatcher
from claude_agent_sdk import ClaudeSDKClient as BaseClaudeSDKClient
from ruamel.yaml import YAML

from .catalogs import ContextUsage, EffortLevel, Model, PermissionMode, Skill
from .config import ClaudeAgentSessionConfig, RuntimeCapabilities
from .events import AgentEvent
from .hooks import CompactStartPayload, HookCallbacks
from ..constants import claude_commands_dir, claude_settings_file, claude_skills_dir
from ..core.fs import touch_dir
from ..core.io import read_json, write_json
from ..core.logging import get_logger


_yaml = YAML(typ="safe")


LOG_LEVELS = logging.getLevelNamesMapping()


class ClaudeRuntime:
    """AgentSession adapter for the Claude Code SDK.

    Composes (does not subclass) `BaseClaudeSDKClient` via `self._sdk`. Owns
    the pre-connect query buffer, the per-session settings.json symlink, the
    effort-level side-channel write, and the SDK compact-trigger taxonomy
    translation.
    """

    runtime_name: str = "Claude"

    # PreCompact SDK trigger → claudebox compact_metadata.trigger.
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
    )

    AVAILABLE_MODELS = [
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
        # Hooks built post-options so adapters bind to this instance —
        # SDK hooks dict carries bound-method adapters that translate SDK
        # HookInput shapes into the typed HookCallbacks surface.
        options.hooks = self._build_sdk_hooks(self)
        self._sdk = BaseClaudeSDKClient(options)

        # Last value seen on the corresponding setter / SDK detector; gates
        # `_fire_*_changed` callbacks against first-call baseline + no-op writes.
        self._last_known_model: str | None = None
        self._last_known_permission_mode: str | None = None
        self._last_known_effort_level: str | None = None

        # Pre-connect buffering — queries and pending control-plane calls drain
        # in `_flush_on_ready` once `connect()` returns.
        self.ready = asyncio.Event()
        self._buffer: deque[str | list[dict]] = deque()
        self._pending_calls: deque[tuple[str, tuple, dict]] = deque()
        self._flush_task: asyncio.Task | None = None

    @property
    def capabilities(self) -> RuntimeCapabilities:
        """Static support matrix for this runtime — all features supported."""

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
        """Project an SDK message into a runtime-neutral AgentEvent.

        Strips the SDK type via `dataclasses.asdict` and re-injects each
        ContentBlock's class name as `block["type"]` — asdict drops class
        identity that downstream consumers dispatch on.
        """

        kind = inflection.underscore(type(message).__name__).replace("_message", "")
        message_dict = dataclasses.asdict(message)

        # asdict drops class identity; re-inject block type discriminators by
        # mirroring the original sdk_content list onto the dict-projected content.
        content = message_dict.get("content")

        if isinstance(content, list):
            sdk_content = getattr(message, "content", [])
            for i, block in enumerate(content):
                if isinstance(block, dict) and i < len(sdk_content):
                    block["type"] = inflection.underscore(  # ty: ignore[invalid-assignment]
                        type(sdk_content[i]).__name__,
                    ).replace("_block", "")

        return AgentEvent(kind=kind, payload=message_dict)

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
        profile-relative paths explicitly.
        """

        commands_dir = commands_dir or claude_commands_dir()
        skills_dir = skills_dir or claude_skills_dir()

        metadata: dict[str, Skill] = {}

        if commands_dir.is_dir():
            for md_file in commands_dir.glob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                    skill = cls._parse_frontmatter(content, fallback_name=None)
                    if skill:
                        metadata[skill.name] = skill
                except OSError:
                    continue

        if skills_dir.is_dir():
            for skill_dir in skills_dir.iterdir():
                if not skill_dir.is_dir():
                    continue
                skill_file = skill_dir / "SKILL.md"
                if not skill_file.exists():
                    continue
                try:
                    content = skill_file.read_text(encoding="utf-8")
                    skill = cls._parse_frontmatter(content, fallback_name=skill_dir.name)
                    if skill:
                        metadata[skill.name] = skill
                except OSError:
                    continue

        return list(metadata.values())

    @classmethod
    def _parse_frontmatter(cls, content: str, fallback_name: str | None) -> Skill | None:
        """Parse YAML frontmatter into a Skill; return None if no frontmatter or name."""

        if not content.startswith("---"):
            return None

        end = content.find("---", 3)
        if end == -1:
            return None

        fm = _yaml.load(content[3:end])
        if not isinstance(fm, dict):
            return None

        name = fm.get("name") or fallback_name
        if not name:
            return None

        argument_hint = fm.get("argument-hint")
        usage = f"/{name} {argument_hint}" if argument_hint else f"/{name}"

        return Skill(
            name=name,
            usage=usage,
            description=fm.get("description"),
            argument_hint=argument_hint,
            allowed_tools=cls._parse_list(fm.get("allowed-tools")),
            model=fm.get("model"),
            effort=fm.get("effort"),
            context=fm.get("context"),
            agent=fm.get("agent"),
            user_invocable=fm.get("user-invocable", True),
            disable_model_invocation=fm.get("disable-model-invocation", False),
            when_to_use=fm.get("when-to-use"),
            paths=cls._parse_list(fm.get("paths")),
            shell=fm.get("shell"),
        )

    @staticmethod
    def _parse_list(value) -> list[str] | None:
        """Parse a comma-separated string or YAML list into a list of strings."""

        if isinstance(value, list):
            return [str(item).strip() for item in value]

        if isinstance(value, str):
            return [item.strip() for item in value.split(",")]

        return None

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
        """Parse SDK log line and route to the appropriate logger level."""

        try:
            _timestamp, level_str, message = line.split(" ", 2)
        except ValueError:
            self._logger.info(line)
        else:
            level_name = level_str.strip("[]").upper()
            level = LOG_LEVELS.get(level_name, logging.INFO)
            self._logger.log(level, message)

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

    # SDK hook adapters — bridge SDK HookMatcher signature to claudebox-typed callbacks
    # ----------------------------------------------------------------------------------------------

    async def _adapt_session_start(self, _input_data, _tool_use_id, _context) -> dict:
        """SDK SessionStart → on_session_start (no-arg callback)."""

        if self._config.hooks.on_session_start is not None:
            await self._config.hooks.on_session_start()
        return {}

    async def _adapt_pre_compact(self, input_data, _tool_use_id, _context) -> dict:
        """SDK PreCompact → on_pre_compact(CompactStartPayload).

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

    async def _adapt_post_tool_use(self, input_data, _tool_use_id, _context) -> dict:
        """SDK PostToolUse → _fire_permission_mode_changed.

        PostToolUse fires on every tool call, so this catches SDK-detected
        mode drift (mode changed by an internal SDK action rather than an
        explicit set_permission_mode call).
        """

        if not isinstance(input_data, dict):
            return {}

        mode = input_data.get("permission_mode")
        if mode:
            await self._fire_permission_mode_changed(mode)
        return {}

    @classmethod
    def _build_sdk_hooks(cls, runtime: "ClaudeRuntime") -> dict:
        """Translate typed HookCallbacks into the SDK's hooks dict shape.

        SessionStart dual-wires the session-start adapter and the
        permission-mode-detector adapter — the latter establishes
        `_last_known_permission_mode` silently from the initial value so the
        next real change fires `on_permission_mode_changed`.
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

        if callbacks.on_permission_mode_changed is not None:
            hooks["PostToolUse"] = [
                HookMatcher(hooks=[runtime._adapt_post_tool_use]),  # ty: ignore[invalid-argument-type]
            ]

        return hooks
