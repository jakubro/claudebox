"""LangGraphRuntime - AgentSession adapter wrapping a LangGraph compiled agent graph.

Sister adapter to ClaudeRuntime. Routes model calls via LangChain's universal
`init_chat_model` factory so the workspace's `model = "provider:..."` field selects
any LangChain-supported provider (Ollama, Anthropic, OpenAI, Google Gemini, Groq,
Mistral, ...). Synthesizes hook lifecycle from graph event boundaries and persists
session state via AsyncSqliteSaver per session_dir so cross-container-restart resume
keys off the same checkpoint file. MCP delegation is not supported.

See ARCHITECTURE.md section 1.4 for the runtime adapter contract and
universal-provider design.
"""

import asyncio
import importlib
import re
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import BaseTool, ToolException
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command

from ._agent_registry import default_registry
from ._daemon_services import DaemonServiceBundle
from ._profile_hooks import resolve_session_start_hook, run_session_start_hook
from ._providers import (
    DEFAULT_STRATEGY,
    MODEL_CONTEXT_WINDOW,
    PROVIDER_STRATEGIES,
    ProviderSpec,
    install_hint,
    lookup_context_window,
    lookup_price,
)
from ._skills import extract_body, find_skill_source, parse_frontmatter, walk_skills
from ._tasks import TaskService
from .catalogs import ContextUsage, EffortLevel, Model, PermissionMode, Skill, StreamHealth
from .config import LangGraphAgentSessionConfig, RuntimeCapabilities
from .errors import ProviderPackageMissing
from .events import (
    AgentEvent,
    AssistantMessagePayload,
    CompactBoundaryPayload,
    ContentBlock,
    ResultPayload,
    ResultUsage,
    SystemInitData,
    SystemInitPayload,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessagePayload,
)
from .hooks import CompactStartPayload
from .langgraph_tools import SUBAGENT_RUN_TAG, ToolCatalog, ToolContext, make_tools
from .langgraph_tools._middleware import ClaudeboxToolHookMiddleware, content_reports_nonzero_exit
from .langgraph_tools._summarization import ClaudeboxSummarizationMiddleware
from ..constants import SESSION_COMPACTION_FILE
from ..core.io import read_json, write_json
from ..core.logging import get_logger


class CapabilityNotSupported(NotImplementedError):
    """Raised when a Protocol method is called against an unimplemented capability.

    Frontend hides gated surfaces via RuntimeCapabilities; reaching here means that gating broke.
    """


# Leading `/name` + optional args - matches the `skill` tool's own name pattern.
_SLASH_COMMAND_PATTERN = re.compile(r"^/([A-Za-z0-9_-]+)(?:\s+(.*))?$", re.DOTALL)


def _resolve_slash_skill(prompt: str) -> str | None:
    """Expand a user-typed `/<skill>` into its body, honoring `user-invocable` - LangGraph's
    answer to what Claude's CLI does natively. None falls back to literal text.
    """

    match = _SLASH_COMMAND_PATTERN.match(prompt.strip())

    if match is None:
        return None

    name, arguments = match.group(1), match.group(2)
    source = find_skill_source(name)

    if source is None:
        return None

    try:
        content = source.read_text(encoding="utf-8")
    except OSError:
        return None

    skill = parse_frontmatter(content, fallback_name=name)

    if skill is None or skill.user_invocable is False:
        return None

    body = extract_body(content)

    if arguments:
        body = f"{body.rstrip()}\n\nARGUMENTS: {arguments}\n"

    return body


def _tag_slash_command(text: str) -> str:
    """Wrap a leading `/<name> [args]` in Claude CLI's command-tag format so the frontend styles
    it the same regardless of runtime; display-only, `_drive_turn` never sends this to the model.
    """

    match = _SLASH_COMMAND_PATTERN.match(text.strip())

    if match is None:
        return text

    name, arguments = match.group(1), match.group(2) or ""

    return (
        f"<command-message>{name}</command-message>"
        f"<command-name>/{name}</command-name>"
        f"<command-args>{arguments}</command-args>"
    )


def _compose_turn_cost(parent_cost: float | None, subagent_cost: float) -> float | None:
    """Combine parent-turn USD and per-turn sub-agent USD into one ResultPayload cost.

    None only when both contributors are absent. Frontend hides the cost row when
    `total_cost_usd is None`, so `0.0` for an Ollama turn keeps it visible while `None` hides it.
    """

    if parent_cost is None and subagent_cost == 0.0:
        return None

    return (parent_cost or 0.0) + subagent_cost


class LangGraphRuntime:
    """AgentSession adapter backed by a LangGraph compiled graph.

    Composes (does not subclass) the graph as `self._graph` and a LangChain BaseChatModel as
    `self._chat_model`, plus a checkpointer; owns the prompt-staging queue, astream cancellation, and usage accumulation.
    """

    runtime_name: str = "LangGraph"

    # No static catalog: Ollama models are dynamic (fetched via get_models()), so these stay
    # empty - the workspace TOML `model` key is the source of truth.
    AVAILABLE_MODELS: list[Model] = []
    AVAILABLE_EFFORT_LEVELS: list[EffortLevel] = []
    AVAILABLE_PERMISSION_MODES: list[PermissionMode] = []

    CAPABILITIES = RuntimeCapabilities(
        supports_set_model_mid_session=False,
        supports_set_permission_mode=False,
        supports_set_effort_level=False,
        supports_pre_compact_hook=True,
        supports_mcp_delegation=False,
        supports_models=True,
        supports_effort_levels=False,
        supports_permission_modes=False,
        supports_skills=True,
        supports_context_usage=True,
        supports_cost_telemetry=True,
        supports_manual_compact=False,
        supports_session_resume=True,
        supports_session_fork=True,
        supports_session_rewind=True,
        supports_ask_user_question=True,
    )

    # Fraction of the context window at which the graph compacts its history.
    COMPACT_THRESHOLD = 0.85

    def __init__(self, config: LangGraphAgentSessionConfig) -> None:
        self._config = config
        self._logger = get_logger(__name__)
        self.ready = asyncio.Event()

        # Pinned to session_id so cross-restart resume keys off the same persisted thread.
        self._thread_id: str = config.session_id or str(uuid.uuid4())

        # Parsed once; downstream methods read self._spec instead of re-parsing config.model -
        # connect() guards the None case when model is missing.
        self._spec: ProviderSpec | None = (
            ProviderSpec.parse(config.model, config.provider_kwargs) if config.model else None
        )

        self._chat_model: Any | None = None
        self._graph: Any | None = None
        self._summarization: Any | None = None
        self._compaction_path = config.session_dir / SESSION_COMPACTION_FILE
        self._checkpointer: Any | None = None
        # Entered in connect, exited in disconnect.
        self._checkpointer_cm: Any | None = None
        self._prompt_queue: asyncio.Queue[str | list[dict]] = asyncio.Queue()
        self._astream_task: asyncio.Task | None = None

        # A level, not a total: falls when compaction shrinks history (matches the UI usage bar);
        # cost is a running sum.
        self._context_tokens: int = 0
        self._total_cost_usd: float = 0.0

        # Sub-agent USD reaches _total_cost_usd on its own; this counter lets the turn's
        # own emitted cost include work it spawned.
        self._subagent_cost_this_turn: float = 0.0

        self._models_cache: list[Model] | None = None

        # Events a middleware produced, waiting for the turn loop to yield them - compaction
        # happens between model calls, so its boundary has no astream event of its own to ride on.
        self._pending_events: list[AgentEvent] = []

        # Rebuilt from events.jsonl in connect() so resume picks up where the prior container left off.
        self._tasks: TaskService = TaskService(session_id=self._thread_id)

        # Set when the last turn left the graph paused on an `ask_user_question` interrupt();
        # the next user message then routes via Command(resume=...) instead of a fresh HumanMessage turn.
        self._awaiting_resume: bool = False

        # connect() populates these defensively per server: one failed server's get_tools() must not
        # poison the others (upstream langchain-mcp-adapters issue #492); failures land in `_mcp_failures`.
        self._mcp_client: MultiServerMCPClient | None = None
        self._mcp_failures: dict[str, str] = {}

        # Held until the first turn can put it in front of the model; None means no
        # hook, or one that produced nothing.
        self._session_start_context: str | None = None

        # Cleared once the first turn consumes it, so it is offered exactly once per process.
        self._session_start_context_pending: bool = False

    @property
    def capabilities(self) -> RuntimeCapabilities:
        return self.CAPABILITIES

    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """Build the chat model, compile the ReAct graph, fire on_session_start.

        Pre-flight probes the active provider via PROVIDER_STRATEGIES (Ollama reachability,
        opt-in OpenAI-compatible probe, cloud providers skip) so failures surface as typed
        exceptions the handler layer maps to HTTP responses (503 / 422) before the graph is built.
        """

        if self._spec is None:
            raise RuntimeError(
                f'LangGraph workspace requires [langgraph] model = "provider:model" in '
                f".claudebox/settings.toml - model not configured for session "
                f"{self._config.session_id!r}.",
            )

        # Cloud providers fall through to DEFAULT_STRATEGY (no probe; auth/network errors
        # surface at first query()).
        strategy = PROVIDER_STRATEGIES.get(self._spec.provider, DEFAULT_STRATEGY)

        if strategy.probe is not None:
            strategy.probe(self._spec)

        self._chat_model = self._build_chat_model()

        # Resume after a container restart sees the task list intact; a missing log is a no-op (fresh session).
        self._tasks.rebuild_from_events(self._config.session_dir / "events.jsonl")

        # Cross-container-restart resume works because session_dir is bind-mounted from the
        # host per claudebox conventions.
        checkpoint_path = self._config.session_dir / "checkpoints.sqlite"
        self._checkpointer_cm = AsyncSqliteSaver.from_conn_string(str(checkpoint_path))
        self._checkpointer = await self._checkpointer_cm.__aenter__()

        # Built before the DI bundle so the tool context carries the client to the list/read
        # resource tools. Per-server get_tools() failures must not poison the others (upstream issue #492).
        self._mcp_client = self._build_mcp_client()
        mcp_server_tools = await self._load_mcp_server_tools(self._mcp_client)

        # Catalog is populated AFTER aggregation so the self-discovery meta-tool reads the full bound set lazily.
        tool_ctx = self._build_tool_context(mcp_client=self._mcp_client)
        tools = [*make_tools(tool_ctx), *mcp_server_tools]
        tool_ctx.tool_catalog.tools.extend(tools)

        # ClaudeboxToolHookMiddleware sits outermost so PreToolUse/PostToolUse wraps any later
        # inner-middleware retry logic.
        max_tokens = self._model_context_window()
        self._summarization = ClaudeboxSummarizationMiddleware(
            model=self._chat_model,
            trigger=("tokens", int(max_tokens * self.COMPACT_THRESHOLD)),
            on_started=self._compaction_started,
            on_finished=self._compaction_finished,
        )

        middleware = [
            ClaudeboxToolHookMiddleware(tool_ctx),
            self._summarization,
        ]

        caching = self._prompt_caching_middleware()

        if caching is not None:
            middleware.append(caching)

        self._graph = self._build_graph(tools, middleware)

        await self._load_session_start_context()
        await self._seed_context_from_checkpoint()

        self.ready.set()

        if self._config.hooks.on_session_start is not None:
            await self._config.hooks.on_session_start()

    async def disconnect(self) -> None:
        """Cancel any in-flight astream task; clear ready; drop staged prompts; close HTTP client."""

        self.ready.clear()

        if self._astream_task is not None and not self._astream_task.done():
            self._astream_task.cancel()

            try:
                await self._astream_task
            except (asyncio.CancelledError, Exception):
                pass

        self._astream_task = None

        while not self._prompt_queue.empty():
            try:
                self._prompt_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        if self._checkpointer_cm is not None:
            try:
                await self._checkpointer_cm.__aexit__(None, None, None)
            except Exception as exc:
                self._logger.warning("checkpointer_close_failed", error=str(exc))

            self._checkpointer_cm = None
            self._checkpointer = None

        # langchain-ollama exposes no public close; the httpx.Client lives on `_client`, so a
        # defensive .close() releases the pool eagerly. Failures log a warning but never
        # propagate - disconnect must always complete.
        client = getattr(self._chat_model, "_client", None)

        if client is not None:
            close = getattr(client, "close", None)

            if callable(close):
                try:
                    close()
                except Exception as exc:
                    self._logger.warning("chat_model_close_failed", error=str(exc))

        self._chat_model = None
        self._graph = None
        self._summarization = None

    async def query(self, prompt: str | list[dict]) -> None:
        """Stage prompt for the next receive_events drain.

        Buffers if connect() hasn't completed - the prompt sits queued until receive_events drives the graph.
        """

        await self._prompt_queue.put(prompt)

    async def interrupt(self) -> None:
        """Cancel the in-flight astream iteration."""

        if self._astream_task is not None and not self._astream_task.done():
            self._astream_task.cancel()

    def stream_health(self) -> StreamHealth | None:
        """No transport to inspect - events are produced in-process, not read off a pipe."""

        return None

    async def get_context_usage(self) -> ContextUsage | None:
        """Current context occupancy against the model's window.

        ``used_tokens`` is what the latest exchange occupied, so the bar drops back after
        compaction; ``max_tokens`` is the per-model window, so the bar normalises against the actual ceiling, not a fixed default.
        """

        return ContextUsage(
            used_tokens=self._context_tokens,
            max_tokens=self._model_context_window(),
        )

    async def set_model(self, model: str | None = None) -> None:
        raise CapabilityNotSupported("LangGraphRuntime does not support set_model")

    async def set_permission_mode(self, mode: str) -> None:
        raise CapabilityNotSupported("LangGraphRuntime does not support set_permission_mode")

    async def set_effort_level(self, level: str) -> None:
        raise CapabilityNotSupported("LangGraphRuntime does not support set_effort_level")

    async def reconnect_mcp_server(self, server_name: str) -> None:
        raise CapabilityNotSupported("LangGraphRuntime does not support MCP delegation")

    async def toggle_mcp_server(self, server_name: str, enabled: bool) -> None:
        raise CapabilityNotSupported("LangGraphRuntime does not support MCP delegation")

    async def get_mcp_status(self) -> dict:
        raise CapabilityNotSupported("LangGraphRuntime does not support MCP delegation")

    # Catalogs
    # ------------------------------------------------------------------

    def get_models(self) -> list[Model]:
        """Return the active provider's model catalog; cached per session.

        Ollama enumerates via /api/tags, OpenAI-compatible servers via /v1/models; catalogless
        providers (anthropic, google_genai, groq, mistralai, ...) return empty, and the workspace's
        `[langgraph] model = "..."` TOML key is the only source of the active model id.
        """

        if self._models_cache is not None:
            return list(self._models_cache)

        if self._spec is None:
            self._models_cache = []

            return []

        strategy = PROVIDER_STRATEGIES.get(self._spec.provider, DEFAULT_STRATEGY)

        if strategy.fetch_catalog is None:
            self._models_cache = []

            return []

        self._models_cache = strategy.fetch_catalog(self._spec)

        return list(self._models_cache)

    def get_effort_levels(self) -> list[EffortLevel]:
        return []

    def get_permission_modes(self) -> list[PermissionMode]:
        return []

    @classmethod
    def get_skills(cls, commands_dir=None, skills_dir=None) -> list[Skill]:
        """Walk the workspace skill catalog via the shared walker.

        Discovery is runtime-neutral, so LangGraph workspaces consume the same catalog Claude workspaces do.
        """

        return walk_skills(commands_dir=commands_dir, skills_dir=skills_dir)

    @classmethod
    def get_default_model(cls) -> str:
        """Class-level default model id - empty string; LangGraph has no static catalog default."""

        return ""

    @classmethod
    def get_default_effort_level(cls) -> str:
        """No effort-level concept under LangGraph; capability is False; type-stable empty."""

        return ""

    @classmethod
    def get_default_permission_mode(cls) -> str:
        """No permission-mode concept under LangGraph; capability is False; type-stable empty."""

        return ""

    @classmethod
    def get_model_context_window(cls, model_id: str) -> int:
        """Return per-model context-window from the hardcoded table, with fallback."""

        return MODEL_CONTEXT_WINDOW.get(model_id, MODEL_CONTEXT_WINDOW["default"])

    # Event stream
    # ------------------------------------------------------------------

    async def receive_events(self) -> AsyncIterator[AgentEvent]:
        """Yield AgentEvents projected from astream_events boundaries.

        Emits system/init once, then loops draining prompts from the staging queue; each turn
        assembles assistant/tool_result events from on_chat_model_end / on_tool_end boundaries and closes with result/success.
        """

        yield self._system_init_event()

        await self.ready.wait()

        while True:
            prompt = await self._prompt_queue.get()

            async for event in self._drive_turn(prompt):
                yield event

    async def _drive_turn(self, prompt: str | list[dict]) -> AsyncIterator[AgentEvent]:
        """Drive one user->assistant turn through the graph."""

        assert self._graph is not None, "_drive_turn requires connect() to have completed"

        # Set before the astream call so a racing interrupt() always has a valid task to cancel.
        self._astream_task = asyncio.current_task()

        turn_started_at = time.monotonic()
        turn_input_tokens = 0
        turn_output_tokens = 0
        final_text = ""

        # Any `task` invocation during this turn folds its USD into the closing _result_event below.
        self._subagent_cost_this_turn = 0.0

        # Must go first: the turn tracker keys a turn on this event's uuid, and the attachment path's
        # one-shot echo suppression matches a no-tool-result user message - going first claims
        # this one, not a later match.
        yield self._human_message_event(prompt)

        # If the prior turn ended on an `ask_user_question` interrupt, route this prompt as
        # Command(resume=) so the tool's interrupt() returns it and the graph resumes;
        # otherwise start a fresh HumanMessage turn.
        config = {"configurable": {"thread_id": self._thread_id}}

        if self._awaiting_resume:
            self._awaiting_resume = False
            resume_value = prompt if isinstance(prompt, str) else str(prompt)
            graph_input: Any = Command(resume=resume_value)
        else:
            skill_body = _resolve_slash_skill(prompt) if isinstance(prompt, str) else None
            content: Any = (
                skill_body
                if skill_body is not None
                else (prompt if isinstance(prompt, list) else prompt)
            )
            messages: list[Any] = [HumanMessage(content=content)]

            # Session-start context leads the first turn so the model reads the profile's bootstrap
            # before the request it shapes; carried as a system message, not a user one, so it
            # never renders as user-typed.
            bootstrap = await self._take_session_start_context(config)

            if bootstrap:
                messages.insert(0, SystemMessage(content=bootstrap))

            graph_input = {"messages": messages}

        try:
            astream = self._graph.astream_events(graph_input, config=config, version="v2")

            async for event in astream:
                kind = event.get("event")
                data = event.get("data") or {}

                # Compaction runs between model calls, so its boundary is queued rather than streamed;
                # drain before handling this event so it lands ahead of the reply the compacted
                # conversation produced.
                for pending in self._take_pending_events():
                    yield pending

                # LangChain propagates this turn's callbacks into a sub-agent's graph, so its calls
                # and results arrive here too, but they belong to the sub-agent's own conversation:
                # counting them double-bills the turn, and emitting them would leak the sub-agent's
                # reply into this transcript.
                if SUBAGENT_RUN_TAG in (event.get("tags") or []):
                    continue

                if kind == "on_chat_model_end":
                    ai = self._as_ai_message(data.get("output"))

                    if ai is None:
                        continue

                    input_tokens, output_tokens = self._extract_usage(ai)
                    turn_input_tokens += input_tokens
                    turn_output_tokens += output_tokens

                    # Every call re-sends the whole conversation, so the latest call's own total is the
                    # occupancy - summing would double-count history; a call reporting no usage
                    # leaves the previous level standing.
                    if input_tokens or output_tokens:
                        self._context_tokens = input_tokens + output_tokens

                    assistant_evt = self._assistant_event(ai)

                    if assistant_evt is not None:
                        yield assistant_evt

                    text = self._text_of(ai)

                    if text:
                        final_text = text
                elif kind == "on_tool_end":
                    tool_evt = self._tool_result_event(data.get("output"))

                    if tool_evt is not None:
                        yield tool_evt
                elif kind == "on_tool_error":
                    tool_evt = self._tool_error_event(data)

                    if tool_evt is not None:
                        yield tool_evt
        except asyncio.CancelledError:
            # interrupt(): emit a synthetic result so the stream closes cleanly - whatever a
            # middleware queued dies with the turn rather than surfacing in the next one.
            self._take_pending_events()

            duration_ms = int((time.monotonic() - turn_started_at) * 1000)
            parent_cost = self._accumulate_usage(turn_input_tokens, turn_output_tokens)
            cost = _compose_turn_cost(parent_cost, self._subagent_cost_this_turn)
            yield self._result_event(
                final_text or "[interrupted]",
                cost_usd=cost,
                duration_ms=duration_ms,
                used_tokens=self._context_tokens,
            )

            raise
        finally:
            self._astream_task = None

        # If the model called an interrupt-using tool, the graph is now paused; the next user
        # message becomes the resume value via the routing at the top of _drive_turn.
        self._awaiting_resume = await self._has_pending_interrupt(config)

        # A compaction on the turn's last model call has no further astream event to ride out on.
        for pending in self._take_pending_events():
            yield pending

        duration_ms = int((time.monotonic() - turn_started_at) * 1000)
        parent_cost = self._accumulate_usage(turn_input_tokens, turn_output_tokens)
        cost = _compose_turn_cost(parent_cost, self._subagent_cost_this_turn)
        yield self._result_event(
            final_text,
            cost_usd=cost,
            duration_ms=duration_ms,
            used_tokens=self._context_tokens,
        )

    # Event assembly helpers - emit Claude-stream-json shapes
    # ------------------------------------------------------------------

    def _system_init_event(self) -> AgentEvent:
        return AgentEvent(
            kind="system_init",
            payload=SystemInitPayload(
                subtype="init",
                session_id=self._config.session_id or self._thread_id,
                model=self._config.model,
                data=SystemInitData(),
            ),
        )

    def _human_message_event(self, prompt: str | list[dict]) -> AgentEvent:
        """User-role message opening a human turn, carrying the turn's identity.

        The uuid is the whole point: downstream turn tracking assigns a turn only to a user message that
        carries one; tool-result user messages deliberately carry none, since they belong to an already-open turn.
        """

        return AgentEvent(
            kind="user_message",
            payload=UserMessagePayload(
                uuid=str(uuid.uuid4()),
                content=_tag_slash_command(self._prompt_text(prompt)),
            ),
        )

    def _assistant_event(self, ai: AIMessage) -> AgentEvent | None:
        """Assistant message with reasoning, text and/or tool_use content blocks.

        Returns None when the AIMessage carries none of the three, avoiding an empty assistant bubble
        (llama3.2:3b's tool-calling pattern leaves content empty on call turns); reasoning leads, matching transcript order.
        """

        blocks: list[ContentBlock] = []

        reasoning = self._reasoning_of(ai)

        if reasoning:
            blocks.append(ThinkingBlock(thinking=reasoning))

        text = self._text_of(ai)

        if text:
            blocks.append(TextBlock(text=text))

        for call in getattr(ai, "tool_calls", None) or []:
            blocks.append(
                ToolUseBlock(
                    id=call.get("id") or str(uuid.uuid4()),
                    name=call.get("name", ""),
                    input=call.get("args") or {},
                ),
            )

        if not blocks:
            return None

        return AgentEvent(
            kind="assistant_message",
            payload=AssistantMessagePayload(
                uuid=None,
                content=blocks,
                model=self._config.model,
            ),
        )

    def _tool_result_event(self, tool_output: Any) -> AgentEvent | None:
        """User-role wrapper around a tool_result block."""

        if tool_output is None:
            return None

        if isinstance(tool_output, ToolMessage):
            tool_use_id = tool_output.tool_call_id
            raw_content = tool_output.content
            content = raw_content if isinstance(raw_content, str) else str(raw_content)
            status_error = getattr(tool_output, "status", "success") == "error"
            is_error = status_error or content_reports_nonzero_exit(raw_content)
        elif isinstance(tool_output, dict):
            tool_use_id = tool_output.get("tool_call_id") or tool_output.get("id") or ""
            raw_content = tool_output.get("content", "")
            content = str(raw_content)
            status_error = tool_output.get("status") == "error"
            is_error = status_error or content_reports_nonzero_exit(raw_content)
        else:
            tool_use_id = ""
            content = str(tool_output)
            is_error = False

        return AgentEvent(
            kind="user_message",
            payload=UserMessagePayload(
                uuid=None,
                content=[
                    ToolResultBlock(
                        tool_use_id=tool_use_id,
                        content=content,
                        is_error=is_error,
                    ),
                ],
            ),
        )

    def _tool_error_event(self, error_data: dict[str, Any]) -> AgentEvent | None:
        """User-role wrapper around a tool call LangChain reports via `on_tool_error`.

        The middleware recovers a `ToolException` one layer up, but the callback span still reports
        `on_tool_error`, not `on_tool_end` - this projects that recovery; any other exception is a bug and must propagate.
        """

        error = error_data.get("error")

        if not isinstance(error, ToolException):
            return None

        return AgentEvent(
            kind="user_message",
            payload=UserMessagePayload(
                uuid=None,
                content=[
                    ToolResultBlock(
                        tool_use_id=error_data.get("tool_call_id") or "",
                        content=str(error),
                        is_error=True,
                    ),
                ],
            ),
        )

    def _result_event(
        self,
        final_text: str,
        *,
        cost_usd: float | None,
        duration_ms: int,
        used_tokens: int,
    ) -> AgentEvent:
        return AgentEvent(
            kind="result",
            payload=ResultPayload(
                subtype="success",
                result=final_text,
                total_cost_usd=cost_usd,
                duration_ms=duration_ms,
                session_id=self._config.session_id or None,
                usage=ResultUsage(used_tokens=used_tokens, max_tokens=self._model_context_window()),
            ),
        )

    @staticmethod
    def _as_ai_message(output: Any) -> AIMessage | None:
        """Robustly extract an AIMessage from on_chat_model_end output.

        Handles three observed shapes: a bare AIMessage, an object with a .message attribute, and a .generations-bearing result.
        """

        if output is None:
            return None

        if isinstance(output, AIMessage):
            return output

        msg = getattr(output, "message", None)

        if isinstance(msg, AIMessage):
            return msg

        generations = getattr(output, "generations", None)

        if generations:
            try:
                cand = generations[0][0].message

                if isinstance(cand, AIMessage):
                    return cand
            except (IndexError, AttributeError):
                pass

        return None

    @staticmethod
    def _prompt_text(prompt: str | list[dict]) -> str:
        """Flatten a staged prompt to the text a transcript should show.

        Structured prompts (attachment sends) arrive as Anthropic content blocks; only text blocks are
        renderable here - image/document blocks are already surfaced by the synthetic event the send path injects.
        """

        if isinstance(prompt, str):
            return prompt

        return "".join(
            str(block.get("text", ""))
            for block in prompt
            if isinstance(block, dict) and block.get("type") == "text"
        )

    @staticmethod
    def _reasoning_of(message: AIMessage) -> str:
        """Join the message's reasoning content, whichever provider produced it.

        LangChain's `content_blocks` normalises Anthropic thinking blocks, OpenAI reasoning summaries and
        Ollama's `reasoning_content` into one `reasoning` block type, so no provider branching belongs here.
        """

        return "".join(
            str(block.get("reasoning") or "")
            for block in message.content_blocks
            if isinstance(block, dict) and block.get("type") == "reasoning"
        )

    @staticmethod
    def _text_of(message: AIMessage) -> str:
        """Flatten message content to plain text - joins only text-type blocks."""

        content = message.content

        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            parts: list[str] = []

            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    parts.append(block)

            return "".join(parts)
        else:
            return ""

    # Hooks
    # ------------------------------------------------------------------

    async def _load_session_start_context(self) -> None:
        """Run the profile's session-start hook and hold whatever context it produced.

        The Claude Code CLI runs this hook and folds the result into the model's context; nothing spawns
        that CLI here, so the runtime runs the same script over the same protocol, deferring delivery to the first turn.
        """

        hook = resolve_session_start_hook(self._config.profile_hooks.get("session_start"))

        if hook is None:
            return

        context = await run_session_start_hook(
            hook,
            session_id=self._config.session_id or self._thread_id,
            transcript_path=self._config.session_dir / "events.jsonl",
        )

        if not context:
            return

        self._session_start_context = context
        self._session_start_context_pending = True
        self._logger.info("profile_hook_context_loaded", hook=str(hook), chars=len(context))

    async def _take_session_start_context(self, config: dict[str, Any]) -> str | None:
        """Return the session-start context when this turn should carry it.

        Delivered only into a thread with no history: the checkpointer persists whatever the graph is
        handed, so injecting on resume would stack another copy per restart - the CLI equivalent never accumulates.
        """

        if not self._session_start_context_pending:
            return None

        history = await self._thread_has_history(config)

        if history is True:
            self._session_start_context_pending = False
            self._logger.info("profile_hook_context_skipped_resume")

            return None

        if history is None:
            # The probe could not answer; deliver anyway and stop offering - an unreadable checkpointer
            # can't accumulate duplicates either, and dropping the context here would silently do nothing.
            self._logger.warning("profile_hook_context_delivered_unverified")

        self._session_start_context_pending = False

        return self._session_start_context

    async def _thread_has_history(self, config: dict[str, Any]) -> bool | None:
        """Return whether the checkpointed thread already holds messages.

        None means the probe could not answer (the checkpointer refused the read), kept separate from a
        confident False so the caller can tell known-empty from unknown, not mistake unreadable for resumed.
        """

        assert self._graph is not None

        try:
            snapshot = await self._graph.aget_state(config)
        except Exception as exc:  # noqa: BLE001 - best-effort probe
            self._logger.warning("thread_history_probe_failed", error=str(exc))

            return None

        values = getattr(snapshot, "values", None) or {}

        return bool(values.get("messages"))

    async def _seed_context_from_checkpoint(self) -> None:
        """Seed context occupancy from the checkpointed thread's last AIMessage, if any.

        A fresh process has seen no model calls, so `_context_tokens` reads zero until the first reply -
        the compaction record covers the one state no AIMessage can describe.
        """

        assert self._graph is not None

        config = {"configurable": {"thread_id": self._thread_id}}

        try:
            snapshot = await self._graph.aget_state(config)
        except Exception as exc:  # noqa: BLE001 - best-effort probe
            self._logger.warning("context_seed_probe_failed", error=str(exc))

            return

        messages = (getattr(snapshot, "values", None) or {}).get("messages") or []
        after_compaction = self._messages_after_compaction(messages)

        for message in reversed(after_compaction):
            if not isinstance(message, AIMessage):
                continue

            input_tokens, output_tokens = self._extract_usage(message)

            if input_tokens or output_tokens:
                self._context_tokens = input_tokens + output_tokens

            return

        record = self._read_compaction_record(messages)

        if record is not None:
            self._context_tokens = int(record["post_tokens"])

    def _messages_after_compaction(self, messages: list[Any]) -> list[Any]:
        """The tail appended since the last recorded compaction, or everything if there is none."""

        record = self._read_compaction_record(messages)

        return messages if record is None else messages[int(record["message_count"]) :]

    def _read_compaction_record(self, messages: list[Any]) -> dict | None:
        """Load the last compaction's own token count, if it still describes this checkpoint."""

        record = read_json(self._compaction_path, default=None)

        if not isinstance(record, dict) or "post_tokens" not in record:
            return None

        count = record.get("message_count")

        if not isinstance(count, int) or not 0 < count <= len(messages):
            return None

        anchor_moved = getattr(messages[count - 1], "id", None) != record.get("last_message_id")

        return None if anchor_moved else record

    def _record_compaction(self, post_tokens: int, kept: list[Any]) -> None:
        """Persist what the compaction left behind, for a restart that beats the next reply."""

        if not kept:
            return

        try:
            write_json(
                self._compaction_path,
                {
                    "post_tokens": post_tokens,
                    "message_count": len(kept),
                    "last_message_id": getattr(kept[-1], "id", None),
                },
            )
        except OSError as exc:
            self._logger.warning("compaction_record_write_failed", error=str(exc))

    async def _has_pending_interrupt(self, config: dict[str, Any]) -> bool:
        """Return True when the graph is paused at an `interrupt()` call.

        The state snapshot's `tasks` list carries any task whose node hit interrupt(), exposing a
        non-empty `interrupts` tuple; best-effort - failures degrade to False rather than break the turn close.
        """

        assert self._graph is not None

        try:
            snapshot = await self._graph.aget_state(config)
        except Exception as exc:  # noqa: BLE001 - best-effort probe
            self._logger.warning("interrupt_state_probe_failed", error=str(exc))

            return False

        tasks = getattr(snapshot, "tasks", ()) or ()

        for task in tasks:
            interrupts = getattr(task, "interrupts", ()) or ()

            if interrupts:
                return True

        return False

    async def _compaction_started(self) -> None:
        """Announce a compaction the graph is about to perform."""

        if self._config.hooks.on_pre_compact is None:
            return

        await self._config.hooks.on_pre_compact(CompactStartPayload(trigger="context_limit"))

    async def _compaction_finished(
        self,
        *,
        pre_tokens: int,
        post_tokens: int,
        summary: str,
        kept: list[Any],
    ) -> None:
        """Queue the boundary that closes a compaction, plus the summary it produced.

        Both ride out on the turn's event stream at the next opportunity - compaction runs between model
        calls with no astream event of its own; the summary follows as a synthetic user message, where the transcript looks for it.
        """

        self._record_compaction(post_tokens, kept)

        self._pending_events.append(
            AgentEvent(
                kind="compact_boundary",
                payload=CompactBoundaryPayload(
                    trigger="context_limit",
                    pre_tokens=pre_tokens,
                    post_tokens=post_tokens,
                ),
            ),
        )

        if summary:
            # A content block, not bare text: a plain string on a user message reads as user-typed,
            # which opens a new turn and leaves the block itself empty.
            self._pending_events.append(
                AgentEvent(
                    kind="user_message",
                    payload=UserMessagePayload(uuid=None, content=[TextBlock(text=summary)]),
                ),
            )

    def _take_pending_events(self) -> list[AgentEvent]:
        """Hand over everything a middleware queued since the last check."""

        pending = self._pending_events
        self._pending_events = []

        return pending

    def _model_context_window(self) -> int:
        """Per-model context window via the `_providers.lookup_context_window` helper.

        Falls back to the table's `"default"` entry when `self._spec` is None (workspace TOML omitted
        `[langgraph] model`); reachable only during pre-connect probes, since `connect()` guards the missing-model case.
        """

        if self._spec is None:
            return MODEL_CONTEXT_WINDOW["default"]

        return lookup_context_window(self._spec, self._config.max_tokens_override)

    @staticmethod
    def _extract_usage(message: AIMessage) -> tuple[int, int]:
        """Pull (input_tokens, output_tokens) from AIMessage.usage_metadata."""

        usage = getattr(message, "usage_metadata", None) or {}

        return int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))

    def _accumulate_usage(self, input_tokens: int, output_tokens: int) -> float | None:
        """Add this turn's cost to the running total; return turn cost or None.

        Every model call is billed for the whole prompt it re-sent, so the turn's cost sums each call -
        unlike occupancy, a level tracked in `_drive_turn`. Returns None when the model is unknown and no
        `[langgraph.cost]` override exists, so the frontend hides the cost row.
        """

        if self._spec is None:
            return None

        rates = lookup_price(self._spec, self._config.cost_overrides)

        if rates is None:
            return None

        turn_cost = (input_tokens / 1_000_000) * rates["input"] + (
            output_tokens / 1_000_000
        ) * rates["output"]
        self._total_cost_usd += turn_cost

        return turn_cost

    def _accumulate_subagent_usage(self, input_tokens: int, output_tokens: int) -> None:
        """Fold a sub-agent's aggregated token usage into the parent's cost totals.

        Bound onto `ToolContext.record_subagent_usage` so the `task` tool can push the sub-graph's per-call
        usage back into the parent; context occupancy is deliberately untouched - the sub-agent's prompt never occupies this window.
        """

        if self._spec is None:
            return

        rates = lookup_price(self._spec, self._config.cost_overrides)

        if rates is None:
            return

        call_cost = (input_tokens / 1_000_000) * rates["input"] + (
            output_tokens / 1_000_000
        ) * rates["output"]
        self._total_cost_usd += call_cost
        self._subagent_cost_this_turn += call_cost

    # Tool context
    # ------------------------------------------------------------------

    def _build_tool_context(
        self,
        *,
        mcp_client: MultiServerMCPClient | None = None,
    ) -> ToolContext:
        """Construct the DI bundle threaded through every tool factory."""

        return ToolContext(
            workspace_path=Path(self._config.cwd),
            session_id=self._config.session_id or self._thread_id,
            session_dir=self._config.session_dir,
            config=self._config,
            hooks=self._config.hooks,
            logger=self._logger,
            tool_catalog=ToolCatalog(),
            agent_registry=default_registry(),
            chat_model_factory=self._build_chat_model,
            daemon_services=DaemonServiceBundle(tasks=self._tasks),
            mcp_client=mcp_client,
            record_subagent_usage=self._accumulate_subagent_usage,
            subagent_depth=0,
        )

    # MCP client + defensive server-tool loading
    # ------------------------------------------------------------------

    def _build_mcp_client(self) -> MultiServerMCPClient | None:
        """Construct the MultiServerMCPClient from the workspace's mcp_servers config.

        Returns None when no `[langgraph.mcp.*]` blocks are configured, so downstream code can branch
        cheaply without inspecting an empty connections dict.
        """

        if not self._config.mcp_servers:
            return None

        # Workspace TOML carries connection dicts as plain dict[str, dict]; langchain-mcp-adapters'
        # TypedDict variants are runtime-discriminated by the `transport` key, which ty
        # can't see through structurally.
        return MultiServerMCPClient(connections=self._config.mcp_servers)  # ty: ignore[invalid-argument-type]

    async def _load_mcp_server_tools(self, client: MultiServerMCPClient | None) -> list[BaseTool]:
        """Defensively fetch tools per MCP server; never poison-pill the graph.

        Per upstream issue #492: a single misbehaving server must not break tool loading for the others;
        failures are tracked in `self._mcp_failures` for diagnostic surfacing.
        """

        if client is None:
            return []

        loaded: list[BaseTool] = []

        for server_name in client.connections:
            try:
                server_tools = await client.get_tools(server_name=server_name)
            except Exception as exc:  # noqa: BLE001 - defensive perimeter
                self._mcp_failures[server_name] = str(exc)
                self._logger.warning(
                    "mcp_server_tools_load_failed",
                    server=server_name,
                    error=str(exc),
                )
                continue

            loaded.extend(server_tools)

        return loaded

    # Chat model factory
    # ------------------------------------------------------------------

    def _build_chat_model(self) -> Any:
        """Construct the chat model via LangChain's universal init_chat_model factory.

        The provider package is lazy-imported by init_chat_model itself; an ImportError means the user
        hasn't `pip install`ed it, and `install_hint(provider)` surfaces the remediation in the typed exception.
        """

        assert self._spec is not None, "__init__ builds self._spec; connect() guards missing model"

        try:
            return init_chat_model(self._spec.full_id, **self._spec.kwargs)
        except ImportError as exc:
            raise ProviderPackageMissing(
                provider=self._spec.provider,
                install_hint=install_hint(self._spec.provider),
            ) from exc

    def _prompt_caching_middleware(self) -> Any | None:
        """Return Anthropic's prompt-caching middleware, or None where it does not apply.

        Every turn re-sends the whole transcript, so the system prompt, tool schemas and settled history
        are worth caching from the start. Loaded by name, not imported at module scope: `langchain-anthropic`
        ships behind the `anthropic` extra, so a core-only install keeps working, uncached, with a warning.
        """

        assert self._spec is not None, "connect() guards missing model before middleware assembly"

        if self._spec.provider != "anthropic":
            return None

        try:
            caching = importlib.import_module("langchain_anthropic.middleware")
        except ImportError as exc:
            self._logger.warning(
                "anthropic_prompt_caching_unavailable",
                model=self._spec.model_id,
                error=str(exc),
                install_hint=install_hint(self._spec.provider),
            )

            return None

        # The provider gate above already decided this applies; `ignore` stops the middleware from
        # warning when a test or proxy hands it a stand-in model.
        return caching.AnthropicPromptCachingMiddleware(unsupported_model_behavior="ignore")

    def _build_graph(self, tools: list[BaseTool], middleware: list) -> Any:
        """Compile the ReAct graph; degrade to chat-only when the model can't bind tools.

        Catches `NotImplementedError` from `bind_tools()` on providers without tool-calling support and
        rebuilds with `tools=[]` so the conversation continues as chat-only; logged at WARNING, not raised.
        """

        assert self._spec is not None, "connect() guards missing model before _build_graph"
        assert self._chat_model is not None, (
            "_build_graph runs after _build_chat_model() in connect()"
        )

        try:
            return create_agent(
                model=self._chat_model,
                tools=tools,
                middleware=middleware,
                checkpointer=self._checkpointer,
                system_prompt=self._config.system_prompt,
            )
        except NotImplementedError as exc:
            self._logger.warning(
                "provider_no_tool_calling",
                provider=self._spec.provider,
                model=self._spec.model_id,
                error=str(exc),
            )

            return create_agent(
                model=self._chat_model,
                tools=[],
                middleware=middleware,
                checkpointer=self._checkpointer,
                system_prompt=self._config.system_prompt,
            )
