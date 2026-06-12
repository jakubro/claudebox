"""LangGraphRuntime - AgentSession adapter wrapping a LangGraph compiled agent graph.

Sister adapter to ClaudeRuntime. Routes model calls via LangChain's universal
`init_chat_model` factory so the workspace's `model = "provider:..."` field
selects any LangChain-supported provider (Ollama, Anthropic, OpenAI, Google
Gemini, Groq, Mistral, ...). MCP delegation false in v1; synthesizes hook
lifecycle from graph event boundaries; persists session state via
AsyncSqliteSaver per session_dir so cross-container-restart resume keys off
the same checkpoint file.

See ARCHITECTURE.md section 1.4 for the runtime adapter contract +
universal-provider design.
"""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from langchain.agents import create_agent
from langchain.agents.middleware import SummarizationMiddleware
from langchain.chat_models import init_chat_model
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command

from ._agent_registry import default_registry
from ._daemon_services import DaemonServiceBundle
from ._providers import (
    DEFAULT_STRATEGY,
    MODEL_CONTEXT_WINDOW,
    PROVIDER_STRATEGIES,
    ProviderSpec,
    install_hint,
    lookup_context_window,
    lookup_price,
)
from ._skills import walk_skills
from ._tasks import TaskService
from .catalogs import ContextUsage, EffortLevel, Model, PermissionMode, Skill
from .config import LangGraphAgentSessionConfig, RuntimeCapabilities
from .errors import ProviderPackageMissing
from .events import (
    AgentEvent,
    AssistantMessagePayload,
    ContentBlock,
    ResultPayload,
    ResultUsage,
    SystemInitData,
    SystemInitPayload,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessagePayload,
)
from .hooks import CompactStartPayload
from .langgraph_tools import ToolCatalog, ToolContext, make_tools
from .langgraph_tools._middleware import ClaudeboxToolHookMiddleware
from ..core.logging import get_logger


class CapabilityNotSupported(NotImplementedError):
    """Raised when a Protocol method is called against an unimplemented capability.

    Frontend reads RuntimeCapabilities at session start and hides surfaces that
    would trigger CapabilityNotSupported. Defensive raising here catches
    capability-gating bugs.
    """


def _compose_turn_cost(parent_cost: float | None, subagent_cost: float) -> float | None:
    """Combine parent-turn USD and per-turn sub-agent USD into one ResultPayload cost.

    Returns `None` ONLY when both contributors are absent - the parent rate
    didn't resolve (unknown model, no override) AND no sub-agent fired this
    turn. Any non-None parent or non-zero sub-agent contribution wins; the
    other side coerces to 0.0 for the sum. Frontend gates on `total_cost_usd
    is None` to hide the cost row, so emitting `0.0` for an Ollama turn keeps
    the row visible (and reading `$0.00`) while `None` hides it entirely.
    """

    if parent_cost is None and subagent_cost == 0.0:
        return None

    return (parent_cost or 0.0) + subagent_cost


class LangGraphRuntime:
    """AgentSession adapter backed by a LangGraph compiled graph.

    Composes (does not subclass) a LangGraph compiled graph via `self._graph`,
    a LangChain BaseChatModel via `self._chat_model`, and a checkpointer. Owns
    the prompt-staging queue, the astream cancellation, and usage accumulation.
    """

    runtime_name: str = "LangGraph"

    # Class-level catalog defaults - daemon endpoints read these to surface a
    # uniform shape with ClaudeRuntime. LangGraph has no static catalog (Ollama
    # models are dynamic, fetched per-session via `get_models()`); the daemon
    # workspace-defaults endpoint exposes an empty list under
    # `available_models` and the frontend's session-create flow surfaces an
    # explicit model TOML key as the source of truth.
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

    # Default fraction of the context window at which on_pre_compact fires once per session.
    # Exposed as a class constant so the threshold stays adapter-private; callers tune via subclass override.
    PRE_COMPACT_THRESHOLD = 0.85

    def __init__(self, config: LangGraphAgentSessionConfig) -> None:
        self._config = config
        self._logger = get_logger(__name__)
        self.ready = asyncio.Event()

        # Stable thread id for the checkpointer - pinned to session_id so
        # cross-restart resume keys off the same persisted thread.
        self._thread_id: str = config.session_id or str(uuid.uuid4())

        # Parsed provider identity - built ONCE here, every downstream method
        # reads from self._spec instead of re-parsing config.model. The
        # parser asserts the 'provider:model' form and rejects malformed
        # input (missing colon, empty provider, empty model_id) so workspace
        # TOML mistakes surface immediately at session start. `connect()`
        # guards against the None case when model is missing.
        self._spec: ProviderSpec | None = (
            ProviderSpec.parse(config.model, config.provider_kwargs) if config.model else None
        )

        # Lifecycle state.
        self._chat_model: Any | None = None
        self._graph: Any | None = None
        self._checkpointer: Any | None = None
        # AsyncSqliteSaver context-manager handle; entered in connect, exited in disconnect.
        self._checkpointer_cm: Any | None = None
        self._prompt_queue: asyncio.Queue[str | list[dict]] = asyncio.Queue()
        self._astream_task: asyncio.Task | None = None

        # Usage accumulation across the lifetime of the session.
        self._used_tokens: int = 0
        self._total_cost_usd: float = 0.0

        # Per-turn sub-agent cost accumulator. Sub-agent token usage hits
        # _used_tokens / _total_cost_usd directly via _accumulate_subagent_usage;
        # this counter additionally feeds the closing _result_event so the
        # parent turn's emitted cost reflects sub-agent work spawned during it.
        self._subagent_cost_this_turn: float = 0.0

        # Ollama catalog cache - populated on first get_models() call; lives for the session.
        self._models_cache: list[Model] | None = None

        # PreCompact hook firing gate - set once per session when the threshold
        # crosses, so multiple cross-events within one turn produce a single hook fire.
        self._fired_pre_compact: bool = False

        # Per-session task store. In-memory cache; rebuilt from events.jsonl
        # in connect() so resume picks up where the prior container left off.
        # See agent_session/_tasks.py for the persistence rationale.
        self._tasks: TaskService = TaskService(session_id=self._thread_id)

        # Set when the most-recent turn left the graph paused on a
        # `ask_user_question` tool's interrupt() call. The next user message
        # is interpreted as the resume payload and routed via
        # `Command(resume=...)` instead of starting a fresh HumanMessage turn.
        # Cleared at the top of _drive_turn before the resume invocation;
        # if the resumed run triggers another interrupt the post-stream state
        # check sets it back to True.
        self._awaiting_resume: bool = False

        # MCP client + per-server failure tracking. `connect()` populates these
        # defensively per subscope (j): one failed server's get_tools() must
        # NOT poison the others (upstream langchain-mcp-adapters issue #492).
        # Failures land in `_mcp_failures` so diagnostic surfacing can read
        # them; the surviving servers' tools still bind to the graph.
        self._mcp_client: MultiServerMCPClient | None = None
        self._mcp_failures: dict[str, str] = {}

    @property
    def capabilities(self) -> RuntimeCapabilities:
        return self.CAPABILITIES

    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> None:
        """Build the chat model, compile the ReAct graph, fire on_session_start.

        Pre-flight probes the active provider (currently only Ollama; .b adds
        the PROVIDER_STRATEGIES dispatch covering openai-compatible servers
        + skip-on-default for cloud providers) so failures surface as
        actionable typed exceptions before we attempt to build the graph -
        the handler layer maps them to HTTP responses (503 / 422).
        """

        if self._spec is None:
            raise RuntimeError(
                f'LangGraph workspace requires [langgraph] model = "provider:model" in '
                f".claudebox/settings.toml - model not configured for session "
                f"{self._config.session_id!r}."
            )

        # Dispatch through the per-provider strategy registry. Ollama gets
        # reachability + model-pulled probes; OpenAI-compatible gets an
        # opt-in /v1/models probe via the `probe_on_connect` kwarg; cloud
        # providers fall through to DEFAULT_STRATEGY (no probe - auth /
        # network errors surface at first query()).
        strategy = PROVIDER_STRATEGIES.get(self._spec.provider, DEFAULT_STRATEGY)

        if strategy.probe is not None:
            strategy.probe(self._spec)

        self._chat_model = self._build_chat_model()

        # Rebuild the task store from prior tool_use entries in events.jsonl
        # before the model runs - resume after container restart sees the
        # task list intact. Missing log is a no-op (fresh session).
        self._tasks.rebuild_from_events(self._config.session_dir / "events.jsonl")

        # Per-session SQLite checkpointer lives alongside events.jsonl + session.json
        # inside session_dir. Cross-container-restart resume works because the
        # session_dir is bind-mounted from the host per claudebox conventions.
        checkpoint_path = self._config.session_dir / "checkpoints.sqlite"
        self._checkpointer_cm = AsyncSqliteSaver.from_conn_string(str(checkpoint_path))
        self._checkpointer = await self._checkpointer_cm.__aenter__()

        # Construct the MCP client (if any [langgraph.mcp.*] servers are
        # configured) BEFORE building the DI bundle so the context carries
        # the client to (j)'s list/read tools. Defensive per-server tool
        # loading wraps each server's get_tools() in try/except - one failed
        # server must NOT poison the others (upstream issue #492).
        self._mcp_client = self._build_mcp_client()
        mcp_server_tools = await self._load_mcp_server_tools(self._mcp_client)

        # Build the tool surface: construct the DI bundle, aggregate every
        # family's @tool factories into one list, append MCP-server tools
        # from the surviving subset, then populate the catalog AFTER
        # aggregation so the self-discovery meta-tool (i) reads the full
        # bound set lazily at invoke time. Mutability is contained in
        # ToolCatalog; the surrounding ToolContext stays frozen.
        tool_ctx = self._build_tool_context(mcp_client=self._mcp_client)
        tools = [*make_tools(tool_ctx), *mcp_server_tools]
        tool_ctx.tool_catalog.tools.extend(tools)

        # Compose middleware. ClaudeboxToolHookMiddleware sits OUTERMOST so its
        # PreToolUse / PostToolUse observations wrap any retry / modification
        # logic an inner middleware might introduce in the future.
        # SummarizationMiddleware performs real history compaction once the
        # token count crosses PRE_COMPACT_THRESHOLD of the model's window -
        # the on_pre_compact hook fires upstream via _maybe_fire_pre_compact.
        max_tokens = self._model_context_window()
        middleware = [
            ClaudeboxToolHookMiddleware(tool_ctx),
            SummarizationMiddleware(
                model=self._chat_model,
                trigger=("tokens", int(max_tokens * self.PRE_COMPACT_THRESHOLD)),
            ),
        ]

        # _build_graph wraps the call with the single NotImplementedError catch
        # so providers/models without tool-calling support degrade to chat-only
        # (no fail-loud - tools register regardless, the model just never
        # emits tool_calls).
        self._graph = self._build_graph(tools, middleware)

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

        # Best-effort close on the chat model's internal HTTP client. langchain-ollama
        # 0.3.x doesn't expose a public close, but the httpx.Client lives on `_client`
        # and a defensive .close() releases the connection pool eagerly. Failures here
        # log a warning but never propagate - disconnect must always complete.
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

    async def query(self, prompt: str | list[dict]) -> None:
        """Stage prompt for the next receive_events drain.

        Buffers if connect() hasn't completed - the prompt sits in the queue
        until receive_events drives the graph.
        """

        await self._prompt_queue.put(prompt)

    async def interrupt(self) -> None:
        """Cancel the in-flight astream iteration."""

        if self._astream_task is not None and not self._astream_task.done():
            self._astream_task.cancel()

    async def get_context_usage(self) -> ContextUsage | None:
        """Cumulative usage from accumulated usage_metadata across the session.

        ``max_tokens`` tracks the per-model context window (see ``_model_context_window``)
        so the UI usage bar normalises against the actual ceiling - qwen2.5:7b's 32k
        window won't read as 25%-of-128k.
        """

        return ContextUsage(used_tokens=self._used_tokens, max_tokens=self._model_context_window())

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

        Dispatches through the per-provider strategy registry. Ollama
        enumerates via /api/tags; OpenAI-compatible servers (when
        `base_url` is set) enumerate via /v1/models; catalogless providers
        (anthropic, google_genai, groq, mistralai, ...) return an empty
        list - the workspace TOML's `[langgraph] model = "..."` is the only
        source of the active model id and the frontend's picker shows an
        empty list.
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

        Skills are filesystem objects (`<commands_dir>/*.md` +
        `<skills_dir>/<name>/SKILL.md`); discovery is runtime-neutral, so
        LangGraph workspaces consume the same catalog Claude workspaces do.
        The `skill` tool (langgraph_tools/skill.py) reads the SKILL.md body at
        invoke time and projects it as the tool result.
        """

        return walk_skills(commands_dir=commands_dir, skills_dir=skills_dir)

    @classmethod
    def get_default_model(cls) -> str:
        """Class-level default model id - empty string under LangGraph.

        The workspace `[langgraph] model = "..."` TOML key supplies the
        instance-level default at session start; this classmethod gates the
        daemon's workspace-defaults endpoint and reflects the absence of a
        static-catalog default.
        """

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

        Emits system/init once, then loops draining prompts from the staging
        queue. Each turn: assemble assistant/tool_result events from
        on_chat_model_end / on_tool_end boundaries; close with result/success.
        """

        yield self._system_init_event()

        # Wait for connect() to complete before driving the graph.
        await self.ready.wait()

        while True:
            prompt = await self._prompt_queue.get()

            async for event in self._drive_turn(prompt):
                yield event

    async def _drive_turn(self, prompt: str | list[dict]) -> AsyncIterator[AgentEvent]:
        """Drive one user->assistant turn through the graph."""

        assert self._graph is not None, "_drive_turn requires connect() to have completed"

        # Establish the cancellation target BEFORE the astream call so a racing
        # interrupt() always has a valid task to cancel - the prior placement
        # after astream_events returned left a microsecond window where the
        # task pointer was None.
        self._astream_task = asyncio.current_task()

        turn_started_at = time.monotonic()
        turn_input_tokens = 0
        turn_output_tokens = 0
        final_text = ""

        # Reset per-turn sub-agent cost - any `task` invocation during this
        # turn folds its USD into the closing _result_event below.
        self._subagent_cost_this_turn = 0.0

        # If the prior turn ended on an `ask_user_question` interrupt, this
        # prompt is the user's wrapped XML answer. Route it as a Command(resume=)
        # so the @tool's interrupt() returns it as the tool result and the
        # graph picks up where it left off. Otherwise drive a fresh
        # HumanMessage turn.
        if self._awaiting_resume:
            self._awaiting_resume = False
            resume_value = prompt if isinstance(prompt, str) else str(prompt)
            graph_input: Any = Command(resume=resume_value)
        else:
            content: Any = prompt if isinstance(prompt, list) else prompt
            graph_input = {"messages": [HumanMessage(content=content)]}

        config = {"configurable": {"thread_id": self._thread_id}}

        try:
            astream = self._graph.astream_events(graph_input, config=config, version="v2")

            async for event in astream:
                kind = event.get("event")
                data = event.get("data") or {}

                if kind == "on_chat_model_end":
                    ai = self._as_ai_message(data.get("output"))

                    if ai is None:
                        continue

                    input_tokens, output_tokens = self._extract_usage(ai)
                    turn_input_tokens += input_tokens
                    turn_output_tokens += output_tokens

                    # Synthesize PreCompact - fire once per session when running
                    # token-usage crosses PRE_COMPACT_THRESHOLD of the model's
                    # context window. Real compaction is performed by
                    # SummarizationMiddleware (wired in connect()).
                    await self._maybe_fire_pre_compact()

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
        except asyncio.CancelledError:
            # interrupt() - emit a synthetic result so the stream closes cleanly.
            duration_ms = int((time.monotonic() - turn_started_at) * 1000)
            parent_cost = self._accumulate_usage(turn_input_tokens, turn_output_tokens)
            cost = _compose_turn_cost(parent_cost, self._subagent_cost_this_turn)
            yield self._result_event(
                final_text or "[interrupted]",
                cost_usd=cost,
                duration_ms=duration_ms,
                used_tokens=self._used_tokens,
            )

            raise
        finally:
            self._astream_task = None

        # If the model called ask_user_question (or any other interrupt-using
        # tool), the graph is now paused. The next user message becomes the
        # resume value via the routing at the top of _drive_turn. Setting
        # _awaiting_resume here lets the result event close the turn cleanly
        # while the assistant_message containing the tool_use(ask_user_question)
        # has already been emitted from `on_chat_model_end`.
        self._awaiting_resume = await self._has_pending_interrupt(config)

        duration_ms = int((time.monotonic() - turn_started_at) * 1000)
        parent_cost = self._accumulate_usage(turn_input_tokens, turn_output_tokens)
        cost = _compose_turn_cost(parent_cost, self._subagent_cost_this_turn)
        yield self._result_event(
            final_text,
            cost_usd=cost,
            duration_ms=duration_ms,
            used_tokens=self._used_tokens,
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

    def _assistant_event(self, ai: AIMessage) -> AgentEvent | None:
        """Assistant message with text and/or tool_use content blocks.

        Returns None when the AIMessage has neither text nor tool_calls -
        avoids emitting an empty assistant bubble (llama3.2:3b tool-calling
        pattern leaves content empty on call turns).
        """

        blocks: list[ContentBlock] = []

        text = self._text_of(ai)

        if text:
            blocks.append(TextBlock(text=text))

        for call in getattr(ai, "tool_calls", None) or []:
            blocks.append(
                ToolUseBlock(
                    id=call.get("id") or str(uuid.uuid4()),
                    name=call.get("name", ""),
                    input=call.get("args") or {},
                )
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
            content = (
                tool_output.content
                if isinstance(tool_output.content, str)
                else str(tool_output.content)
            )
            is_error = getattr(tool_output, "status", "success") == "error"
        elif isinstance(tool_output, dict):
            tool_use_id = tool_output.get("tool_call_id") or tool_output.get("id") or ""
            content = str(tool_output.get("content", ""))
            is_error = tool_output.get("status") == "error"
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
                    )
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

        Handles three observed shapes: a bare AIMessage, an object with a
        .message attribute, and a .generations-bearing result.
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

    async def _has_pending_interrupt(self, config: dict[str, Any]) -> bool:
        """Return True when the graph is paused at an `interrupt()` call.

        After an astream_events run completes, the LangGraph state snapshot's
        `tasks` list carries any task whose node hit interrupt(); each such
        task exposes a non-empty `interrupts` tuple. We treat the presence
        of at least one pending interrupt as "the next user message becomes
        the resume payload". A non-blocking best-effort: failures degrade
        to False rather than break the turn close.
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

    async def _maybe_fire_pre_compact(self) -> None:
        """Fire on_pre_compact once per session when context-fraction crosses threshold."""

        if self._fired_pre_compact:
            return

        if self._config.hooks.on_pre_compact is None:
            return

        if self._context_fraction() <= self.PRE_COMPACT_THRESHOLD:
            return

        self._fired_pre_compact = True
        await self._config.hooks.on_pre_compact(CompactStartPayload(trigger="context_limit"))

    def _context_fraction(self) -> float:
        """Return the running token usage as a fraction of the model's context window."""

        max_tokens = self._model_context_window()

        if max_tokens <= 0:
            return 0.0

        return self._used_tokens / max_tokens

    def _model_context_window(self) -> int:
        """Per-model context window via the `_providers.lookup_context_window` helper.

        `lookup_context_window(spec, override)` reads `spec.model_id` against
        `MODEL_CONTEXT_WINDOW` (workspace `max_tokens_override` wins). When
        `self._spec` is None (workspace TOML omitted `[langgraph] model`),
        falls back to the table's `"default"` entry directly - `connect()`
        guards the missing-model case before any real turn drives the cost
        path, so this branch is reachable only during pre-connect probes.
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
        """Add this turn's tokens + cost to running totals; return turn cost or None.

        Tokens accumulate unconditionally. Cost via `lookup_price(spec, overrides)`:
        when the model is in the curated `PRICE_PER_MTOK` table (Ollama -> zero,
        cloud -> curated USD) the rates apply and `turn_cost` is added to the
        cumulative `_total_cost_usd`. When the model is unknown AND the workspace
        carries no `[langgraph.cost]` override for it, returns `None` so the
        emitted `ResultPayload.total_cost_usd` stays None and the projection's
        truthy check skips the update - the frontend hides the cost row.
        """

        self._used_tokens += input_tokens + output_tokens

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
        """Fold a sub-agent's aggregated token usage into the parent's totals.

        Bound onto `ToolContext.record_subagent_usage` so the `task` tool can
        push the sub-graph's per-call usage back into the parent runtime.
        Tokens accumulate unconditionally; cost folds into the cumulative
        total + per-turn sub-agent counter ONLY when `lookup_price` resolves
        the active model. Unknown models contribute zero to USD telemetry
        (matches `_accumulate_usage` None-cost semantics).
        """

        self._used_tokens += input_tokens + output_tokens

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
        """Construct the DI bundle threaded through every tool factory.

        Universal fields are populated here. Subscope-owned fields ride on
        ToolContext extensions as later families ship - sub-agent dispatch
        (c) gets the agent registry, a chat-model factory bound to this
        runtime's `_build_chat_model`, the usage-aggregation sink, and a
        depth counter starting at 0; MCP (j) carries the multi-server
        client so the list/read resource tools route through it.
        """

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

        Returns None when no `[langgraph.mcp.*]` blocks are configured so
        downstream code can branch cheaply without inspecting an empty
        connections dict.
        """

        if not self._config.mcp_servers:
            return None

        # Workspace TOML carries connection dicts as plain dict[str, dict] - the
        # langchain-mcp-adapters TypedDict variants (StdioConnection / SSEConnection
        # / StreamableHttpConnection / WebsocketConnection) are runtime-discriminated
        # by the `transport` key; the client narrows at session construction. ty
        # cannot see through the structural compatibility, hence the ignore.
        return MultiServerMCPClient(connections=self._config.mcp_servers)  # ty: ignore[invalid-argument-type]

    async def _load_mcp_server_tools(self, client: MultiServerMCPClient | None) -> list[BaseTool]:
        """Defensively fetch tools per MCP server; never poison-pill the graph.

        Iterates each configured server, calling `get_tools(server_name=...)`
        in isolation. Per upstream issue #492: a single misbehaving server
        must not break tool loading for the others. Failures are tracked in
        `self._mcp_failures` (server_name -> error message) for diagnostic
        surfacing; successful servers' tools accumulate into a flat list
        appended to the graph's tool surface.
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

        The provider package is lazy-imported by init_chat_model itself
        (langchain-anthropic, langchain-openai, langchain-ollama, ...); an
        ImportError means the user hasn't `pip install`ed the corresponding
        package. Provider identity + kwargs are read from self._spec; the
        `install_hint(provider)` helper in `_providers.py` surfaces the
        exact `pip install ...` remediation in the typed exception.
        """

        assert self._spec is not None, "__init__ builds self._spec; connect() guards missing model"

        try:
            return init_chat_model(self._spec.full_id, **self._spec.kwargs)
        except ImportError as exc:
            raise ProviderPackageMissing(
                provider=self._spec.provider,
                install_hint=install_hint(self._spec.provider),
            ) from exc

    def _build_graph(self, tools: list[BaseTool], middleware: list) -> Any:
        """Compile the ReAct graph; degrade to chat-only when the model can't bind tools.

        Single catch site for `NotImplementedError` raised by `bind_tools()`
        on providers/models without tool-calling support (Perplexity, some
        HuggingFace pipelines, ...). On catch, the graph rebuilds with
        `tools=[]` and the conversation continues as chat-only - identical
        UX to a workspace configured for a model that simply chose not to
        call tools. Logged at WARNING, not raised - no fail-loud; tool
        factories stay provider-unaware.
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
            )
