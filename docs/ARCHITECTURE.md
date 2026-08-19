# Claudebox Architecture

> **Purpose**: Implementation details, internal architecture, and technical decisions. For user-facing behavior, see [SPEC.md](SPEC.md) (product specification). For coding conventions, see [GUIDELINES.md](GUIDELINES.md).

---

## 0. Workspace Layout

`lib/` is the build root — recipes (`justfile`), JS lint configs (`biome.json`, `.jscpd.json`, `knip.json`), Python project (`pyproject.toml`), and shared tooling (`scripts/`) all live here.

```
lib/
├── src/                          # Python packages + claudebox_frontend (React)
├── tests/                        # Python unit tests — see §7.1
├── e2e/
│   ├── app/                      # Frontend E2E (Playwright) — own package.json + playwright.config.js
│   └── cli/                      # CLI E2E (pytest) — invokes claudebox binary as subprocess
├── scripts/                      # Cross-tree tooling
│   ├── frontend-guidelines-audit.js  # Frontend convention checks (fails `just lint`)
│   ├── spec-coverage.js              # SPEC.md claim → test-marker tracking
│   └── test-ui/                      # In-container test harness — see TEST-UI.md
├── biome.json, .jscpd.json, knip.json  # JS lint configs (sweep all three JS trees)
├── package.json                  # Lib-root JS devDeps (biome + jscpd + knip)
├── pyproject.toml                # Python project — testpaths: tests/, e2e/cli/
└── justfile                      # Single source of truth for all recipes
```

### Lint sweep

Configs and devDeps live at `lib/` root rather than inside any single tree, so one tool invocation covers all three JS trees (`src/claudebox_frontend`, `e2e/app`, `scripts`):

| Tool | Purpose | Trees |
|------|---------|-------|
| Biome | Lint + format JS/JSX/CSS | src/claudebox_frontend, e2e/app, scripts |
| jscpd | Duplicate-code detection | src/claudebox_frontend, e2e/app, scripts |
| Knip | Unused-export detection | src/claudebox_frontend, e2e/app, scripts (per-workspace config) |
| Ruff | Lint + format Python | src/, tests/, e2e/cli/, scripts/ |
| frontend-guidelines-audit | Non-fatal frontend conventions | src/claudebox_frontend |
| spec-coverage | SPEC.md claim → test-marker tracking | e2e/app/tests + e2e/cli |

---

## 1. Framework (`claudebox`)

Core abstractions shared by CLI, daemon, hooks, and container API. Provides the asyncio primitives (broadcaster, polling base classes, HTTP serving + proxy helpers) that both daemon and container API are built on top of.

### 1.1 Abstraction Hierarchy

```
Workspace (root of a project)
├── .workspace marker file (discovery anchor)
├── .claudebox/sessions/ (session data, inside workspace)
└── Session (one per agent conversation)
    ├── id (Claude SDK session ID)
    ├── path → .claudebox/sessions/YYYYMMDD-HHMMSS--{session_id}/
    └── Request (convenience context)
        ├── workspace + session + logger
        └── profile_dir
```

**Workspace discovery**: `get_workspace_root()` walks up from cwd looking for `.workspace` marker. `get_sessions_root()` resolves to `{workspace_root}/.claudebox/sessions/` (or `~/.claudebox/sessions/` as fallback when no workspace exists).

**Session directory naming**: `YYYYMMDD-HHMMSS--{session_id}` — timestamp prefix enables chronological sorting, `--` separator enables glob matching by session ID.

### 1.2 Hook System

Two decorator types for Claude Code integration:

| Decorator | Request Type | I/O | Purpose |
|-----------|-------------|-----|---------|
| `@hook` | `HookRequest(Request)` | stdin JSON → stdout JSON | Lifecycle hooks (SessionStart, PreToolUse, etc.) |
| `@statusline` | `StatuslineRequest(Request)` | stdin JSON → stdout text | Status bar display |

Both decorators: read JSON from stdin → construct typed request → call function → serialize response to stdout. The `@hook` decorator builds a `HookResponse` with `continue`/`block` semantics.

### 1.3 Module Map

```
paths.py                  # Workspace/session directory discovery and naming
workspace.py              # Workspace context — ignore patterns, session listing
config.py                 # Config.load() — TOML walk-up, deep-merge across hierarchy
cleanup.py                # cleanup_stale_dirs() — remove orphaned session/temp dirs
install.py                # CLI epilog and installation metadata utilities
constants.py              # Path constants, labels, ports, timings, defaults
env.py                    # is_dev_mode(), set_dev_mode() — runtime environment detection
temp.py                   # Session /tmp symlink — ensure_tmp(), restore_tmp()

core/
├── broadcaster.py        # Generic pub-sub Broadcaster with replay support for async event streaming
├── cli.py                # CLI entry point utilities — Rich console, HelpFormatter, print_command/print_error
├── concurrency.py        # maybe_awaitable() — async/sync bridging helper
├── file_cache.py         # FileCache[T] — generic mtime-based cache
├── fs.py                 # walk_up(), touch_dir(), touch_file(), resolve_path(), remove_path(), make_temp_dir(), walk_filtered(), find_files()
├── http.py               # JSONResponse, ProxyClient, ProxyStreamingResponse, ProxyBufferedResponse, BroadcastEventSource (Protocol), AsyncBroadcastEventSource (Protocol), BroadcastEventSourceResponse, http_serve()
├── io.py                 # write_text(), append_text(), write_json(), append_json(), read_json(), read_jsonl(), read_toml(), count_lines(), calculate_hash()
├── logging.py            # Structured logging — configure_logging(), get_logger(), use_log_file(), use_rotating_log_file(), close_log_file()
├── polling.py            # AsyncPoller, MtimeWatcher — base classes for periodic/mtime-driven background loops
├── serialization.py      # JSONEncoder (datetime/Path/dataclass/Enum/Decimal), dumps/loads/dump/load wrappers
├── structures.py         # DataClass mixin (asdict/fromdict), merge() deep-merge, invert() dict inversion
├── time.py               # TIMESTAMP_FORMAT, get_timestamp(), parse_timestamp()
└── string.py             # wrap_box() — box-drawing text wrapper

user/
├── hook.py               # @hook decorator — stdin JSON → HookRequest → HookResponse → stdout
├── request.py            # Request context — workspace + session + logger + profile_dir
└── statusline.py         # @statusline decorator — stdin JSON → StatuslineRequest → stdout text

session/
├── session.py            # Session context — directory, paths, lifecycle
├── models.py             # SessionMetadata dataclass, SessionNotFound exception
└── repository.py         # SessionRepository — shared disk I/O for session.json files

agent_session/
├── __init__.py           # Public re-exports — AgentSession, AgentSessionConfig, ClaudeAgentSessionConfig, ClaudeRuntime, RuntimeCapabilities, AgentEvent, HookCallbacks, catalog dataclasses; make_agent_session factory; UnknownRuntime
├── protocol.py           # AgentSession Protocol — the boundary every runtime adapter implements
├── config.py             # AgentSessionConfig base + ClaudeAgentSessionConfig subclass + RuntimeCapabilities (16-flag matrix)
├── events.py             # AgentEvent — kind discriminator + SDK-free payload dict
├── hooks.py              # HookCallbacks — five lifecycle callbacks + CompactStartPayload
├── catalogs.py           # Model, PermissionMode, EffortLevel, Skill, ContextUsage dataclasses (runtime-neutral shapes; concrete values live on the adapter)
├── runtime_claude.py     # ClaudeRuntime — only file importing `claude_agent_sdk` (composition wrapping BaseClaudeSDKClient); holds AVAILABLE_MODELS/EFFORT_LEVELS/PERMISSION_MODES class attributes + the Skill YAML-frontmatter parser
└── orchestration/        # Session lifecycle, event pipeline, persistence, projection, broadcaster (see §1.5)
    ├── session.py        #   Facade — only public interface for the container API
    ├── pipeline.py       #   Orchestrator: AgentEvent loop → enrich → persist → dispatch
    ├── conversion.py     #   dict_message_to_events / to_published_event / serialize_event
    ├── models.py         #   Event, PublishedEvent, SessionSummary
    ├── persistence.py    #   EventLog — events.jsonl append + read
    ├── broadcaster.py    #   SSE subscriber management + replay
    ├── projection.py     #   Session summary accumulator → session.json
    ├── turn_tracker.py   #   Turn ID state machine
    ├── tool_output.py    #   Tool output file reading
    ├── attachments.py    #   AttachmentService — path resolution + MIME inference
    ├── async_tasks.py    #   AsyncTaskManager — detect/manage background tasks
    ├── async_monitor.py  #   AsyncTaskMonitor — tail output file + emit events
    └── errors.py         #   ApiError hierarchy (SessionNotReady, ValidationError, etc.)

containers/
├── __init__.py           # create_runtime() — factory selecting LocalRuntime vs ContainerRuntime
├── backend.py            # ContainerBackend — podman/docker CLI abstraction
├── build.py              # build_image() — temp dir context, profile overlay, podman build
├── local.py              # LocalRuntime — subprocess-based runtime that bypasses podman/docker (used for in-container daemons)
├── models.py             # ImageBuildMode enum (BUILD, UPDATE, REBUILD)
├── protocol.py           # ContainerRuntimeProtocol — shared interface implemented by ContainerRuntime and LocalRuntime
├── run.py                # run_container(), get_container_run_args(), get_volumes(), prepare_volume()
└── runtime.py            # ContainerRuntime — high-level facade (build + run, delegating to ContainerBackend)

extensions/
└── tickets/              # Tickets & Boards domain — Board, BoardState, BoardSummary, BoardTicket, Swimlane models, parser, ticket move/archive/assign, swimlane and state CRUD with FileLock. Consumed by claudebox_daemon.domain.boards.
```

### 1.4 Agent Runtime Abstraction

The agent runtime is reached through the `AgentSession` Protocol owned by `claudebox/agent_session/`. The Protocol declares everything claudebox-core needs from any backend runtime — connection lifecycle, query input, control plane (model / permission / effort), MCP delegation, telemetry, event stream, runtime identity, capabilities, and metadata catalogs. No code outside `claudebox/agent_session/runtime_claude.py` may import `claude_agent_sdk`; a static import audit (`python-guidelines-audit.py`) enforces the rule (see GUIDELINES §SDK Containment).

`ClaudeRuntime` was the first adapter; `LangGraphRuntime` (§1.4, below) is the second. `ClaudeRuntime` **composes** (does not inherit) `BaseClaudeSDKClient` as a private `_sdk` attribute and translates between the SDK's native message/hook surface and claudebox-native types. Every adapter implements the same Protocol and declares its own `RuntimeCapabilities`.

```
claudebox-core
  ↓ depends on
AgentSession (Protocol)        ← owned by claudebox/agent_session/
  ↑ implemented by
ClaudeRuntime                  ← only file importing claude_agent_sdk; composes BaseClaudeSDKClient
  ↓ wraps (self._sdk: BaseClaudeSDKClient)
BaseClaudeSDKClient            ← external SDK
```

**Protocol surface** (`claudebox/agent_session/protocol.py`):

| Operation group | Methods | Notes |
|---|---|---|
| Identity | `runtime_name: str` attribute | Display string ("Claude"). |
| Lifecycle | `connect()`, `disconnect()`, `ready: asyncio.Event` | Connect-ready signal lets consumers wait before iterating `receive_events()`. |
| Input | `query(prompt)`, `interrupt()` | `prompt` may be `str` or `list[dict]` structured content blocks. |
| Control plane | `set_model(m)`, `set_permission_mode(m)`, `set_effort_level(l)` | First call after construction establishes baseline silently; subsequent actual changes fire the corresponding `on_*_changed` callback. |
| MCP | `reconnect_mcp_server(name)`, `toggle_mcp_server(name, enabled)`, `get_mcp_status()` | Delegated to whatever MCP integration the runtime exposes. |
| Telemetry | `get_context_usage() -> ContextUsage \| None` | Typed dataclass: `used_tokens`, `max_tokens`. |
| Event stream | `receive_events() -> AsyncIterator[AgentEvent]` | Backend-neutral typed events; see below. |
| Catalogs | `get_models()`, `get_effort_levels()`, `get_permission_modes()`, `get_skills()`, `get_default_*()`, `get_model_context_window(model_id)` | Runtime-specific metadata exposed without bypassing the Protocol. |
| Capabilities | `capabilities -> RuntimeCapabilities` | 16-flag boolean matrix (see below). |

**`RuntimeCapabilities`** is a frozen dataclass declaring which optional features a runtime supports. **16 booleans, all required, no defaults** — every adapter is forced to be explicit. Claudebox-core reads the matrix at connect time to decide whether to expose related controls in the frontend; `ClaudeRuntime` returns all `True`. Runtimes that return `False` for an operation tell consumers to hide the affected control. The runtime display name lives on a **sibling field** of the session-info envelope, not on `RuntimeCapabilities` itself, which stays purely boolean.

**`AgentEvent`** is the claudebox-native event yielded by `receive_events()`. Each event carries a `kind` discriminator ("system", "user", "assistant", "result") and a `payload` dict projected by `ClaudeRuntime._translate_sdk_message()` from the SDK message. Downstream of `AgentSession`, no SDK type reaches `EventPipeline`, `conversion`, or any subscriber. A future slice may tighten `payload` to a per-kind frozen-dataclass tagged union; consumers today read it as a typed dict.

**`HookCallbacks`** is a dataclass of optional lifecycle callbacks passed in via `AgentSessionConfig.hooks`. Seven slots — `on_session_start`, `on_pre_compact`, `on_model_changed`, `on_permission_mode_changed`, `on_effort_level_changed`, `on_pre_tool_use`, `on_post_tool_use`. State-change callbacks fire both from setter calls and from SDK-detected drift, consumers seeing only the canonical signal (the PostToolUse-as-permission-mode-detector path is internal). `ClaudeRuntime._fire_*_changed` holds the delta detection: a callback fires iff a baseline exists and the new value differs.

**`AgentSessionConfig`** is the base config dataclass with universal fields (`runtime`, `model`, `permission_mode`, `effort_level`, `session_dir`, `hooks`, etc.). Per-runtime subclasses carry runtime-specific fields: `ClaudeAgentSessionConfig(AgentSessionConfig)` holds SDK-passthrough fields (`sdk_passthrough`, `setting_sources`, `max_buffer_size`, `system_prompt`, `debug_mode`); `LangGraphAgentSessionConfig(AgentSessionConfig)` (§1.4, below) is the second. Each new runtime adds its own subclass the same way.

**Invariants:**

1. `claude_agent_sdk` is imported only from `claudebox/agent_session/runtime_claude.py`. The import audit fails `just check` on any other importer.
2. `AgentSession.receive_events()` yields `AgentEvent` only; SDK message types stay inside `ClaudeRuntime._translate_sdk_message()`.
3. Hook callbacks receive claudebox-typed payloads — never raw `HookInput` / `HookContext`.
4. `RuntimeCapabilities` is a frozen 16-boolean dataclass with no defaults. Runtime metadata (display name) lives on a sibling field of the session-info envelope, not on the capability dataclass.

**ClaudeRuntime-specific notes** (not Protocol-level invariants):

- `~/.claude/settings.json` writes (the effort-level side-channel) happen inside `ClaudeRuntime._write_effort_to_settings()`. The per-session symlink trick (`_isolate_settings_file()`) runs during `ClaudeRuntime.connect()` — see §1.4.1. Other runtimes have no `~/.claude/` to isolate.
- Pre-connect query buffering lives inside ClaudeRuntime. `ready: asyncio.Event` exposes the connect-state to consumers; `_flush_on_ready` drains the buffer + pending control-plane calls after `connect()` returns.
- Delta-detection state (`_last_known_model`, `_last_known_permission_mode`, `_last_known_effort_level`) lives on ClaudeRuntime; setter calls and the PostToolUse adapter both feed `_fire_*_changed` so a single filter governs both paths.

**Adding a runtime** — implement `AgentSession` at `claudebox/agent_session/runtime_<name>.py`, declare an `AgentSessionConfig` subclass, return a `RuntimeCapabilities` instance with the actual support matrix, translate the native event stream into `AgentEvent`, and route the native hook system through `HookCallbacks`. No other claudebox module changes — the Protocol is the entire contract.

**LangGraphRuntime — the second adapter.** Built on LangGraph (graph runtime, `astream_events`, middleware, sqlite checkpointer) + LangChain core (model abstraction) + LangChain's universal `init_chat_model` factory (provider-agnostic model construction) + `langchain-ollama` (the dev / test default in core deps). In-process Python — no subprocess, no proxy.

**Universal provider surface.** `init_chat_model(spec.full_id, **spec.kwargs)` is the single model-construction entry point; the workspace TOML's `[langgraph] model = "provider:model-id"` selects any LangChain-supported provider. Tier 1 (tested in CI): Anthropic, OpenAI, Ollama. Tier 2 (smoke-tested + documented): Google Gemini, Groq, Mistral, vLLM (via openai+base_url). Tier 3 (preinstalled, no provider-specific tests): Cohere, Fireworks, Together, DeepSeek, xAI, Perplexity, NVIDIA NIM, HuggingFace, AWS Bedrock, Azure OpenAI, Vertex AI, IBM watsonx, Databricks. Every provider package ships preinstalled in the agent image (`uv sync --extra langgraph-all`), so selection is runtime config with no install step.

**`ProviderSpec` — single parsed identity.** A frozen dataclass parses the workspace's `model` string and captures provider + model id + kwargs in one typed object. Built ONCE in `LangGraphRuntime.__init__()` and stored as `self._spec`; every downstream method (`_build_chat_model`, `connect()`, `get_models()`, `_accumulate_usage`, `_model_context_window`) reads from `self._spec`. NO method re-parses `self._config.model` via `.split(":")`. `ProviderSpec.parse` raises `ValueError` on malformed input (missing colon, empty provider, empty model_id) so workspace TOML mistakes surface immediately at session start.

**Provider strategy registry.** Two connect-time concerns dispatch by provider name through a single registry: pre-flight probe and catalog enumeration. `PROVIDER_STRATEGIES = {"ollama": ProviderStrategy(probe=_probe_ollama, fetch_catalog=_fetch_ollama_catalog), "openai": ProviderStrategy(probe=_probe_openai_compatible, fetch_catalog=_fetch_openai_catalog)}`; `DEFAULT_STRATEGY = ProviderStrategy()` (no probe, no catalog) applies via `.get()` fallback for cloud providers. `connect()` and `get_models()` carry zero `if provider == ...` chains. Ollama: full reachability (`/api/version`) + model-pulled (`/api/show`) checks. OpenAI-compatible (base_url set): opt-in `/v1/models` probe gated by `probe_on_connect` kwarg. Cloud providers (anthropic, google_genai, groq, mistralai, ...): no probe — auth/network errors surface at first `query()`. Adding a provider with custom probe/catalog = adding a registry entry; no `connect()` body edit.

**Curated tables + lookup helpers.** `_providers.py` holds three module-level dicts keyed by bare `model_id`: `MODEL_CONTEXT_WINDOW` (int tokens), `PRICE_PER_MTOK` (USD per million tokens), `PROVIDER_EXTRAS` (per-provider pyproject extra names). Three lookup helpers — `lookup_context_window(spec, override) -> int`, `lookup_price(spec, overrides) -> dict | None`, `install_hint(provider) -> str` — accept `ProviderSpec` (or bare provider name) and read `spec.model_id`; usage sites never inline a prefix strip. `lookup_price` returns `None` for unknown models with no workspace `cost_overrides` entry; the runtime translates that into `ResultPayload.total_cost_usd = None` so the projection's truthy-cost gate hides the cost row in the UI. Ollama rows in `PRICE_PER_MTOK` are explicitly zero (local compute carries no real USD); the row stays visible at `$0.00`. Workspace `max_tokens_override` short-circuits the context-window lookup for models outside the curated table.

**Tool-call graceful degradation.** Tools register regardless of model capability. The single `NotImplementedError` catch sits in `LangGraphRuntime._build_graph()`: when a provider/model cannot `bind_tools()` (Perplexity, some HuggingFace pipelines) it logs `provider_no_tool_calling` with provider/model context and rebuilds with `tools=[]`, continuing chat-only rather than failing loud - the same UX as a model that simply chose not to call a tool. Tool factories in `langgraph_tools/*` stay provider-unaware.

**Tool-call error degradation.** The sibling case: a raising tool degrades to a failed tool result instead of ending the run. `ClaudeboxToolHookMiddleware.awrap_tool_call` catches `ToolException` (every claudebox tool's own failure signal) and returns an error `ToolMessage` instead of letting `ToolNode`'s default re-raise end the turn — matching the Claude runtime's `is_error` contract. Any other exception still re-raises unchanged. `_drive_turn` also projects LangChain's `on_tool_error` callback event (fired on the tool's own span even after the middleware recovers), gated to `ToolException` so an unrecovered bug still ends the turn.

**Error contract.** All in `agent_session/errors.py`: `ProviderError(Exception)` abstract base; `ProviderPackageMissing(provider, install_hint)` raised when `init_chat_model` hits `ImportError`; `OllamaUnreachable(url)` + `OllamaModelNotPulled(model)` from Ollama probes; `OpenAICompatibleUnreachable(url)` from the OpenAI-compatible probe (distinct class, NOT collapsed into OllamaUnreachable — diagnostic message references the OpenAI-compatible base_url specifically). All four typed exceptions inherit from `ProviderError`; the handler layer maps `isinstance(exc, ProviderError)` to typed HTTP responses (422 for missing-package and model-not-pulled, 503 for unreachable).

**Capability matrix unchanged.** The flat 16-flag `RuntimeCapabilities` matrix is provider-agnostic — no per-provider variation in flags. Provider differences surface via behaviour, not the matrix: catalogless providers return `[]` from `get_models()` (frontend shows empty picker); models with no curated price return `None` cost (frontend hides cost row); chat-only models build a `tools=[]` graph (conversation continues without tool blocks). Frontend's existing capability gating handles all three gracefully.

**Workspace TOML is the single source of truth — no backward-compat shims.** Workspaces declare the explicit `model = "provider:model-id"` form; `[langgraph.<provider>]` sub-tables carry per-provider kwargs forwarded verbatim to `init_chat_model`; `[langgraph.cost]` overrides the curated price table per model_id. `ProviderSpec.parse` rejects bare model ids and malformed input — no auto-prefix, no convenience default URL.

Capability profile (concrete worked example):

- Mid-session control plane mutations (`set_model`, `set_permission_mode`, `set_effort_level`) — **all False**. Model bound at graph construction; permission / effort have no native equivalents.
- MCP delegation — **False (v1)**. `langchain-mcp-adapters` 0.2.x has no runtime per-server toggle; a follow-up builds it in the adapter layer.
- Catalogs — `supports_models: True` (dynamic from Ollama `/api/tags`); `supports_skills: True` (§ below); `supports_effort_levels: False`; `supports_permission_modes: False`.
- Telemetry — `supports_context_usage: True` (`usage_metadata` from the latest model call is the occupancy level, not a running sum, since each call re-sends the whole conversation; seeded from the checkpoint's last `AIMessage` on `connect()` so a resumed session reads its real size immediately. Compaction puts its summary at the *head* of the list and preserves the most recent messages after it (`keep` defaults to 20), so a checkpoint written between a compaction and the reply that follows it still carries a pre-compaction `AIMessage` whose `usage_metadata` describes a prompt that no longer exists — and the compaction hook runs before *every* model call, so that state also occurs mid-tool-loop, where the tail is tool results rather than a prompt. Neither shape is distinguishable by position. Each compaction therefore records its own `post_tokens` alongside the length and last message id of what it kept (`{session_dir}/compaction.json`); on resume, anything after that point carries post-compaction usage and wins, and if nothing follows it the recorded count is used. A record whose last message id no longer sits where it was written is discarded, so a fork or rewind cannot seed from a history the thread no longer has). `supports_cost_telemetry: True` (tokens native; USD via per-model `PRICE_PER_MTOK` table — toy registry at v1).
- Hooks — `supports_pre_compact_hook: True` (synthesized via token-fraction threshold; `SummarizationMiddleware` does the actual compaction). `supports_manual_compact: False`.
- Session ops — `supports_session_resume: True`, `supports_session_fork: True`, `supports_session_rewind: True`. All native via `AsyncSqliteSaver`; rewind truncates the checkpoint chain at the fork turn (see "Fork" below) so the model's recall matches the truncated transcript, the same contract the Claude runtime gives.

Selection: per-workspace via `.claudebox/settings.toml` — top-level `agent` selects the adapter, `[langgraph]` carries adapter-private knobs, `[langgraph.<provider>]` carries per-provider kwargs:

```toml
agent = "langgraph"

[langgraph]
model = "anthropic:claude-opus-5"
# max_tokens_override = 65536  # optional, pins the context window for models outside MODEL_CONTEXT_WINDOW

[langgraph.anthropic]
# no required knobs - ANTHROPIC_API_KEY resolved from the shell

[langgraph.ollama]
base_url = "http://host.containers.internal:11434"

[langgraph.openai]
base_url = "http://127.0.0.1:8000/v1"   # vLLM / LM Studio / llama.cpp's OpenAI-compatible server
# probe_on_connect = true               # opt-in /v1/models pre-flight at session start

[langgraph.cost]
"my-custom-model:7b" = { input = 0.5, output = 1.5 }
```

`max_tokens_override` short-circuits the per-model context-window lookup so workspaces running a model outside `MODEL_CONTEXT_WINDOW` can declare the right ceiling without code changes — the PreCompact threshold and the UI usage bar both honour the override. `[langgraph.cost]` overrides curated USD-per-million-token rates for models not in `PRICE_PER_MTOK`.

Persistence: each session gets its own `checkpoints.sqlite` inside the session directory alongside `events.jsonl` + `session.json`. Cross-container-restart resume is automatic (bind-mounted from the host).

**Fork.** `checkpoints.sqlite` is keyed by `thread_id`, pinned to `session_id` (`LangGraphRuntime.__init__`) - a filesystem copy alone would leave the fork's checkpoint rows pointing at the parent's `thread_id`, so the forked graph would read empty state on first resume. `claudebox_daemon/domain/sessions/service.py::SessionService._rekey_langgraph_checkpoint` re-keys every row in the copied `checkpoints`/`writes` tables from the parent's `thread_id` to the fork's own, right after the filesystem copy; `checkpoint`/`metadata` payloads never carry the thread_id internally, so only the key column needs rewriting.

Truncation then matches the fork's checkpoint chain to its transcript. `LangGraphRuntime._record_turn_boundary` runs at the start of every turn, journaling the checkpoint id current just before it to `checkpoint_turns.json` under the `turn_id` `TurnTracker` derives from that turn's human-message `uuid` (a thread's first turn journals `None`). `_copy_claudebox_session` carries the journal to the child unmodified, and a turn-bounded `fork()` has `SessionService._truncate_langgraph_checkpoint` look that boundary up and issue `DELETE ... WHERE thread_id = ? AND checkpoint_id > ?` against both re-keyed tables - dropping the thread's rows outright when the boundary is `None` (a fork at the first turn). The model therefore recalls only what the truncated transcript shows: the contract `AsyncSqliteSaver` time-travel gives through `aget_state_history`, reached by a direct delete rather than a LangGraph-native truncation call. A whole-session fork (`turn_id=None`) skips truncation and keeps the full chain; no-op under the Claude runtime, which has no `checkpoints.sqlite`.

Failure modes: dispatched per-provider via `PROVIDER_STRATEGIES` (see "Provider strategy registry" above). Ollama probes both reachability and model-pulled when `base_url` is set; OpenAI-compatible servers (vLLM / LM Studio / llama.cpp) probe `/v1/models` opt-in via `probe_on_connect`; cloud providers (Anthropic, OpenAI, Google Gemini, Groq, Mistral, ...) have no probe and surface auth / network errors naturally at first `query()`. Typed exceptions in `agent_session/errors.py` — `OllamaUnreachable(url)`, `OllamaModelNotPulled(model)`, `OpenAICompatibleUnreachable(url)`, `ProviderPackageMissing(provider, install_hint)` — all inherit from `ProviderError`; the container API handler maps `isinstance(exc, ProviderError)` to typed HTTP responses (422 for missing-package + model-not-pulled; 503 for unreachable). Tool execution errors propagate `is_error=True` through `tool_result` blocks to the frontend's error styling.

Tool surface: every `@tool`-decorated function lives under `agent_session/langgraph_tools/`, one module per subscope (`filesystem.py`, `search.py`, `shell.py`, `notebook.py`, `web.py`, ...). `langgraph_tools/__init__.py::make_tools(ctx)` is the single registration site, called once by `runtime_langgraph.connect()` after the chat model is built. The `ToolContext` DI bundle (`_context.py`) carries workspace path, session id, session dir, config, hooks, logger, and a mutable `ToolCatalog` populated AFTER aggregation, so self-discovery tools (`tool_search`) read the full bound set lazily at invoke time. The import audit's `langchain/langgraph` rule allowlists `langgraph_tools/**/*.py` to import `langchain_core.tools` directly; no other claudebox module may.

`web_fetch` SSRF guard: `web.py`'s `_guard_url` resolves the hostname via `socket.getaddrinfo` and rejects loopback / private / link-local (including the `169.254.169.254` metadata endpoint) / reserved / multicast / unspecified addresses before any request is made. `_guarded_get` re-runs that check on every redirect hop rather than trusting `httpx`'s `follow_redirects`, closing the bypass a single up-front check would leave open, and reads the body via `iter_text()` capped as bytes arrive, so nothing buffers unbounded before the 100 KB cap engages. **Known limitation**: validating a hostname before connecting leaves DNS rebinding open in principle; closing it needs the resolved address pinned through to the connection. Accepted as disproportionate for a local dev tool with a narrow threat model; revisit if `web_fetch` gains a broader deployment story.

Hook surface — PreToolUse / PostToolUse: `HookCallbacks` (in `hooks.py`) exposes `on_pre_tool_use(PreToolUsePayload)` and `on_post_tool_use(PostToolUsePayload)` typed callbacks shared by both runtimes. LangGraph fires them via `ClaudeboxToolHookMiddleware` (in `langgraph_tools/_middleware.py`), an `AgentMiddleware` that overrides `awrap_tool_call` and is composed OUTERMOST in `connect()`'s middleware list — so its observations wrap any retry / modification logic an inner middleware might introduce. The pre callback fires before the handler runs; the post callback fires after with `duration_ms` from `time.monotonic`, `is_error` derived from `ToolMessage.status == "error"`, and `tool_use_result` projected from the `ToolMessage.content`. If the handler raises, the post callback still fires with `is_error=True` and a `None` result before the exception propagates — consumers always observe a matched pair. ClaudeRuntime fires the same callbacks via SDK adapters: `_adapt_pre_tool_use` records a per-`tool_use_id` start time and fires the pre callback; `_adapt_post_tool_use` extends the existing permission-mode-drift detector to additionally fire the post callback with `is_error=False`; `_adapt_post_tool_use_failure` (new) fires the post callback with `is_error=True`. Per-`tool_use_id` timing converts to `duration_ms` on the post side.

**No approval layer under LangGraph.** `ClaudeboxToolHookMiddleware.awrap_tool_call` awaits `on_pre_tool_use` for its side effects (telemetry, logging) and discards whatever it returns; `handler(request)` — the actual tool call — always runs, with no path to deny it. This is a structural difference from Claude, whose CLI can act on a PreToolUse hook's decision to block a call before it executes. Combined with `permission_mode` having no LangGraph equivalent (`set_permission_mode` raises `CapabilityNotSupported`, §1.4), the container is the entire isolation boundary for a LangGraph workspace's tool surface — an accepted design point, not a gap pending a fix.

Sub-agent dispatch — `task(description, agent_type)`: the LangGraph `task` tool (in `langgraph_tools/subagent.py`) spawns a focused sub-agent on demand. Each call constructs a fresh `create_agent` sub-graph against a model produced by `ToolContext.chat_model_factory()` and the parent's full tool surface filtered through the named `AgentDefinition`'s allowlist (`None` = inherit every tool; otherwise the named subset). The sub-graph runs WITHOUT `ClaudeboxToolHookMiddleware` and WITHOUT a checkpointer — its own tool invocations stay encapsulated inside the awaited `ainvoke` and never bubble up to the parent's `astream_events` loop, matching Claude's Task tool semantics. Named agents live in `agent_session/_agent_registry.py` (a shared, runtime-neutral module); v1 ships one hardcoded `general-purpose` definition, with cross-runtime CLAUDE.md parsing as a follow-up. Recursion is bounded via a `subagent_depth` counter on `ToolContext` — each nested call builds a child context with `dataclasses.replace(ctx, subagent_depth=ctx.subagent_depth + 1)`; once the next depth would exceed `_MAX_SUBAGENT_DEPTH` (3), the tool raises `ToolException` so the model can recover. Cost telemetry aggregates: after the sub-graph completes, the `task` tool sums `usage_metadata.input_tokens` + `output_tokens` across every emitted `AIMessage` and calls `ctx.record_subagent_usage(input, output)`, which the runtime binds to `_accumulate_subagent_usage` — the sub-agent's USD contribution lands in `_used_tokens`, `_total_cost_usd`, and a per-turn counter that folds into the closing `_result_event.cost_usd` so the parent's emitted turn cost reflects sub-agent work spawned during it.

AskUserQuestion via interrupt() - `ask_user_question(questions)`: the LangGraph `ask_user_question` tool (in `langgraph_tools/question.py`) calls `langgraph.types.interrupt({"questions": questions})` and returns whatever value the runtime supplies on resume. Frontend UX is identical to Claude: the `on_chat_model_end` event for the tool-call turn projects an `assistant_message` with `tool_use(name="ask_user_question", input={questions})`; the frontend's existing `InteractiveQuestions` form renders the question cards; the user's selections submit via the standard `send()` -> `/api/send` path, wrapped in `<response:AskUserQuestion>...</response:AskUserQuestion>`. The runtime detects the paused graph after `astream_events` ends by probing `await self._graph.aget_state(config)` for any task with a non-empty `interrupts` tuple (`_has_pending_interrupt`); when present, `_awaiting_resume` is set so the next `query()` builds a `Command(resume=<wrapped-text>)` instead of a fresh `HumanMessage` turn. The `interrupt()` call inside `ask_user_question` returns the wrapped text; the @tool returns it as the tool result; the model sees the answer in its next chat-model invocation. NO new event kind, NO new HTTP endpoint, NO `Protocol.resume()` method - the answer delivery is the existing user-text path. Capability flag `supports_ask_user_question` (both runtimes True) gates the frontend's `InteractiveQuestions` form so future runtimes without HITL support do not render it. A message typed alongside the answer does NOT join this wrapped text - it travels as a sibling `note` field on the same send (`ChatRequest.note` -> `PublishedEvent.note`), since the transcript's copy/render logic matches the wrapped answer with an anchored `^<response:(?:AskUserQuestion|ExitPlanMode)>...$` regex that any prefix or suffix would break.

Task management - `task_create`, `task_get`, `task_list`, `task_output`, `task_stop`, `task_update`: the LangGraph `task_*` tools (in `langgraph_tools/task_mgmt.py`) are thin wrappers over `agent_session/_tasks.py::TaskService` - the daemon-service-shaped backing store the LangGraph runtime owns. `TaskService` lives in-container, in-process with the runtime: one instance per session, numeric monotonic ids matching Claude's UX, in-memory cache. There is NO separate `tasks.json` file - the canonical persistent log is `events.jsonl` (the same stream the frontend's `extractTasks` derives panel state from); `TaskService.rebuild_from_events(events_path)` replays prior `task_create` / `task_update` / `task_stop` / `task_output` tool_use entries on `connect()` so resume after container restart reconstructs the cache. Wire-format input / output keys are camelCase (`subject`, `description`, `activeForm`, `taskId`, `addBlockedBy`, `statusFilter`) to match Claude's TaskCreate / TaskUpdate shape; the in-chat `appendTaskDiffs` and panel rendering paths key on these names unchanged. The single Claude-vs-LangGraph deviation is the tool _name_ itself (`task_create` vs `TaskCreate`); `claudebox_frontend/src/config/schema.js::TOOL_NAME_ALIASES` + `normalizeToolName()` is the single normalisation point - `getToolConfig` and `appendTaskDiffs` both call it before lookup / gate comparison so the rest of the rendering pipeline reads the canonical Claude name. `DaemonServiceBundle` (shared `agent_session/_daemon_services.py`, frozen dataclass) carries `.tasks` on `ToolContext.daemon_services`; future subscopes will extend the bundle with `.worktrees` and `.scheduler` following the same pattern.

MCP resources + server-tools - `list_mcp_resources()`, `read_mcp_resource(uri)`, plus per-server tool binding: the LangGraph runtime wires Model Context Protocol servers (configured per workspace via `[langgraph.mcp.<name>]` TOML blocks) through `langchain-mcp-adapters`'s `MultiServerMCPClient`. Each `[langgraph.mcp.*]` sub-table is a connection dict (`transport: stdio | sse | streamable_http | websocket`, plus `command`/`args`/`env` for stdio or `url`/headers for HTTP variants) parsed in `claudebox/config.py::Config.langgraph_mcp_servers` and threaded through `orchestration/session.py` into `LangGraphAgentSessionConfig.mcp_servers`. `runtime_langgraph.connect()` builds the client and calls `_load_mcp_server_tools(client)` BEFORE `make_tools(ctx)` aggregates; the loader iterates `client.connections`, calls `get_tools(server_name=...)` per server in isolation, catches any exception into `self._mcp_failures: dict[str, str]`, and returns only the successful subset. This implements upstream issue #492's "one bad server does not poison the others" rule defensively. The runtime then constructs the ToolContext with `mcp_client=self._mcp_client` (a new field on ToolContext, placed alphabetically) and appends the surviving MCP-server tools after the local tool list: `tools = [*make_tools(ctx), *mcp_server_tools]`. `langgraph_tools/mcp.py` ships the two resource-side tools: `list_mcp_resources()` aggregates `client.get_resources(server_name=...)` per server (catching failures into the result list as `{server, error}` entries so the model can react), projecting each `Blob` into `{server, uri, name, description, mimetype}` dicts; `read_mcp_resource(uri)` tries each connected server in turn via `get_resources(server_name=..., uris=uri)` and returns the first matching server's content, raising `ToolException` when no server resolves the URI. The capability flag `supports_mcp_delegation` STAYS False - the MCP control panel UI gates on per-server runtime toggles (enable/disable, reconnect, status) that `langchain-mcp-adapters` 0.2.x does not expose; wrapping the client with a runtime-toggle adapter and flipping the flag is a follow-up. The model still invokes MCP server tools and resources transparently via tool_use blocks - the user-facing surface is the tool block, not a panel. **Network reach callout**: MCP servers with HTTP/SSE transports reach external services (same posture as WebFetch + WebSearch). The README documents the network surface; workspaces with strict privacy requirements review configured MCP servers before adoption.

ToolSearch - `tool_search(query, max_results=5)`: the LangGraph `tool_search` tool (in `langgraph_tools/meta.py`) is a self-discovery aid. Semantic divergence from Claude's `MCPSearch`: Claude's tool surface keeps a long tail of tool schemas unbound at session start (token-budget pressure) and `MCPSearch` fetches specific schemas on demand. LangGraph binds every tool at graph construction time (`create_agent` materialises the full toolset; the system prompt accommodates all descriptions), so `tool_search` is discovery-only, not deferred loading - every result it surfaces is already callable. The factory closes over `ctx.tool_catalog`, which `connect()` populates AFTER `make_tools(ctx)` returns (the catalog-after-aggregation pattern); the tool reads `.tools` lazily at invoke time so it sees the full bound set, including `tool_search` itself. Scoring: `score = 3 * name.count(query) + description.count(query)` (case-insensitive substring count); zero-score entries dropped; sort descending; return top `max_results` as `{name, description[:200]}` dicts. Implementers tempted to graft deferred-loading on top of this surface should refer to this note - LangGraph's static binding is the design.

Skill - `skill(name, arguments)`: the LangGraph `skill` tool (in `langgraph_tools/skill.py`) invokes a workspace skill by name. Skills are filesystem objects shared with Claude workspaces - `agent_session/_skills.py::walk_skills(commands_dir, skills_dir) -> list[Skill]` is the runtime-neutral discovery helper extracted from `ClaudeRuntime._parse_frontmatter` / `get_skills` so both adapters produce identical catalogs against the same `<commands_dir>/*.md` + `<skills_dir>/<name>/SKILL.md` files. At invoke time the tool calls `find_skill_source(name)` to resolve the source `.md` path, reads it, strips the YAML frontmatter via `extract_body`, and returns the body verbatim - the model treats it as turn-level instructions matching Claude's slash-command UX. When `arguments` is provided, a trailing `ARGUMENTS: {arguments}` line is appended so skills can react to user input forwarded through the call (parameter named `arguments` rather than `args` to avoid LangChain's reserved `v__args` varargs binding). Unknown names raise `ToolException` carrying the sorted available-name list so the model can recover. `LangGraphRuntime.CAPABILITIES.supports_skills` is True; the frontend's skills panel and slash-command autocomplete (gated on the flag) light up under LangGraph workspaces automatically.

Frontmatter gates two distinct paths, not one: the `skill` tool itself refuses (`ToolException`) a `disable-model-invocation` skill, since a model tool call is the only way it can reach this path; a user-typed `/<skill>` never goes through this tool at all - `runtime_langgraph._resolve_slash_skill` (called from `_drive_turn`) resolves it directly against the same `find_skill_source`/`parse_frontmatter` helpers and checks `user-invocable` instead, falling back to literal text for `user-invocable: false` or an unrecognized name. `allowed-tools` / `model` / `effort` are parsed into `catalogs.Skill` but unenforced on either path - LangGraph binds tools and the model at graph construction (`_build_graph`), so scoping either per-skill would mean running the skill as a sub-agent graph rather than turn-level text.

**Display echo matches Claude's tag format.** `runtime_langgraph._tag_slash_command` wraps any leading `/<name> [args]` in the same `<command-message>`/`<command-name>`/`<command-args>` tags Claude's CLI produces (`docs/reference/XML.md`), applied in `_human_message_event` to the DISPLAY event only - independent of whether `_resolve_slash_skill` found a matching skill, matching Claude tagging an unrecognized command the same way. The frontend's `parseSlashCommand` (`utils/parsers.js`) is the single consumer of this format on either runtime, so the bold/underline/hover-card styling (`claim:chat:user-message-slash-command-styling`) now lights up identically regardless of which runtime produced the tags. The model-facing turn never sees these tags - it receives the resolved skill body or the untagged literal prompt, per `_drive_turn`.

Frontend (per §1.5 "Capability-Aware Frontend Wiring") honors LangGraph's profile — footer pickers for effort / permission / model-mid-session, manual compact button, and MCP panel hidden. Token usage bar, cost display, runtime identity pill ("LangGraph"), session resume / fork / rewind controls, skills panel, and slash-command autocomplete render.

No claudebox code outside `agent_session/runtime_langgraph.py` knows about LangGraph. The Protocol is the entire contract; the import audit's prefix-pattern rule (see GUIDELINES §SDK Containment) keeps it that way and auto-covers future `langchain_*`/`langgraph_*` provider packages.

**ADR — no external agent protocol adopted.** A multi-source survey (AG-UI Protocol, A2A, ACP, AGNTCY, OpenAI Agents SDK, LangGraph, OpenAI Responses, Vercel AI SDK, MAF, Llama Stack/OGX) found no public standard covering the host↔runtime SPI — these target adjacent layers (runtime↔UI, inter-org agent↔agent, model wire format) or model the lifecycle differently (stateless run vs. stateful session). AG-UI / A2A / OpenAI Responses are export-edge translation targets if claudebox ever grows an external surface; they are not internal contracts.

**Profile CLI hooks vs in-process SDK hooks.** Profile-level CLI hooks (`profile/hooks/*.py`, the `@hook`-decorated scripts) are a **separate mechanism** from the in-process SDK hooks described above. Profile hooks fire via Claude CLI's `~/.claude/settings.json` `hooks` array — the CLI subprocess invokes them with stdin/stdout JSON. They are Claude-Code-coupled by transport; non-CC runtimes have no analog unless they implement an equivalent settings.json hook mechanism, and profile hooks are silently inert under them. See §3.6 for profile hook implementation details.

#### 1.4.1 Per-Session `settings.json` Isolation

Containers in the same workspace share the host mount of `~/.claude/`, so without isolation the SDK would overwrite a single `settings.json` across every concurrent session — runtime config flips (model, permission, effort) bleed across sessions.

`ClaudeRuntime.connect()` replaces `~/.claude/settings.json` with a symlink to a per-session file early in the connect path, before forwarding to the SDK's `connect()`. The rest of `~/.claude/` (auth tokens, history, MCP state) stays shared. This is a ClaudeRuntime-specific concern — future runtimes have no `~/.claude/` to isolate.

Four-step flow:

1. **Mount** — claudebox CLI runtime mounts `{config_dir}/fs/root/.claude/` → `~/.claude/` inside the container.
2. **Profile seed (optional)** — if the profile's `container-start.sh` seeds `~/.claude/settings.json` (e.g., by `cp --remove-destination ~/.claudebox/profile/settings.json ~/.claude/settings.json`), those defaults apply.
3. **Per-session seed** — `ClaudeRuntime.connect()` resolves `session_dir` from the `ClaudeAgentSessionConfig` and copies `~/.claude/settings.json` → `{session_dir}/claude.json` if (and only if) the per-session file does not already exist.
4. **Symlink bind** — `ClaudeRuntime.connect()` replaces `~/.claude/settings.json` with a symlink to `{session_dir}/claude.json`. SDK reads/writes follow the symlink.

Effects:

- First-ever session: per-session file is seeded from `~/.claude/settings.json` — profile defaults if step 2 ran, empty otherwise; symlink directs SDK writes there.
- Resume: the per-session file from the prior session is reused; the seed is skipped, runtime changes survive.
- Container restart while session resumes: any step 2 re-seed is bypassed by step 3's existence check — per-session state is preserved when step 4 re-binds the symlink.
- Fork: new `session_id` → new `session_dir` → step 3 seeds from the parent's currently-symlinked target (`shutil.copy` follows the symlink), so the fork inherits the parent's runtime config.

### 1.5 Session Orchestration

Session lifecycle, event pipeline, conversion, persistence, projection, and broadcaster all live in `claudebox/agent_session/orchestration/` — adjacent to but distinct from the Protocol seam (§1.4). Orchestration consumes an `AgentSession` runtime adapter via the Protocol; nothing here imports `claude_agent_sdk`. The HTTP plumbing layer (§4) holds the FastAPI lifespan glue (`current` singleton, `managed()` context manager, `get_session` dependency) and the handlers that route REST calls into the `Session` facade — but the orchestration code itself is core, not container-API plumbing.

#### Domain Glossary

| Term | Definition |
|------|-----------|
| **AgentEvent** | Runtime-neutral event yielded by `AgentSession.receive_events`. Carries a `kind` discriminator and an SDK-free `payload` dict projected from the runtime's native message shape inside `ClaudeRuntime._translate_sdk_message` (§1.4). |
| **Event** | Intermediate representation of a single content block within an AgentEvent — pipeline-internal. One AgentEvent expands to ≥1 Events via `dict_message_to_events` (text / thinking / tool_use / tool_result blocks each become their own Event). |
| **PublishedEvent** | Event enriched with ID, timestamp, turn ID, and promoted fields. Persisted and broadcast. |
| **Turn** | A user→assistant exchange. Bounded by user messages; assigned a `turn_id` by TurnTracker. |
| **Result-only turn** | Result-kind AgentEvent for a turn that emitted no assistant AgentEvent (e.g., unknown slash command). Pipeline injects synthetic events to make it visible. Detection is turn-scoped via TurnTracker, so a trailing result after a mid-response error does not re-surface an already-emitted assistant message. |
| **Projection** | Derived session summary (`session.json`) accumulated from events. Recomputable from `events.jsonl`. |
| **Synthetic user message** | Runtime-emitted user-kind AgentEvent whose payload `content` is system-generated rather than human-authored (compaction context, local-command stdout/stderr, task notifications, hook context, system reminders). Detected by `_SYNTHETIC_USER_MARKERS` prefix matching in `conversion._is_synthetic_user_message`. |

#### Component Ownership

```
Session (facade)
├── creates at start(): EventPipeline, Broadcaster, ToolOutput, AttachmentService
├── creates lazily on system_init AgentEvent: Projection (so list_sessions() can return throwaway projections without a live session)
├── uses: AgentSession (claudebox.agent_session) — currently ClaudeRuntime; FileCache (claudebox.core); SessionRepository (claudebox.session)
│
├── EventPipeline (orchestrator)
│   ├── owns: EventLog, TurnTracker, AsyncTaskManager
│   └── flow: AgentEvent → enrich → persist → callback → Session
│
├── Projection (derived state)
│   ├── written by: Session._handle_event (update on every event, save coalesced via 500ms debounce)
│   └── source: events → session.json
│
├── Broadcaster (fan-out)
│   ├── written by: Session._handle_event
│   └── read by: SSE subscribers via Session.subscribe()
│
└── FileCache (optimization)
    └── caches: session.json summaries by mtime
```

#### Event Pipeline

**Outbound flow** (Runtime → Frontend):

```
AgentSession.receive_events() → AgentEvent stream
  → EventPipeline._run() [background task]
    → TurnTracker.on_event(agent_event)               # update current turn_id from user-kind payload
    → dict_message_to_events({"type": kind,           # one AgentEvent expands to ≥1 Events
                              "message": payload})    # per content block (text/thinking/tool_use/tool_result)
      → Event[]
    → TurnTracker.resolve(event) → turn_id
    → to_published_event(event, id, ts, turn_id) → PublishedEvent
    → [enrich async task notifications]
    → EventLog.append(event)           # persist to events.jsonl
    → Session._handle_event(event)     # callback
      → Broadcaster.broadcast(event)   # push to all SSE queues
      → Projection.update(event)       # update session.json
```

SDK-message-to-AgentEvent projection happens inside `ClaudeRuntime._translate_sdk_message` (§1.4) before the stream reaches the pipeline — no module in `claudebox/agent_session/orchestration/` imports `claude_agent_sdk` (enforced by the import audit per GUIDELINES §SDK Containment).

**Event model hierarchy**:

```
Event (intermediate)
  type, subtype, content, primary, is_human, raw

PublishedEvent(Event) (persisted + broadcast)
  + id, ts, turn_id
  + tool_use_id, tool_name, tool_input, is_error, tool_use_result
  + model, previous_model, permission_mode, previous_permission_mode, effort_level, previous_effort_level
  + cost_usd, duration_ms, context_tokens
  + message_data, parent_tool_use_id, source_file, source_offset, count
  + attachments, inline_replies
```

**Attachment / inline-reply send divergence**: user messages carrying attachments or inline replies reuse one pattern in `SessionService.send` — inject a display-only synthetic user event (`content=prompt` plus display metadata: attachment chips and/or `inline_replies` quote/reply pairs), call `suppress_next_user_echo()` so the pipeline drops the SDK's echo, and send the SDK a single richer content-block turn (the free-text prompt, then the serialized `<inline-replies>` envelope, then attachment blocks). The display event keeps `content=prompt` (never the serialized envelope) so the frontend's optimistic pending turn reconciles by content. Client-side, inline replies render as span-anchored floating composers: quoting paints a durable highlight (CSS Custom Highlight API - a dotted underline over the accent fill) on the quoted span and opens its reply box in a z-axis popover pinned to that span's client rect, tracked on scroll/resize and on the re-anchor pass; there is no in-transcript dock or side bar. Quoting covers any selectable turn text including tool-block and thinking-block output (non-text media excluded). Hovering a highlight shows its composer transiently (read-only once sent, editable while unsent) via a span-to-composer hover bridge; clicking toggles the pinned state through the same close path as the close button (closing an empty one discards the quote), testing the pinned set rather than visibility because hover usually opened the composer first, and suppressing hover for that highlight until the pointer leaves it; the click is drag-distance-gated so a selection merely ending on a highlight toggles nothing; crowding composers auto-offset so they never overlap. A collapsed source turn hides its composer (source turns are not exempt from auto-collapse). A single `InlineThreadsOverlay` owns the document-global highlight registry and the floating composers (both live outside the memoized turn render path), re-anchoring on each transcript mutation. The unsent buffer persists per session in `localStorage` with each reply's text-quote anchor (quote + prefix/suffix context + char offset); sent-reply anchors ride the display-only user event, so composers re-anchor at their source turns on reload. Anchors reach the event and reload but are stripped from the Claude wire by the `<inline-replies>` allowlist (`from`/`quote`/`response`), leaving the wire payload unchanged.

**Float placement clamps before it stacks.** `.inline-float` carries a definite CSS `width` (not `max-width`) so a box near the transcript edge doesn't shrink-fit into a narrow column. `overlayDom.js`'s `clampHorizontal(box, bounds)` pulls `left` inside the transcript's own bounds (not the viewport, since the float is portalled to `document.body`) before `stackFloats` resolves vertical collisions. `useSelectionQuote`'s floating quote button applies the same clamp against an approximate fixed footprint, since it has no ref to measure before mount.

**Event types**: `user`, `assistant`, `system`, `result`.
**Subtypes**: `message`, `text`, `thinking`, `tool_use`, `tool_result`, `compact_start`, `compact_boundary`, `task_notification`, `init`, `error`, `interrupt_sent`, `replay_started`, `replay_ended`, `model_changed`, `permission_mode_changed`, `effort_level_changed`, `hook_response`.

#### SSE & Replay

New subscriber flow:

```
GET /api/stream
  → Broadcaster.subscribe() → (id, asyncio.Queue)
  → EventLog.read_all() → historical events
  → Broadcaster.replay_to(queue, events)
    → replay_started {count: N}
    → event, event, event...
    → replay_ended {count: 0}
  → live events (broadcast as they arrive)
```

Subscriber disconnect: `unsubscribe(id)` removes queue from broadcast map. After `Session.stop()` clears the broadcaster, `unsubscribe(id)` is a no-op — the SSE stream's `finally` cleanup runs without raising even when the session has already ended.

Readiness: the broadcaster and pipeline exist only between `start()` and `stop()`, so both `subscribe()` and `unsubscribe()` are safe to call outside that window — `subscribe()` raises the typed `SessionNotReady` (503) and `unsubscribe()` no-ops, neither raises `AttributeError`. `ensure_ready()` on the session is the single predicate behind this. The `/api/stream` handler calls it up front rather than relying on `subscribe()`, because `BroadcastEventSourceResponse` wraps a lazy generator: `subscribe()` runs only once the body is iterated, by which point the 200 headers are already committed and a raise can no longer produce the typed response. Every container passes through the not-ready window — the lifespan constructs the session but the daemon starts it later via `POST /api/sessions/new`.

#### Session Resume

```
POST /api/sessions/{id}/resume
  → Session.restart(resume_session_id)
    → stop() → cancel tasks, close files, clear components
    → start(resume_session_id)
      → EventPipeline._initialize(session_id)
      → EventLog.read_all() → historical events
      → AsyncTaskManager.reattach(events) → restart monitors for in-progress tasks
      → ClaudeRuntime.connect() with resume flag (composes BaseClaudeSDKClient; see §1.4)
      → SDK replays + continues
```

#### Async Task System

Monitors background Task agents spawned by the SDK:

1. **Detection**: `tool_result` with `isAsync=true` → `AsyncTaskManager._start_monitor()`
2. **Monitoring**: `AsyncTaskMonitor` tails the task's output file (JSONL), converts lines via `dict_message_to_events()`, emits as nested events with `parent_tool_use_id`
3. **Enrichment**: `task_notification` system events get their generic summary replaced with actual agent output from the output file
4. **Completion**: `task_notification` → `_stop_monitor()` → graceful drain
5. **Resume**: `reattach()` scans historical events for in-progress tasks, restarts monitors from last known file offset

#### Persistence

**events.jsonl** — append-only event log. Source of truth. One line per `PublishedEvent`, JSON-serialized.

**session.json** — derived projection. Recomputable from events. Contains: `session_id`, `session_dir`, `workspace`, `started_at`, `updated_at`, `name`, `model`, `runtime`, `provider`, `num_turns`, `permission_mode`, `effort_level`, `todos`, `total_cost_usd`, `total_duration_ms`, `last_context_tokens`, `context_window`, `first_message`, `last_message`, `commands`, `session_prompt`, `parent_session_id`, `fork_point_cost_usd`. `runtime` is the adapter's display name (`"Claude"` / `"LangGraph"`), stamped once at creation and never overwritten; resume warns on mismatch against the workspace's current `agent` setting rather than switching silently (§1.4.1's sibling concern for LangGraph). `provider` is the `provider:model` prefix, `None` under Claude.

**Claude → LangGraph session migration** (one-shot, `scripts/migrate_claude_to_langgraph.py`) — the reverse of the pipeline above. Parses `events.jsonl` into a LangChain message list (`runtime_langgraph.py::events_to_messages`, kept in the adapter file per SDK Containment since it constructs `langchain_core.messages` objects), seeds it into a fresh `checkpoints.sqlite` through the target workspace's own `LangGraphRuntime` and `graph.aupdate_state(..., as_node="model")`, then flips `session.json`'s `runtime`/`provider` via `SessionRepository.update()`. A Claude tool call with a LangGraph equivalent (`TOOL_NAME_TO_LANGGRAPH`) becomes a real tool call; anything else flattens to plain text. Thinking blocks are dropped - LangChain has no first-class carrier for reasoning content on seeded history - and the CLI reports how many were dropped; an attached image or document re-encodes from the session's own `attachments/` directory into the same multi-part content blocks a live send builds, falling back to a text note when the file is gone or no `attachments_dir` was given. Idempotent by construction: `events_to_messages` derives message ids from the input, so `add_messages` merges a re-seed by id instead of duplicating history, and the CLI checks `runtime == "LangGraph"` up front as a second independent guard. Conversion leaves a native LangGraph session needing no further translation; the reverse direction has no native-resume path, the Claude SDK's session store being opaque.

**rate-limits.json** — per-workspace plan-limit state (`RateLimitStore`,
`claudebox/agent_session/rate_limits.py`), one entry per SDK `rate_limit_type` keyed window,
folded from the `rate_limit` system event in `SessionService._handle_event`. Written
container-side only: the daemon never sees this event itself, since `ProxyStreamingResponse`
(`core/http.py:38`) forwards the container's SSE stream as opaque bytes rather than parsing it.
Both sides read the same file directly — the workspace is bind-mounted at the same path in the
container and on the host — via `RateLimitStore.get()`; no daemon-owned copy exists. Served as a
`rate_limits` sibling field on both `GET .../api/sessions/current` (container, in-session) and
`GET /api/workspaces/{id}/session-defaults` (daemon, pre-session), rather than a dedicated
endpoint, since both were already polled or fetched at the moments a transition needs to surface.
**Reconcile at session start**: every currently-stored window is marked unannounced
(`_handle_init`); each `rate_limit` event re-announces its window, upserting it (or clearing it,
for the `allowed` status the SDK announces for `five_hour` but never for `seven_day`); once the
session's first `result` event lands, any window still unannounced is dropped — the absence of an
announcement is the only "back to normal" signal the SDK gives for a weekly window.

#### Executor Ownership

The container API (§4) and the agent session (§1.5) run in **one process**, and therefore share **one default thread-pool executor** — the implicit pool behind `asyncio.to_thread(...)` and `run_in_executor(None, ...)`, sized `min(32, cpu_count + 4)`.

Both halves of session persistence ride that pool:

| Writer | Path onto the default pool |
|---|---|
| `EventLog.append` | `aiofiles` defaults `executor=None` |
| `Projection._async_save` | `run_in_executor(None, self._write)` |

Hence the invariant: **any long or unbounded synchronous work offloaded to the default executor can stall event persistence, and it does so silently** — the pipeline task stays alive, `is_alive` keeps returning true, nothing raises and nothing is logged; the consumer just parks mid-turn while the runtime keeps producing.

The boundary: **event persistence and projection writes own the default executor.** Any subsystem whose filesystem or CPU cost scales with user data owns a dedicated, bounded one instead. Currently that is `FileService`, holding a single-worker `ThreadPoolExecutor` for the workspace walk and releasing it in the `files.managed()` teardown — see GUIDELINES §1 Executor Ownership.

#### Capability-Aware Frontend Wiring

The frontend consumes the runtime capability surface (§1.4) to gate UI affordances that depend on optional features. The wiring is intentionally narrow:

- **Source of truth** — the session-info envelope (`GET /api/sessions/current`) and the workspace session-defaults endpoint (`GET /api/workspaces/{id}/session-defaults`) both carry `capabilities` (the 16-flag matrix) and `runtime_name` as sibling fields. The SSE init event payload also carries them on session-start.
- **Storage** — `SessionDataContext` exposes both fields on its read-only value. `useSessionDefaults` returns the daemon's pre-session response (used by the welcome screen before any container attaches).
- **Hook** — `useCapabilities()` returns `{capabilities, runtimeName}`, preferring the in-session source and falling back to session-defaults so the welcome screen behaves correctly before a session is alive.
- **Race window** — `capabilities === null` while neither source has resolved. Consumers default to **show-all** in that window so new sessions never flash an empty UI.
- **Runtime identity pill** — `RuntimeIdentityPill` renders the active runtime's name in the footer; it returns null during the race so no blank pill appears.
- **Test fixture** — `src/test-utils/mockCapabilities.js` produces an all-True capability dict with spread overrides. Component tests pass partial overrides to simulate runtimes that disable specific features.

Consumer components apply the gate inline:

```jsx
const { capabilities } = useCapabilities()
if (capabilities && !capabilities.supports_skills) return null
```

The pattern is enforced by GUIDELINES §1 Capability-Gated UI.

---

## 2. CLI (`claudebox_cli`)

Thin host-side entry point. Argument parsing lives in `host_cli.py` (one level above the package) as a verb-mode subparser graph: each verb registers a `cmd_*.handle(args)` callable via `set_defaults(handler=…)`, and the shared `claudebox.core.cli.cli()` runner dispatches `args.handler(args)` after `parser.parse_args()`. The framework's runner wraps `CalledProcessError → sys.exit(rc)` and `KeyboardInterrupt → 130` for all verbs.

### Verb surface

| Top-level verb | Implementation | Notes |
|---|---|---|
| `run` | `cmd_run` | Spawn agent session; threads container exit code through `sys.exit` |
| `build` | `cmd_build` | `--layer {all,agent}` maps to `ImageBuildMode.REBUILD/UPDATE`; default is cached build |
| `update` | `cmd_update` | Shells out to `~/.claudebox/lib/bin/install.sh`; concurrent runs blocked by install.sh's flock |
| `shell` | `cmd_shell` | Fresh container with `kind=shell` label |
| `prune` | `cmd_prune` | Stale dirs + dangling images + stopped containers; partial-failure tolerant |
| `logs` | `cmd_logs` | `daemon` (default, sync file tail) / `all` (async multiplex over daemon log + container SSE) |
| `status` | `cmd_status` | DAEMON / CONTAINERS / WORKSPACE rows; degraded mode via direct podman + filesystem reads |
| `doctor` | `cmd_doctor` | 11 ordered environment checks; aggregate exit 1 on any failure |
| `version` | `cmd_version` | Package version + branch/commit/install path/python/podman |

| Noun-group | Implementation | Sub-actions |
|---|---|---|
| `daemon` | `cmd_daemon` | `start` / `stop` / `restart` / `status` — systemctl `--user` wrappers |
| `containers` | `cmd_containers` | `list` / `stop {<id>\|all}` / `kill {<id>\|all}` — CLI-side prefix resolution; `all` via `asyncio.gather` |
| `workspaces` | `cmd_workspaces` | `list` / `register [<path>]` / `deregister <id>` — POST/DELETE on top-level `/api/workspaces` |

Workspace registration is explicit via `claudebox workspaces register`. Sessions in unregistered cwds fall back to cwd-as-workspace silently and skip writing a `.workspace` marker.

#### Help rendering

All three entry points — the CLI, the daemon (`claudeboxd`) and the container API server — share `HelpFormatter` in `claudebox/core/cli.py`, so colourising it colourises all of them. It derives from rich-argparse's raw-text formatter with two deliberate settings:

- **Markup interpretation off** (`text_markup` / `help_markup` = `False`). Help text legitimately contains square brackets (`[daemon]`, `[container <id>]`); Rich would otherwise read them as style tags and swallow the bracket with its contents. This is the same failure that silently removed the `logs all` source prefixes.
- **No automatic defaults.** Each option writes its own default into its help string, so none can print two, and one can describe behaviour ("cached build") where the literal value (`None`) would be meaningless.

Help renders through rich-argparse's own **stdout** console and degrades to plain text under `NO_COLOR`, a dumb terminal, or a pipe. The module-level `console` in the same file is stderr-bound and is not involved — routing help through it would break `--help | less` and the snapshot capture.

#### CLI cold path

Shell completion re-executes the whole program on **every keypress** (argcomplete global completion, registered by `install.sh`), and `argcomplete.autocomplete()` can only short-circuit after the module graph is already loaded. Whatever happens at import time is therefore paid per keystroke, which makes the cold path latency-critical.

Three rules keep it cheap:

| Rule | Why |
|---|---|
| The `claudebox` package root re-exports lazily (PEP 562 `__getattr__`; static tools see the real types through a `TYPE_CHECKING` block) | Eager re-exports pulled the agent SDK, the web-server stack and the container runtime into every invocation. `import claudebox` went from ~760 ms to ~6 ms, and `claudebox -h` from ~1216 ms to ~371 ms. |
| Consumers keep importing through the facade (`from claudebox import X`) | Required by the cross-package boundary audit, and free: the lazy root resolves each name to exactly its defining submodule, so a facade import now costs what a deep import would. Importing `claudebox.anything` executes the root `__init__` either way. |
| No import-time side effects in CLI entry modules | The install line spawned two `git` subprocesses while the parser was being built. `LazyEpilogParser` defers the epilog to `format_help()`, so only `--help` pays it. |

A CLI module that needs a heavy dependency for only some verbs imports it inside the function that uses it — `claudebox.containers` pulls structlog and the container backend, which help and completion must not pay for.

**Name collisions matter here.** A re-exported name that is also a submodule of the package is shadowed as soon as anything imports that submodule, because the import system binds the child on the parent. This bit `cli`: the `cli` runner lives in `core/cli.py`, while install metadata used to live in `claudebox/cli.py`, so resolving `epilog` replaced the `cli` function with the module. The metadata module is now `claudebox/install.py` and no export collides.

`e2e/cli/test_cold_path.py` guards the invariant structurally — no `git` during completion or a non-help verb — rather than by a wall-clock threshold that would be flaky in CI.

#### `logs all` follower supervision

In follow mode `logs all` is a supervised set of per-container followers (`_ContainerFollowers` in `cmd_logs.py`), not a fixed set resolved at startup. Two discovery inputs feed it:

| Input | Role |
|---|---|
| `GET /api/daemon/stream` | Wakes a reconcile as soon as a container lifecycle frame arrives. Reconnects with backoff and never exits — a daemon restart must not leave the command deaf. Because the feed replays nothing missed while disconnected, every reconnect also wakes a reconcile. |
| Periodic list reconcile | The single attach/detach decision point. Runs on every feed hint and at least every `_RECONCILE_SECONDS` regardless. |

**Both are required — do not delete the reconcile as redundant.** Two gaps make the feed alone insufficient:

- A `running` status is effectively never announced. `HealthMonitor._poll` calls `ContainerService.sync_state()` first, which assigns the status in place; the subsequent `update()` then sees no change and broadcasts nothing. The only dependable creation signal is `starting`, which fires before the container can serve logs.
- Containers the daemon adopts rather than creates are registered with no announcement at all.

Attachment is keyed on presence in the container list, not on having a live task. A stream that ends on its own is not re-opened while its container is still listed — it already reported its cause, and re-opening would replay the entire history again on every reconcile. The container becomes eligible again once it leaves the list and returns.

### 2.1 Config Hierarchy

TOML walk-up: `Config.load()` (in `claudebox.config`) searches from cwd upward for `.claudebox/settings.toml` files, deep-merges them (nearest wins). When `workspace_path` is provided, uses it directly without walking up. Config dataclass holds: `work_dir`, `config_dir`, `profile`, `agent`, `backend`, `mounts`, `ports`, `network_mode`, `env`, `containers_nested` (`[containers] nested`, default `false`), `editor_url_template` (`[editor] url_template`, optional).

`ContainerRuntime` combines `Config` + `ContainerBackend` + CLI flags into a single runtime object.

### 2.2 Build System

`build_image()` (in `claudebox.containers.build`) copies build context to a temp dir, overlays profile's `image-build.sh` hook, then calls `podman build`.

Three build modes (`ImageBuildMode` enum):

| Mode | Verb invocation | Behavior |
|------|----------------|----------|
| BUILD | `claudebox build` | Full cached build |
| UPDATE | `claudebox build --layer agent` | Force agent layer rebuild only (via build arg timestamp) |
| REBUILD | `claudebox build --layer all` | `--no-cache` full rebuild |

### 2.3 Container Launch

`run_container()` (in `claudebox.containers.run`) launches a TUI container:

`podman run --rm -it` with volumes + env → container runs interactively, exits on agent exit. `config.containers_nested` additionally grants `--device /dev/fuse` and a tmpfs-mounted graphroot (§3.7).

Web mode is launched by the daemon (§6), not by the CLI.

### 2.4 Volume Mounts

Mount types yielded by `get_volumes()` (in `claudebox.containers.run`):

| Mount | Host | Container | Purpose |
|-------|------|-----------|---------|
| Workspace | `{workspace}` | `{workspace}` | Project files (same path both sides) |
| Config mounts | `config.mounts` | (user-defined) | Custom volume mounts |
| Runtime overlay | `lib/container/run/fs/*` | `/*` | Entrypoint, scripts, .bash_env |
| Library source | `lib/` | `/root/.claudebox/lib` | Python packages + tests + config |
| Profile | `profile/` | `/root/.claudebox/profile` | User config, hooks, prompt |
| Sessions | `.claudebox/sessions` | `/root/.claudebox/sessions` | Session data persistence |
| Claude configs† | `.claudebox/fs/root/.claude` | `/root/.claude` | Claude Code settings dir |
| Claude config file† | `.claudebox/fs/root/.claude.json` | `/root/.claude.json` | Claude Code config file |

†Conditional: only when `agent == "claude"`.

### 2.5 Container Backend

`ContainerBackend` (in `claudebox.containers.backend`) abstracts podman/docker CLI differences. Key methods: `build_image()`, `run_container()`, `stop()`, `kill()`, `remove_container()`, `create_network()`, `print_container_logs()`, `inspect_container()`, `get_host_port()`, `list_containers()`. All commands go through `_exec()` which calls `subprocess.run()` (or `os.execvp()` when `replace=True`).

`LocalRuntime` spawns `container_api_server.py` as an ordinary host subprocess (no container, no network namespace) and passes `--host 127.0.0.1`, so the session API is reachable only from the host. The containerized path keeps the all-interfaces default, since its port is published from inside a container and a loopback bind there would be unreachable through the publish mapping — a session that never connects, not a closed one.

### 2.6 Container Lifecycle (Stop vs. Kill vs. Remove)

Container shutdown is split into three daemon-side operations:

| Daemon method | HTTP route | Backend call | Effect |
|---|---|---|---|
| `ContainerService.stop_container(id, grace_seconds=10)` | `POST /api/workspaces/{ws}/containers/{id}/stop` | `runtime.stop_container(...)` → `backend.stop` (SIGTERM with grace before SIGKILL) | Signal the container; leave it STOPPED in the registry |
| `ContainerService.kill_container(id)` | `POST /api/workspaces/{ws}/containers/{id}/kill` | `runtime.kill_container(...)` → `backend.kill` (SIGKILL) | Immediate kill; leave it STOPPED in the registry |
| `ContainerService.remove(id)` | (none — internal) | `runtime.remove_container(...)` → `podman rm --force` | Delete the registry entry + the container record |
| (composite) | `DELETE /api/workspaces/{ws}/containers/{id}` | `stop_container() → remove(id)` | Used by the web UI's tab-close behavior — preserved as a single round-trip |

CLI verbs:
- `containers stop <id>` → POST `/stop` (graceful SIGTERM with default 10s grace).
- `containers kill <id>` → POST `/kill` (immediate SIGKILL).

---

## 3. Container System

### 3.1 Containerfile (Multi-Stage)

Four installation layers in `lib/container/build/Containerfile`:

| Layer | Script | Content | Rebuild frequency |
|-------|--------|---------|-------------------|
| Base | `install_base.sh` | System packages, mise, Python 3.13, Node 24, uv, Rust, just, gh | Rare |
| Nesting | `install_containers.sh` | Podman-in-podman toolchain (§3.7); capability-gated at runtime, always baked | Rare |
| Profile | `install_profile.sh` | Overridden by `{profile}/hooks/image-build.sh` — dev tools, linters, runtimes | On profile change |
| Agent | `install_agent.sh` | Claude Code CLI (via mise) + Python dependencies and all LangGraph provider packages (`uv sync --extra langgraph-all` into `/opt/claudebox/.venv`, resolved fresh at build - `uv.lock` governs the host install only) | On `--update` |

Runtime config: `WORKDIR /workdir`, `BASH_ENV=/root/.bash_env`, `ENTRYPOINT ["/entrypoint.sh"]`.

### 3.2 Entrypoint Lifecycle

```
entrypoint.sh
  ├── trap container-end.sh hook on EXIT
  ├── source container-start.sh hook
  └── if default mode:
      └── claudebox-agent $CLAUDEBOX_AGENT [args]
          ├── on-agent-start-hook (interactive only, once)
          ├── trap on-agent-stop-hook EXIT
          │   └── executes profile's agent-stop.sh
          └── execute-claude()
              ├── detect noninteractive mode (mcp, plugin, -p, etc.)
              ├── claudebox-prompt → compile system prompt
              ├── if CLAUDEBOX_WEB=1 → launch container_api_launcher.sh
              │   else → launch claude TUI
              └── mise exec npm:@anthropic-ai/claude-code -- [agent] --system-prompt "$prompt" --permission-mode bypassPermissions
```

**Environment variables**: `CLAUDEBOX_AGENT` (agent type), `CLAUDEBOX_WEB` (0/1), `CLAUDEBOX_DEV` (0/1), `CLAUDEBOX_PWD` (workspace path), `CLAUDEBOX_VERBOSE` (0/1).

### 3.3 Prompt Compiler

`claudebox-prompt` compiles markdown prompts with `{{ }}` interpolation:

| Syntax | Resolution |
|--------|-----------|
| `{{ relative/path }}` | Relative to prompt file directory, recursively interpolated |
| `{{ @path }}` | Relative to workspace root (cwd at invocation time) |
| `{{ /absolute/path }}` | Absolute path, included as-is |
| `{{ !function }}` | Calls `fn_function()` bash function |

Built-in functions: `!path` (cwd), `!tree` (filtered directory tree via fdfind).

Indentation preserved: when `{{ content }}` appears indented, all included lines inherit the same indent prefix.

### 3.4 .bash_env

Sourced on every shell invocation (via `BASH_ENV`). Guard flag prevents double-init:

```bash
eval "$(mise activate bash)"
export PATH=~/.local/bin:~/.cargo/bin:$PATH
export PYTHONPATH=~/.claudebox/lib/src:${PYTHONPATH:-}
```

### 3.5 Profile Structure

Mounted at `/root/.claudebox/profile/`. Profiles are user-owned and may contain any combination of:

- **Prompt files** — system prompt entry point and modular composition fragments, compiled by `claudebox-prompt` (§3.3)
- **Hooks** — shell lifecycle hooks (`container-start.sh`, `image-build.sh`, `agent-stop.sh`) and Python Claude Code SDK hooks processed by `@hook`/`@statusline` decorators (§1.2)
- **Config** — tool and environment settings symlinked into the container on start
- **Extensions** — agents, commands, skills, and other Claude Code customizations

### 3.6 Hook Scripts

**Shell lifecycle hooks** invoked by entrypoint/agent scripts:

| Hook | When | Called By | Purpose |
|------|------|-----------|---------|
| `container-start.sh` | Container init | entrypoint.sh | Symlink git/claude configs |
| `container-end.sh` | Container exit | entrypoint.sh trap | Cleanup |
| `agent-start.sh` | Agent start | claudebox-agent | Pre-session init |
| `agent-stop.sh` | Agent exit | claudebox-agent trap | Post-session cleanup |

Shell hooks are sourced (container-*) or executed as subprocesses (agent-*). Profiles implement whichever hooks they need — the entrypoint checks for file existence before invoking.

**Claude Code SDK hooks** are configured in the profile's config and processed by the `@hook` decorator (§1.2). Profiles can implement any combination of Claude Code hook types (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SessionEnd, AgentStop, Stop) and the statusline command.

### 3.7 Nested Containers

The image bakes a podman-in-podman toolchain (`install_containers.sh` - podman, buildah, podman-compose, the docker-CLI compat wrapper, an identity subuid/subgid config) unconditionally, keeping the image single/global; `[containers] nested` (§2.1, §2.3) gates the capability at the runtime device layer. The toolchain runs as real root inside the session container, mapped through an identity subuid/subgid range (`daemon:1:65535`, `root:1:65535`) so inner containers get the container's full host id range. Writing a non-trivial id map needs `CAP_SYS_ADMIN` in the namespace being mapped, unless the namespace's owner and the writer share the same effective uid - podman satisfies that by creating and writing its own namespace as root, so no capability grant is required. Inner containers run inside the outer container's own namespaces (no `--privileged`) - invisible outside the session and removed with it, storage tmpfs-mounted and never persisted.

The toolchain shares the session container's network namespace (`netns = "host"`) rather than getting its own: inner containers cannot publish ports (`-p` is accepted but has no effect), cannot bind ports below 1024, and cannot create user-defined networks (needs `CAP_NET_ADMIN`) - `podman-compose` services must set `network_mode: host` and reach each other via `localhost`. Isolation from the true host holds only because the session container itself gets its own private network namespace by default (`config.network_mode` unset); a workspace that sets `[network] mode = "host"` puts inner containers on the host network too.

---

## 4. Container API (`claudebox_container_api`)

HTTP plumbing only: the FastAPI app, the handlers that route REST calls into the `Session` facade (§1.5), the file service, the lifespan glue around the active session singleton, and the structlog wiring with the SSE log broadcaster. All session orchestration lives in `claudebox/agent_session/orchestration/` (§1.5); this layer consumes the `Session` interface and the Protocol, never the SDK directly.

### 4.1 Module Map

```
app.py                  # FastAPI factory, lifespan, ApiError exception handler
logging.py              # structlog configuration: configure_logging(), get_logger(), LogBroadcaster, attach/detach session file log
constants.py            # FILE_INDEX_CACHE_TTL, LOG_REPLAY_BUFFER_SIZE, CONTAINER_API_LOG_FILENAME (HTTP-layer only — session vocabulary moved to claudebox/constants.py)
session_lifespan.py     # `current` Session singleton + managed() async context manager + get_session() dependency

files/
├── path_resolver.py    # PathResolver — resolve file references for click-to-open
├── file_service.py     # FileService — wraps PathResolver and exposes resolve_paths() to handlers
└── errors.py           # FileServiceNotReady and other file-related error types

handlers/
├── chat.py             # Send, stream (SSE), interrupt, model/permission-mode/effort-level switching
├── sessions.py         # Session CRUD: list, current, new, resume, attachments, tool output (current-prefixed)
├── files.py            # /api/files/resolve-paths — bulk path resolution for the frontend's click-to-open
├── info.py             # Workspace metadata
├── lifecycle.py        # Health check, graceful shutdown
├── logs.py             # SSE log streaming
├── mcp.py              # /api/mcp/{reconnect,toggle,status} — manage MCP servers used by the SDK
├── _shared.py          # FastAPI dependency injection (SessionDep, FilesDep annotated types)
└── _models.py          # Pydantic request/response models
```

PathResolver's file index persists to `{workspace}/.claudebox/path-index.json` (temp-file-plus-rename, no locking) so a container restart starts warm. A loaded index counts as freshly built for the in-memory TTL regardless of save age - the 24h load bound only gates whether the file is worth reading. Every resolution validates the entry still exists, so a stale index can't point at a moved or deleted file; concurrent persists are last-write-wins, no lock.

### 4.2 Session Lifespan

```python
# session.py
current: Session | None = None


def get_session() -> Session:
    """Return the active session, raising SessionNotReady if uninitialized."""


def managed(**kwargs):
    """Async context manager for FastAPI lifespan.

    Creates a Session instance but does NOT auto-start a session.
    The daemon explicitly triggers session creation via
    POST /api/sessions/new or POST /api/sessions/{id}/resume
    after the container is healthy.
    """
    # Startup: current = Session(...)
    # Shutdown: await current.stop(); current = None
```

`Session` is imported from `claudebox.agent_session.orchestration.session`. All handlers access `session_lifespan.current` via the `get_session()` dependency injected through `SessionDep` in `handlers/_shared.py`.

### 4.3 API Endpoints

All session-state endpoints address the *currently active* session via the `/current` path segment; only `/resume` carries an explicit session ID (because that ID is the resume target, not the current session).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/send` | POST | Queue prompt for SDK processing |
| `/api/stream` | GET (SSE) | Event stream with replay |
| `/api/interrupt` | POST | Stop current SDK processing |
| `/api/model` | POST | Switch active model |
| `/api/permission-mode` | POST | Switch permission mode |
| `/api/effort-level` | POST | Switch effort level |
| `/api/sessions` | GET | List all sessions on disk |
| `/api/sessions/new` | POST | Create new session (returns pre-generated `session_id`) |
| `/api/sessions/current` | GET | Active session summary |
| `/api/sessions/current` | PATCH | Update current session metadata |
| `/api/sessions/current/prompt` | PATCH | Update current session prompt text |
| `/api/sessions/{id}/resume` | POST | Resume a previous session as current |
| `/api/sessions/current/attachments/{filename}` | GET | Serve attachment from current session |
| `/api/sessions/current/tool-output/{tool_use_id}` | GET | Fetch tool output content |
| `/api/sessions/current/tool-output/{tool_use_id}/download` | GET | Download tool output file |
| `/api/files/resolve-paths` | POST | Bulk-resolve file paths for click-to-open |
| `/api/mcp/status` | GET | MCP server status snapshot |
| `/api/mcp/reconnect` | POST | Reconnect a configured MCP server |
| `/api/mcp/toggle` | POST | Enable/disable a configured MCP server |
| `/api/info` | GET | Workspace metadata |
| `/api/health` | GET | Health check |
| `/api/shutdown` | POST | Graceful shutdown |
| `/api/logs` | GET (SSE) | Container API log streaming |

---

## 5. Frontend (`claudebox_frontend`)

React 19 SPA communicating with the container API and daemon via HTTP + SSE.

### 5.1 File Structure

```
src/
├── api/              # HTTP clients — daemon and container-API REST + SSE wrappers
├── config/           # App configuration and constants (layout, panel, timing, dimensions, thresholds, urls, storage, schema, toolRegistry, colors)
├── context/          # React Context providers (split contexts — see §5.3)
├── features/         # Feature modules (self-contained)
│   ├── app/          # App shell, AppProviders, cross-cutting effects
│   ├── chat/         # ChatPanel, ChatController, terminal column (components/terminal/)
│   ├── boards/       # BoardsPanel, BoardTab
│   ├── bookmarks/    # BookmarksPanel
│   ├── commands/     # CommandsPanel
│   ├── footer/       # Footer bar
│   ├── help/         # HelpPanel
│   ├── icon-strip/   # Panel toggle icon strips (left + right)
│   ├── logs/         # LogsPanel
│   ├── mcp/          # McpPanel
│   ├── sessions/     # SessionsPanel
│   ├── stash/        # StashPanel
│   ├── tasks/        # TasksPanel
│   ├── todos/        # TodosPanel
│   └── usage/        # UsagePanel
├── components/       # Cross-feature React components (CopyButton, ConfirmSwitchModal, Dropdown, Markdown, MermaidDiagram, PanelControlBar, PanelListItem, PathHighlighter)
├── hooks/            # Cross-feature hooks (useBookmarks, useBottomAutoscroll, useDaemonStream, useDropdown, useIsMobile, useLocalStorage, useNewSession, usePathResolution, usePointerDragHandle, useSSE)
├── managers/         # Coordination logic classes — see §5.5
├── utils/            # Cross-feature pure functions (event processing, predicates, formatters, parsers, language detection, diff, xml block folding, scroll, color, comparators, collections, attachment helpers, layout persistence, mermaid loader, path candidates, bookmark IDs, categorization, navigation, flash status)
├── main.jsx          # React entry point
└── main.css          # Cascade orchestrator (imports all feature index.css in order)
```

### 5.2 SSE Connection

`SSEConnectionManager` manages the `EventSource` to the container SSE endpoint (routed via daemon as `/api/workspaces/{wsId}/containers/{cId}/api/stream`):

1. Connect → dispatch `connecting`
2. `onopen` → dispatch `connected`
3. `onmessage` → parse JSON, handle replay boundaries, buffer into the streaming batch or the replay queue
4. `onerror` → close, auto-reconnect with exponential backoff (1s–10s)
5. `close()` → permanent shutdown (`_closed` flag prevents reconnect)

**Daemon Reconnect Recovery**: `DaemonReconnectEffect` monitors the daemon SSE connection and triggers automatic session recovery when the daemon restarts — tracked as a non-initial `connected` transition, so the first connect never fires it. If the container SSE is still alive, recovery is skipped; otherwise it calls the resume endpoint for a fresh container ID and reconnects the container SSE. Failure shows the user a "Session reconnect failed" error.

### 5.3 State Management

Split contexts ordered by update frequency:

| Context | Frequency | Key State |
|---------|-----------|-----------|
| AppActionsContext | NEVER (stable) | Stable refs (scroll position, autoscroll, jump targets) + action callbacks (`focusChatTab`, `maximizeToggle`, `closePanel`) |
| WorkspaceContext | LOW (mount + selection) | workspaceId, workspaces, selectWorkspace — daemon workspace discovery and selection |
| DaemonStreamContext | LOW (SSE events) | progressMessage, sessionsChanged, containerStatus, lastContainerEvent — single daemon SSE connection shared by all consumers |
| SessionsContext | LOW (SSE-driven) | sessions list, pinned sessions — refetches on sessions_changed and container_status events |
| SessionRoutingContext | MEDIUM (hash changes) | `activeWorkspaceId`, `activeSessionId`, `activeBoardId`, `density`, `navigateToSession`, `navigateToBoard`, `navigateToWorkspace`, `navigateHome`, `setDensity` — pure hash-based routing; density preference (`?density=terse` query) threaded through board navigation and persisted via `replaceState` to avoid history pollution |
| EventsContext | HIGH (SSE stream) | event log, turn grouping, visible-events filter, responding state, connection status, replay flag, turn-derived state (results, task notifications, todo diffs, subagent labels, todos-by-subagent), transient lifecycle flags consumed by the footer status indicator (`isCreating`/`isResuming`/`isForking`/`isOpeningBoard`/`isOpeningWorkspace`) |
| LogsStreamContext | LOW (SSE events) | Aggregated log stream from the container API for the LogsPanel |
| InteractionContext | MEDIUM (user actions) | isSubmitting, isAwaitingResponse, interruptStatus, errorMessage |
| SessionDataContext | LOW (polling) | sessionData, availableModels, availablePermissionModes, availableEffortLevels, notificationsEnabled. Bootstrap data is seeded from the `/sessions/new` create-response (full `SessionInfo` shape) so the footer renders populated from frame 1. `refreshSession`'s subsequent partial `getSession()` responses merge defensively — when prev and data carry the same `session_id`, non-null prev fields are retained against null data fields, preventing footer fields from regressing as the projection settles. |
| SessionActionsContext | NEVER (stable) | Stable action callbacks co-defined alongside `SessionDataContext` in `SessionDataContext.jsx` |
| BookmarksContext | LOW (user actions) | Per-workspace bookmark list, server-persisted |
| StashContext | LOW (user actions) | stash items, server-persisted |
| ContainerMapContext | LOW (daemon events) | containerMap, stoppingSessions — maps session IDs to container IDs; tracks sessions in stopping state. Exposes `deriveSessionStatus(sessionId, sessions, fallbackContainerId)` — the single status source (stopping > running > none) all dot surfaces (sessions panel, header strip, bookmarks) route through so they cannot diverge |

### 5.4 Event Batching

Two dispatch paths keep the textarea responsive during agent streaming. Per-event flags (`isResponding`, `respondingSince`, `lastEventTimestamp`, compaction state) update synchronously so status indicators track the SDK stream; heavy derived state (events, turns, todoDiffs, …) batches at 50 ms intervals so the active Turn re-renders no more than ~20×/sec.

```
Streaming path:
  SSE event → STREAMING_FLAGS (flags only, synchronous)
           → eventBufferRef.push(event)
           → schedule 50ms timer (idempotent)
  Timer fires → drain eventBufferRef
            → startTransition(() => FLUSH_BATCH { batchEvents })
              → append to events, visibleEvents
              → incremental turns, turn results, task notifications, todo diffs

Replay path:
  SSE event → replayBufferRef.push(event)   (one ordered queue, no dispatch)
           → schedule drain (idempotent)
  Drain tick → replaySliceEnd() picks a cut ≤ REPLAY_DRAIN_SLICE_SIZE
            → REPLAY_SLICE { batchEvents }
              → fold applyEventFlags over the slice, then flushBatch
            → reschedule while the queue is non-empty or the server has not finished
  Queue empty + replay_ended seen → REPLAY_ENDED (flags only, carries no events)
```

**Chunked replay drain**: replay materializes in bounded slices rather than in a single commit at
`replay_ended`. The commit phase is atomic, so one commit carrying an entire transcript cannot be
interrupted — on a heavy session it never finishes and the tab locks until the browser discards the page.
Draining in slices trades one unusable commit for many tolerable ones, giving the browser a paint and
input window between each. `REPLAY_DRAIN_SLICE_SIZE` (50) is tuned on the longest single main-thread
block, not on total load time; total time is bounded by the windowed turn list instead.

Three invariants hold the drain together:

1. **One ordered queue.** `isReplaying` stays true until the queue drains, not until the server signals
   `replay_ended`. Everything arriving in between — including live events from a session that is already
   responding again — joins the queue's tail. Routing them to the streaming path instead would let a newer
   event commit ahead of older history still queued behind it.
2. **Compaction runs are never split.** `appendTurns` buffers `compact_start` / `compact_boundary` /
   post-compaction context until a later event establishes the turn they belong to, and force-flushes that
   buffer at end of batch. A cut placed inside an open run would therefore attach the compaction block to
   the preceding turn. `replaySliceEnd` (`context/utils/replaySlice.js`) walks the candidate slice and
   extends or withholds the cut so every run resolves inside one slice.
3. **The drain is cancellable.** `CLEAR_EVENTS`, reconnect, and close all clear the queue and its timer, so
   a pending slice cannot commit the previous session's events into a freshly cleared chat.

Replay progress reports events *materialized*, not events received, so the indicator tracks what is
actually on screen.

`SyntaxHighlightedCodeBlock` is `React.memo`ed on `(code, language, startingLineNumber, className)` — already-finalized code blocks bail out of re-render on each flush, so re-highlight cost is bounded to the actively-growing block. Provider value identity changes at flush rate (~20×/sec), not at SDK event rate, leaving the main thread enough headroom for input handlers between flushes.

**Active/historical turn split**: `ChatPanel` renders the last (active) turn directly — it carries the live streaming events and re-renders per flush — while every earlier turn renders through `HistoricalTurnList`, a `React.memo`ed component whose props stay referentially stable between lifecycle transitions (completed turn objects keep their identity across flushes; `appendTurns` only clones the active turn). During a streaming turn the memo bails, so the historical subtree — the bulk of a long session — is not reconciled per flush; only the single active turn pays the streaming cost, regardless of how many completed turns precede it. The active→historical hand-off is the slice boundary moving as `turns` grows; turn keys (`turn_id`) are preserved, so the completing turn does not remount. This is the per-event axis; it composes with the per-turn-count windowing below.

**Central turn-collapse**: collapse is a single source of truth owned above the turn list, not per-`Turn` local state. `ChatPanel` holds `collapsedTurnIds` (a `Set<turn_id>`) and exposes it through `TurnCollapseContext`; `Turn` derives `collapsed = collapsedTurnIds.has(turn_id)` from context (falling back to local state only when rendered without a provider), so a collapse change reaches turns without adding props to the memoized `HistoricalTurnList` — the context propagates through the memo while the streaming-flush bail above is untouched. Auto-collapse is a **one-shot recompute**, not a continuous invariant: an effect keyed on `(autoCollapseEnabled, lastTurnId)` collapses every turn except the last on enable and on each new turn, and expands all on the enable→disable edge only (tracked via a prev-enabled ref). The recompute subtracts a `manuallyExpandedIdsRef` provenance set (turn ids the user expanded by hand) so a hand-expanded turn stays open across new turns until the user collapses it by hand (which drops it from the set, returning it to auto control). The enable edge (off→on) clears the set for a fresh "collapse all but last"; the set is in-memory per active chat and also cleared on session change. Consequence: the previously-last turn still collapses on a new turn (being last is not a manual expand). The recompute reads `turns` through a ref so it does not key on the per-flush `turns` identity. The enable flag lives in an app-level ref (`autoCollapseEnabledRef` in `AppActionsContext`), mirroring autoscroll's `chatAutoScrollEnabledRef` — it persists across `ChatPanel` remounts (tab/board switch) and resets to on when the session changes.

Container listing is workspace-scoped end-to-end: the daemon exposes `GET /api/workspaces/{workspace_id}/containers` — CLI consumers (`status`, `containers`, `logs`) aggregate via N per-workspace concurrent `httpx.AsyncClient` requests, and the frontend's `useContainerList` calls `listContainers()` (workspace-prefixed) so the Containers panel automatically refreshes when the workspace switcher fires. `ResumeControl` lives at top-level `components/` as a cross-feature shared Play+chevron split-button consumed by `ContainerRow`.

`flushBatch` runs two derived-state pipelines per batch: `appendTodoDiffs` (TodoWrite) and `appendTaskDiffs` (TaskCreate / TaskUpdate). The two tool families are mutually exclusive at the SDK init level, so at most one produces non-empty output per session, but both run unconditionally and feed the same `todoDiffs` + `todosBySubagent` stores. `appendTaskDiffs` binds the numeric `taskId` returned by `TaskCreate`'s tool_use_result back to a subagent + list-position so subsequent `TaskUpdate` events can mutate the running list; the per-call diff classifies transitions into `added` (TaskCreate), `started` / `completed` (TaskUpdate's `status` field), or `added` (pure `addBlockedBy` update). On `_applyTaskResult`, the `_taskId` is back-patched directly onto the bound item (a single mutation propagates through both `todosBySubagent[subagentKey][index]` and the `todoDiffs.get(creatingToolUseId).added[0]` reference — both pointers share one item object) so the in-chat grouped renderer can dedup by identity (one row per `_taskId` within a run).

The in-chat grouped renderer (`TodosGroup`) derives the "blocked" flag at render time by resolving each item's `blockedBy` taskIds against the same merged-run set (frozen-snapshot semantics: cross-run blocker references are treated as resolved, keeping the group self-contained). The panel (`TodosPanel`) does the same resolution against the live cumulative `todosBySubagent` partition. No new store mutation — both consumers operate on the read side of the existing state.

**Empty-state suppression**: `TodosGroup` returns `null` when `bucketize(...).rowGroups.length === 0`. `groupBlocks.flushRun` can emit a `'todos-group'` segment that yields no rows via three paths: a streaming race where a TaskCreate / TaskUpdate `tool_use` lands before its `tool_result` populates `todoDiffs`, so `mergeRunItems` returns `[]`; an empty-items mutation (TaskCreate with no items, TaskUpdate removing the last one); or any future zero-row `bucketize` edge. The render-layer guard hides the chrome until rows exist, and reconciliation brings it back once `todoDiffs` populates. The guard belongs there because the partitioner cannot see `todoDiffs` at all - it lives in `TurnContext`, consumed only by the React tree.

The run-detector (`groupBlocks` in `TurnBlockList`) only emits a grouped-Todos segment when the run contains at least one `TaskCreate` or `TaskUpdate`; runs composed entirely of `TaskList` / `TaskGet` (inspection-only) are demoted to individual `single` segments so the per-block ToolBlock dispatch renders each inspection's payload. The grouped renderer wraps its rows in the shared ToolBlock chrome (`ToolBlockHeader` + `.tool-expanded-content`), so its expand / collapse affordance matches every other tool block; the row body is a CSS grid with three columns (state icon · title · description) and each row uses `display: contents` so its cells participate directly in the parent grid — columns align across rows.

### 5.5 Key Patterns

**Uncontrolled textarea**: `ChatInput` uses `ref.current.value` instead of controlled state — avoids re-render on every keystroke.

**Editing operations announce through the DOM event, not a callback.** Tab/Shift+Tab, Shift+Enter, tag-wrap, block collapse/expand, and bracket auto-pair all end by dispatching a real `input` event on the textarea instead of calling draft/resize/autocomplete callbacks directly — the same single `onInput` chain a keystroke drives handles all three uniformly. `expandBeforeSubmit` and `handleStash` are the two exceptions: the former runs immediately before send-clear, and the latter still calls `saveDrafts` directly because the dispatch path never clears the draft stack, only `current`.

**Shared text-editing transforms, caller-specific application.** `chat-input/utils/textTransforms.js` holds every editing operation above (plus wrap-in-tags) as pure `(value, selStart, selEnd, ...) -> {value, selStart, selEnd} | null` functions; `chat-input/hooks/useTextEditingKeys.js` maps keys to them and hands the result to a caller-supplied `applyResult`. The composer (uncontrolled) applies a result by writing `textarea.value` directly; the inline reply box (controlled) calls `onEdit` then restores the caret via a pending-selection ref, since keying that off the response text would stomp the caret on unrelated parent re-renders. `BlockCollapseManager`'s placeholder-id counter is module-level so two boxes' ids never collide, while each instance's collapsed-block map stays private. Only Tab/Shift+Tab, Shift+Enter, tag-wrap, collapse/expand, auto-pair, and interrupt are shared - history, stash, and slash-autocomplete stay composer-only (no well-defined target across two inputs).

**Ref-based scroll state**: `chatScrollPositionRef` and `chatAutoScrollEnabledRef` persist scroll position across tab switches without triggering re-renders.

**Manager classes**: plain JS classes in `managers/` (SSE, side panels, session/board tabs, message queue, path resolution) and `features/chat/ChatController` encapsulate business logic outside React's render cycle, connected via custom hooks. They hold mutable state, expose imperative methods, and avoid re-renders on internal updates.

**ChatController scroll model**: user-intent detection is input-source driven — passive `wheel` / `touchstart` / `touchmove` / `keydown` listeners attached to `.chat-messages` (which carries `tabIndex={-1}` to receive keyboard events) call `markUserIntent()`, which latches `userIntentActive=true` and disables auto-scroll. Auto-scroll re-engages only when the user manually scrolls back within `AUTOSCROLL_THRESHOLD` of the bottom — handled in the React `onScroll` callback (`handleUserScroll`), which also persists the latest scroll position. Auto-scroll DOM writes are coalesced through a single `requestAnimationFrame` (`_requestScroll`) so a burst of `onEventsChange` / `onPendingMessagesChange` / `onQueueChange` / `ResizeObserver` callbacks in the same tick produce exactly one `scrollTop` write. Programmatic scrolls (initiated by `useMessageJump`'s `scrollToEdge`, by `scrollToBottom`, or by the resize observer) bracket their writes with `markProgrammaticScroll()` so the `onScroll` handler treats them as not-user-intent.

**Engagement-state contract — two public methods**: the autoscroll engagement flip lives on `ChatController` as a symmetric pair of state-machine methods. `markUserIntent()` (off-bottom transition): latches `userIntentActive`, disables auto-scroll, fires `onAutoScrollChange(false)`. `markReturnedToBottom()` (at-bottom transition): clears `userIntentActive`, enables auto-scroll, fires `onAutoScrollChange(true)`. Callers outside the controller invoke them explicitly rather than relying on the native scroll event — input listeners call `markUserIntent` directly; `handleUserScroll`'s manual-return-to-bottom re-engage path delegates to `markReturnedToBottom`; `useMessageJump`'s jump callbacks pick the transition based on landing geometry (`jumpPrev` / `jumpTop` → off-bottom; `jumpBottom` and `jumpNext`'s scroll-to-bottom fall-through → at-bottom; `jumpNext`'s mid-list target → off-bottom). Decoupling lets every navigation path that moves the view reflect engagement state correctly without round-tripping through the scroll event (where the programmatic-scroll guard would otherwise short-circuit the classification).

**Re-engagement invariant**: At-bottom, only inputs that can actually move the view away from bottom count as intent. The wheel listener filters downward wheel (`deltaY > 0`) at-bottom; the keydown listener filters scroll-down keys (PageDown / End / ArrowDown / unshifted Space) at-bottom. Upward wheel and scroll-up keys at-bottom remain intent (the view will move). Touch keeps unconditional intent semantics — direction is unknowable at `touchstart`. Without per-listener gating, every wheel tick within the at-bottom zone races `markUserIntent` (disable) against `handleUserScroll` re-engagement (re-enable), producing a per-tick indicator flicker. The gates keep re-engagement monotonic when the user scrolls back toward bottom: exactly one `false → true` transition when the view enters the at-bottom zone, and no further transitions during the rest of the sweep.

**Fire-and-forget persistence**: Layout changes, stash updates, UI state use `fetch().catch(() => {})` — best-effort, never blocks UI.

**Windowed turn list**: `HistoricalTurnList` renders only the turns intersecting the viewport plus `TURN_OVERSCAN` either side, via `@tanstack/react-virtual` (`useTurnVirtualizer`). Rows are absolutely positioned inside a spacer sized to the whole transcript, so scroll position, scrollbar, and every scroll offset behave as if all turns were present. Cost of opening a session stops scaling with its length: the mounted set stays bounded (~16 turns) whether the session holds 20 turns or 520. This replaces the previous `content-visibility: auto` approach, which skipped layout and paint for off-screen turns but still built their DOM, created their React elements, and ran their per-block render work - the reason it was measured insufficient.

The virtualizer is owned inside `HistoricalTurnList`, below the memo boundary, not in `ChatPanel`. It re-renders its owner on every scroll frame; owning it above the boundary would pull `ChatPanel` and the live streaming turn into each of those frames, undoing the active/historical split. `ChatPanel` reaches it through `turnVirtualizerRef` for jump-to-turn.

Two consequences the UI has to absorb. A turn outside the window has no element, so anything that used to find a turn with `querySelector` now goes through `withMountedTurn` / `scrollToIndex` first - Alt+Up/Down jumps, the post-replay landing turn, bookmark clicks (routed cross-panel through `scrollToTurnRef`), and inline-reply anchors, which resolve only for mounted turns and re-resolve as the window moves. And the browser's own find-on-page and Print/Save-as-PDF reach only what is currently on screen; that trade is recorded in SPEC as `claim:chat:offscreen-turns-absent`.

Measurement is rounded to whole pixels, and a measurement of zero is refused in favour of the estimate. Both guard the same feedback path: a reported height re-renders the list, which re-measures, which reports again. A row settling between two subpixels reports a fresh value forever; a row that has not painted yet reports 0, which shrinks the total, widens the range, mounts more rows, and repeats until the whole transcript is mounted - the failure windowing exists to prevent.

Whether the list is windowed at all is decided by what the virtualizer produced, not by a second reading of the container. The two disagree readily - the virtualizer sizes itself from `offsetHeight`, while an element also reports `clientHeight` and a bounding rect - and the disagreement surfaces as a chat with a full scroll extent and nothing in it. An empty window where turns exist means no window could be computed, so the list renders all of them. Before the container attaches there is nothing to read at all, so the virtualizer is given the window height as its `initialRect`: without it the first commit after any remount renders the entire transcript before the ref lands.

**Known limitation.** A session of roughly 200+ turns can still trip React's maximum-update-depth guard and leave the chat blank, intermittently. This predates windowing: the same session reproduces it on builds from before both the chunked replay drain and this list, where it rendered nothing at all rather than a bounded window. Windowing bounds the cost and gets the session on screen in seconds, but does not remove the underlying cycle. Note that no shipped test fixture is long enough to reach the failing condition - the largest is 16 turns - so a green suite says nothing about it.

**Minimap sizing**: every turn's segment is priced by `predictTurnHeight` - a content-derived estimate scaled to chat column width (text wrap, tool/thinking blocks, attachment rows, collapsed strips), the same estimator the virtualizer uses for unmounted rows. Coefficients live in `config/dimensions.js`; `e2e/app/tests/predictor-calibration.spec.js` holds per-fixture drift under 30% across three viewport widths, each swept with the terminal split both on and off, by scrolling each fixture turn into view and measuring it while mounted.

`predictTurnHeight`'s 4th parameter, `splitEnabled`, routes through the `isTopLevelBashCall` predicate `groupBlocks` uses (§5.10), so a top-level Bash call is priced at zero while the split is on and a subagent's nested one keeps the ordinary tool-row price either way - predicted and rendered heights agree in both states. `useTurnVirtualizer` calls `virtualizer.measure()` on the flag's edge rather than every render, so mounted turns re-price immediately instead of holding a pre-flip cached height until they happen to remount.

Heights are deliberately NOT sourced from real measurements. With the list windowed only a handful of turns have a height at any moment, and feeding those back into state re-renders the list, which mounts and measures more turns, which publishes again - a cycle that does not settle. Predictions are complete and independent of what happens to be on screen, so minimap proportions no longer depend on where the user has scrolled. Heights are keyed by `turn_id`, so a turn keeps its size when the list shifts underneath it (a compaction dropping an earlier turn, a rewind). The human-message marker drawn inside each segment is predicted the same way, for the same reason: measuring it needs the turn mounted, and sizing only the mounted few would flatten every other marker to its minimum.

### 5.6 Layout

Dockview React manages the side-docked panel system. The bottom-panel strip
is a sibling element, not a dockview participant — it occupies a fixed-position
bar above the footer when at least one bottom-slot panel is open and shrinks
`.app-container` via the `--logs-strip-h` CSS variable.

```
┌────────────┬────────────────────┬──────────┐
│ IconStrip  │   ChatPanel        │ IconStrip│
│  (left)    │   ┌──────────────┐ │  (right) │
│            │   │ Messages     │ │  Todos   │
│ Sessions   │   │ Turn → Block │ │  Stash   │
│            │   │              │ │  Tasks   │
│            │   ├──────────────┤ │  Usage   │
│            │   │ ChatInput    │ │  MCP     │
│            │   └──────────────┘ │ Skills   │
│            │                    │  Help    │
│  bottom:   │                    │          │
│ Containers │                    │  bottom: │
│            │                    │  Logs    │
├────────────┴────────────────────┴──────────┤
│ BottomPanelContainer (1 slot full-width    │
│   OR 2 slots split 50/50 horizontally)     │
├────────────────────────────────────────────┤
│ Footer (status, connection)                │
└────────────────────────────────────────────┘
```

**Panel registry**: `config/layout.js` is the central panel configuration — maps panel IDs → components, defines side assignments (left/right/bottom), and canonical ordering per side. Bottom-slot panels are intentionally absent from `PANEL_SIDES` for dockview routing — they route through `BottomPanelsContext`, not `SidePanelManager`. The bottom-side membership is published dynamically by `<IconStrip>`: each strip with `bottomPanels=[...]` calls `setBottomPanelIds(position, ids)` to declare everything its side owns, and clears its side on unmount, so `useBottomPanels().panelSideMap` always reflects the current membership.

That call is declarative rather than a per-id register/unregister pair for a specific reason. `panelSideMap` feeds the context value, so any write re-renders every consumer — including `DesktopLayoutBody`, which renders the strips. An effect that removed each id and immediately re-added it produced two new `Map` identities for unchanged content, re-rendered the layout body, rebuilt the `bottomPanels` array literal it passes, and re-ran the effect: a closed loop that React eventually aborted, blanking the page. Stating the whole set at once makes a repeat with unchanged ids return the previous map and cost nothing, the strips' effects are keyed on id content rather than array identity, and the arrays themselves are module constants.

**Bottom-panel container state**: `BottomPanelsContext` owns `{openSet: Set<panelId>, height: number, panelSideMap: Map<panelId, 'left'|'right'>}`, hydrated from `session.bottomPanels = {openSet: string[], height: number}` on session attach and persisted via debounced PATCH on user-initiated toggle/resize. `BottomPanelContainer` renders a fixed-position bar (`position: fixed; bottom: 24px`) above the footer; one open panel fills it full-width, two split 50/50 horizontally (left slot first, right slot second). One shared drag handle resizes the whole strip via `--logs-strip-h`. While dockview maximizes a group, the whole strip collapses to 0 regardless of `openSet` (global maximize semantics — no per-slot maximize).

**Routing**: `DesktopLayoutBody.handleTogglePanel` consults `useBottomPanels().isBottomPanelId(id)` — bottom-slot IDs route through `togglePanel(id)`, everything else stays on dockview's `onTogglePanel`. The dockview `augmentedActivePanels` adds the open bottom-slot IDs so their icons highlight as active alongside dockview panels.

Panel state (widths, heights, visibility, ordering) persisted to `/api/ui-state` with 500ms debounce.

**Chat content area split**: `.chat-content-area` holds the transcript (`.chat-transcript-column`)
and, when the split is on, the terminal column
(`features/chat/components/terminal/TerminalColumn.jsx`), separated by a repo-authored
`ChatSplitDivider.jsx` rather than a dockview sash - the terminal column is not a dockview panel and
has no side/bottom slot membership. `useTerminalSplit` hydrates `{enabled, ratio}` from
`session.terminalSplitEnabled` / `session.terminalSplitRatio` (defaults: off, 0.5) on session attach,
mirroring `minimapPinned`'s flat camelCase key shape; `enabled` patches on toggle, `ratio` debounced
(`LAYOUT_SAVE_DEBOUNCE_MS`) on drag. `useTerminalSplitLayout` derives `showTerminalSplit` from that
plus a measured `.chat-content-area` width: mobile always suppresses it, and any width under
`CHAT_TRANSCRIPT_MIN_WIDTH + CHAT_TERMINAL_MIN_WIDTH + CHAT_SPLIT_DIVIDER_WIDTH` collapses to the
transcript alone without touching the persisted `enabled` flag. `ChatSplitDivider` shares
`usePointerDragHandle` (pointer capture, axis-parameterized) with `BottomPanelContainer`'s handle - see
§5.10 for what routes into the column.

`TerminalColumn` is windowed the same way `HistoricalTurnList` windows turns (`useTerminalVirtualizer`,
`@tanstack/react-virtual`): only entries near the viewport plus `TERMINAL_OVERSCAN` mount, priced by
`predictTerminalEntryHeight` until measured. The column never wraps output - each line, however wide,
stays one line and scrolls sideways within its own block - so the predictor is a pure line count,
independent of column width, so a divider drag that resizes the column needs no re-measure pass.
The trailing entry stays outside the window and renders directly, mirroring `ChatPanel`'s active turn,
since it is the one whose height still changes as "Running..." becomes real output. Autoscroll (follow
new entries at the bottom, hold position when scrolled up) comes from the virtualizer's own
`anchorTo`/`followOnAppend` options rather than a scroll listener; `LogsPanel` is `useBottomAutoscroll`'s
only remaining consumer, unwindowed.

### 5.7 Build System

| Tool | Purpose |
|------|---------|
| Vite | Bundler — builds to `dist/`, proxies `/api` in dev |
| Vitest | Unit tests (jsdom environment) |

JS lint (Biome, jscpd, Knip) and frontend E2E (Playwright) live outside the frontend tree — see §0.

### 5.8 Code Block Rendering

Three-tier component architecture for tool output display:

```
ToolContentRenderer(toolName, details, filePath, outputMode)
│
├─ !details → null
│
├─ (Read|Write) + filePath + markdown extension?
│   └─ YES → MarkdownPreview(content)
│            └─ Rendered markdown (default) ↔ source view toggle
│
├─ (Read|Write) + filePath + known language?
│   └─ YES → SyntaxHighlightedCodeBlock(code, language)
│            └─ Custom renderer outputs table-row structure
│               └─ .code-block > .code-block-row* > [.code-block-gutter + .code-block-content]
│                  (syntax tokens as inline styled spans)
│
├─ Grep|Read|Write|Edit?
│   └─ YES → ToolCodeBlock(toolName, details, outputMode)
│            │
│            ├─ Read|Write → parseReadWriteLines() → lines with type:'normal', lineNum
│            ├─ Grep → parseGrepLines() → lines with type:'match'|'context'|'separator', file?, lineNum?
│            ├─ Edit → parseEditLines() → lines with type:'diff-add'|'diff-remove'|'diff-context'|'separator'
│            └─ unknown → split('\n') → lines with type:'normal'
│            │
│            └─ CodeBlock(lines)
│               └─ Infers gutter columns from data:
│                  • hasFile? → show file column
│                  • hasLineNum? → show lineNum column
│                  • neither? → no gutter
│               └─ .code-block > .code-block-row* > [.code-block-gutter? + .code-block-content]
│
├─ WebSearch|WebFetch?
│   └─ YES → Markdown component (rendered as rich text, not code)
│
└─ Unknown tool
    ├─ looksLikeMarkdown(content)? → MarkdownPreview(content)
    └─ else → CodeBlock(content)
       └─ Simple pre-formatted text
```

**Component responsibilities**:

| Component | Location | Role |
|-----------|----------|------|
| `ToolContentRenderer` | `features/chat/.../tool-content-renderer/` | Entry point — routes to appropriate renderer |
| `Markdown` | `components/` | Canonical markdown renderer — GFM, math, mermaid, syntax-highlighted code, path highlighting, and sanitized raw HTML (`rehype-raw` -> `rehype-sanitize` -> `rehype-katex`; the sanitize allowlist in `markdownSanitizeSchema.js` is the XSS boundary since no CSP is served — scripts/handlers/`javascript:` URLs and `iframe`/`object`/`embed`/`svg` are stripped); degrades gracefully outside `SessionDataContext` |
| `MarkdownPreview` | `features/chat/components/` | Wraps `Markdown` with toggle to raw source; mirrors MermaidDiagram pattern |
| `SyntaxHighlightedCodeBlock` | `features/chat/.../tool-content-renderer/components/code-block/` | Syntax highlighting with table-row layout; language auto-detected via `utils/languageDetection.js` |
| `ToolCodeBlock` | `features/chat/.../tool-content-renderer/components/code-block/` | Parses tool-specific formats → `CodeBlock` |
| `CodeBlock` | `features/chat/.../tool-content-renderer/components/code-block/` | Low-level table renderer with sticky gutter |

**Gutter inference**: Edit's diff lines carry neither `file` nor `lineNum`, so `CodeBlock` renders them with no gutter.

**Element-override identity constraint**: `Markdown`'s `components` map is used by react-markdown as each tag's JSX element type, so a new identity per render (e.g. built inline, closing over `sessionDir`) makes React rebuild the subtree instead of updating it — defeating any memoisation inside it (`MarkdownCodeFence`, `MermaidDiagram`). Hoisted to module scope; per-render values reach the overrides through context instead of a closure. This is why `MarkdownCodeFence`'s memo existed without doing anything.

### 5.9 Event Processing Pipeline

SSE events flow through batching, turn grouping, and visibility filtering before reaching UI components.

**SSE lifecycle**:

```
EventSource('/api/stream')
├─ onopen → SET_CONNECTION_STATUS 'connected'
├─ onmessage → parse JSON
│  ├─ replay_started → REPLAY_STARTED with flushSync() (early return)
│  ├─ replay_ended → mark the server done sending; drain the rest (early return)
│  ├─ while replaying → append to the ordered replay queue
│  │  └─ drained in slices: REPLAY_SLICE per slice, REPLAY_ENDED once empty
│  └─ otherwise → STREAMING_FLAGS
│     ├─ Accumulate in the streaming buffer
│     ├─ Arm 50ms timeout
│     └─ Update isResponding (assistant=true, result=false)
├─ onerror → SET_CONNECTION_STATUS 'error'
└─ Reconnect after 2000ms
```

**Batching modes**:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Live streaming | 50ms timeout | Flush the streaming buffer every 50ms (FLUSH_BATCH) |
| Replay | Per drained slice | Commit `REPLAY_DRAIN_SLICE_SIZE` events at a time (REPLAY_SLICE), yielding between slices so the tab keeps painting; `flushSync()` used at `replay_started` for immediate UI feedback, not at flush |

**Counters advance during replay too.** `resultCount` and `compactionCount` are folded per event by `applyEventFlags`, which the replay path runs over every slice — a stored conversation replays its completed responses, so both counters climb while history loads and a replayed completion is indistinguishable from a live one by counter value alone. Any consumer keyed on them must gate on the loading flag (`isResuming || isReplaying`) and re-sync its own previous-value refs across the load, or it fires on replayed history. Two further traps for such a consumer: the final REPLAY_SLICE and REPLAY_ENDED are dispatched in the same synchronous call, so React batches them into one commit that carries both a counter jump and the flag turning false — that commit must be skipped as well, not just the ones where the flag is still set; and a brand-new session also emits replay boundaries (`replay_to` emits them even for zero events), so "a replay ended" does not imply "history was loaded". `useMessageQueue` is the current consumer: it drains only on a live counter advance, so a queued message waits for the first completed response cycle after the load rather than firing during it.

**Turn grouping state machine**:

```
EVENT → appendTurns(turns, state, visibleEvents)
│
├─ user (human, not nested) → Create new turn, set currentTurnIndex
├─ nested event (parent_tool_use_id) → Skip turn grouping (rendered inline in tool block)
├─ assistant/tool_use/tool_result → Append to current turn
├─ model_changed/permission_mode_changed → Append to turn.settingChanges (skip init events)
├─ compact_start → Append to current turn, save compactionStartTurnIndex
├─ compact_boundary → Use saved compactionStartTurnIndex
├─ user (non-human, during compaction) → Append to compaction turn
└─ interrupt_sent → Mark turn.interrupted = true
```

**Visibility filtering**: `isVisibleEvent()` hides `system` (init, hook_response) and `result` events from turn grouping.

**Derived state from `flushBatch()`**:

| State | Source | Consumer |
|-------|--------|----------|
| `events` | all | History |
| `visibleEvents` | filtered | Turn rendering |
| `turns` | grouped visible | ChatPanel |
| `turnResults` | result events | Turn status |
| `taskNotifications` | system + XML parsing | Tasks panel |
| `todoDiffs` | TodoWrite tracking | Todo highlights |
| `subagentLabels` | Task tool_use events | Tasks/Todos panels |
| `todosBySubagent` | TodoWrite tracking per subagent | Todos panel |

### 5.10 Tool Block Rendering

ToolBlock orchestrates tool display with state-driven collapse/expand and async task correlation.

**Props decomposition**:

```
ToolBlock(toolUse, toolResult, nestedEvents)
│
├─ useToolResult(toolUse, toolResult, todoDiff)
│  ├─ Apply per-tool formatter (buildToolHeader, getToolStatus, getToolTooltip, hasSpecializedFormatter)
│  ├─ Strip <system-reminder> blocks; detect <tool_use_error>
│  ├─ Extract structured payloads: questions, plan, todoData, taskPrompt, jsonData
│  └─ Resolve async state from TurnContext.taskNotifications when tool_use_result.isAsync
│
├─ shouldCollapseByDefault(toolName, jsonData, hasNested, isPending, wasAnswered)
│  └─ Tool-driven collapse policy: tools whose result is summarizable collapse;
│     interactive tools (AskUserQuestion, ExitPlanMode) stay expanded until answered;
│     Task expands once nested events arrive.
│
└─ Effect-driven transitions
   ├─ [pending → complete + hasNested] → collapse
   ├─ [Task + pending + nested arrives] → expand
   └─ [awaiting + user types in chat] → mark skipped
```

**Interactive tools**: AskUserQuestion and ExitPlanMode render forms via InteractiveQuestions. Form submit sets `wasAnsweredLocally`, collapses block, sends answer to the container API. `ChatPanel`'s `handleFormSubmit` reads whatever is sitting in the composer at that moment (`composerHandleRef.current.extractOrEmpty()`) and sends it alongside the answer as a sibling `note` instead of folding it into the answer text - the transcript matches the wrapped answer with an anchored regex no prefix survives (§1.4, "AskUserQuestion via interrupt()").

**Per-tool formatters** live in `utils/toolResultFormatters.js`. Tool routing for the *expanded* content area lives in `ToolContentRenderer` and consults `getToolConfig(toolName).renderer` from `config/toolRegistry.js` (`syntax-or-code`, `code`, `markdown`).

**Bash Command section**: `ToolBlockExpandedContent` renders Bash's raw command in a purpose-built "Command" section (`SyntaxHighlightedCodeBlock`, `language="bash"`) instead of the generic "Input" section - `toolInput` stays `null` for Bash, so the command reaches the component via its own `command` prop. Output gets a matching "Result" section, omitted when empty. `ToolBlock` derives this `command` once and reads it at both expandability gates (`hasExpandableContent`, the pending-content render gate), so the Command section renders while the call is still pending - the only handled tool admitted while pending on a payload other than `toolInput`. Every other handled tool keeps its content suppressed until the result arrives. `SyntaxHighlightedCodeBlock` takes a `showGutter` prop (default on); the Command section is the one caller that passes `showGutter={false}`, since its line numbers index nothing - `CodeBlockRow` drops the gutter cell and tags the content cell `code-block-no-gutter`, the same shape the parsed code-block path (`CodeBlockLine`) already uses for its own no-gutter callers.

**Segment grouping**: `groupBlocks` (`utils/groupBlocks.js`) runs two passes over a turn's blocks - the existing positional pass emitting consecutive Todos runs, then a whole-turn gather that pulls every read-only tool block out and appends one trailing `LookupsGroup` segment (rows re-render via `ToolBlock`). Categorisation (`category: 'read-only' | 'default'`) lives in `config/toolRegistry.js`, consulted via `getToolConfig`. The gather only sees top-level blocks, so a subagent's nested lookups are excluded by construction. The gather is switchable via `config/features.js::isLookupsGroupingEnabled()`; `predictTurnHeight.js` reads the same switch so predicted and rendered heights agree.

**Hidden tool blocks**: `utils/eventProcessing.js::isHiddenToolSearch(toolUse, toolResult)` is the single predicate deciding whether a tool-schema search (`ToolSearch` / LangGraph's `tool_search`) renders at all - hidden while pending or on success, visible only once the paired result reports an error. Applied at three sites that must agree: `groupBlocks` (top-level, skipped before Todos-run detection so a hidden call neither breaks nor absorbs into a run it interrupts), `processNestedEvents` (subagent Activity sections), and `predictTurnHeight` (indexes `tool_result` events by `tool_use_id` first, then skips priced blocks the predicate hides, so predicted and rendered heights agree). One predicate, one tool - not a general hidden-tools mechanism.

**Open-in-editor affordance**: `ToolBlock` resolves `editorUrl` once per block (`useEditorTemplate()` reads `editor_url_template` from session-defaults, `resolveEditorUrl()` substitutes the block's `filePath`/line) and passes it down to `ToolBlockHeader`, rather than each header or `LookupsGroup` row resolving its own. The header renders the control only when a URL resolves, opening via `window.open` with `stopPropagation` so it never reaches the collapse toggle. Resolution is entirely client-side - the identity workspace mount (§2.4) already makes a bare `file_path` a valid host path.

**Shell-call routing to the terminal column**: `utils/eventProcessing.js::isTopLevelBashCall(toolUse)` is the single predicate deciding what routes to the terminal column instead of rendering inline - `normalizeToolName(toolUse.content) === ToolName.BASH` (covering LangGraph's snake_case `bash` alias) and `!toolUse.parent_tool_use_id`. That absence check keeps a subagent's shell calls inside its Task block's Activity section, since `processNestedEvents` never applies the predicate and renders nested Bash calls unconditionally. Three call sites must agree on it: `groupBlocks`/`turnContent` skip the block from the turn, gated behind a `hideShellCalls` boolean served by `HideShellCallsContext`/`useHideShellCalls` (default off, so turn rendering is unaffected until the split turns it on); `hasVisibleBlock` drops header/footer chrome from a turn whose only content routed away, rather than rendering an empty shell; and `terminalEvents.js::deriveTerminalEntries` builds the column itself in one pass over session events, pairing each routed call with its result via `indexEvents` and stamping `turnId` from the most recent human-opened turn - in the wire format only that turn-opening human event carries a `turn_id`, never the `tool_use`.

### 5.11 Panel Management

SidePanelManager maintains canonical ordering, width restoration, and persistence for Dockview side panels.

**State shape**:

```
state.{left,right}
├─ width: number | null     # Last known group width
└─ order: string[]          # Active panel IDs in canonical order

state.bottom
├─ height: number | null    # Last known group height
└─ order: string[]          # Active panel IDs in canonical order
```

**Dimension restoration pattern**:

```
_withDimensionRestore(operation)
├─ _captureDimensions()    # Read current widths/heights
├─ operation()             # Open/close panel
└─ requestAnimationFrame()
   └─ _restoreDimensions() # Restore via setSize()
```

**Insertion algorithm** (`_findInsertionPoint`):

```
Opening panel at canonicalOrder[i]:
├─ Scan upward (i-1 → 0): find visible → stack BELOW it
├─ Scan downward (i+1 → end): find visible → stack ABOVE it
└─ No same-side panels → create new group
```

**Move detection**: `handlePanelMove()` removes panel from tracking if dragged to group without same-side siblings.

### 5.12 Input Block Collapse

XML block folding in chat textarea via `useBlockCollapse` hook.

**Placeholder format**: `<tagName...N>` where N is auto-incrementing counter.

**Block matching** (`findAllBlocks`):

```
For each <tag> opening:
├─ Track depth (++ on nested open, -- on close)
├─ depth == 0 → block found {start, end, tagName}
└─ Return blocks[] sorted by position
```

**Operations**:

| Function | Behavior |
|----------|----------|
| `collapseLocal` | Find enclosing block at cursor → replace with placeholder |
| `expandLocal` | Find nearest placeholder → restore original |
| `collapseAll` | Iterate innermost-first, replace right-to-left |
| `expandAll` | Reverse order (outer first) to handle nesting |
| `expandBeforeSubmit` | Expand all before sending to API |

**Shortcuts**: Ctrl+`'` (collapse), Ctrl+`"` (collapse all), Ctrl+`\` (expand), Ctrl+`|` (expand all). The code checks resulting key characters, not modifier combos — Ctrl+`"` is Ctrl+Shift+`'` on US keyboards. Non-US layouts may produce different characters for the same physical keys.

### 5.13 Layout & Keybindings

`App.jsx` is a thin router that selects `MobileApp` or `DesktopLayout` based on `useIsMobile()`. `DesktopLayout` is where Dockview layout, context nesting (via `AppProviders`), and global shortcuts (`useKeyboardShortcuts`) come together.

**Context provider order** (outer → inner, from `features/app/AppProviders.jsx`):

```
AppActionsProvider → WorkspaceProvider → DaemonStreamProvider → SessionsProvider →
ContainerMapProvider → SessionRoutingProvider → EventsProvider → LogsStreamProvider →
InteractionProvider → SessionDataBridge → NewSessionBridge → BookmarksProvider →
StashProvider → (cross-cutting effects + children)
```

**Default layout** (`features/app/utils/default-layout.js`, applied when no UI state is persisted):

| Panel | Position | Initial |
|-------|----------|---------|
| chat | center | open |
| sessions, bookmarks, boards | left (stacked) | open |
| todos, stash, tasks | right (stacked) | open |
| usage, mcp, commands, help | right | closed |
| logs | strip (full-width, above footer) | closed |

**Keybinding map** (`features/app/hooks/useKeyboardShortcuts.js`):

| Binding | Action |
|---------|--------|
| Alt+C | Focus chat tab |
| Alt+N | Create new session in current tab |
| Alt+Shift+N | Create new session in a new browser tab |
| Alt+0 | Toggle logs panel |
| Alt+1 | Toggle sessions panel |
| Alt+2 | Toggle bookmarks panel |
| Alt+3 | Toggle boards panel |
| Alt+4 | Toggle todos panel |
| Alt+5 | Toggle stash panel |
| Alt+6 | Toggle tasks panel |
| Alt+7 | Toggle usage panel |
| Alt+8 | Toggle mcp panel |
| Alt+9 | Toggle commands panel |
| Alt+↑/↓ | Previous/next message |
| Alt+Home/End | Jump to top/bottom |
| Alt+? or Alt+/ | Toggle help overlay |

**Layout persistence**: Debounced 500ms save to `/api/ui-state` on `onDidLayoutChange`. A stored layout is a serialized dockview instance and is therefore dockview-version-sensitive; `UIStateService.VERSION` (`domain/ui_state/service.py`) is the lever that discards state from an incompatible version rather than attempting a partial restore.

**Maximize/restore**: Saves both Dockview layout and SidePanelManager state to `preMaximizeLayoutRef` before maximize. On exit, restores both via `api.fromJSON()` (layout) and `manager.fromJSON()` (panel group dimensions and ordering).

### 5.14 Board Grid Layout

The board surface is a single CSS grid container (`.board-board`). `grid-template-columns` is computed in `BoardTab.jsx` from the current column order plus the collapsed-columns set: collapsed columns get a fixed `32px` track, expanded columns get `minmax(200px, 1fr)`. This guarantees every cell and header in the same column shares the same width across every swimlane — long ticket titles wrap inside the cell instead of widening only one swimlane's column.

Wrapper rows (`.board-header-row`, `.swimlane-band`, `.swimlane-columns`) are `display: contents` so their JSX children become direct grid items without an intermediate flex layout. Two consequences:

- Sticky column headers attach `position: sticky; top: 0` per `.board-col-header` cell instead of on the dropped row wrapper.
- The swimlane label spans every column via `grid-column: 1 / -1`, then the lane's per-column cells fall on the next implicit grid row.

Reordering columns (via grip-handle drag) or toggling collapse mutates the `columns` / `collapsedColumns` state, which recomputes `gridTemplateColumns` — no DOM restructure, every cell automatically reflows to the new track widths.

`BoardColumn` switches its cell rendering on a `density` prop threaded from `BoardTab` via `useSessionRouting().density`. Comfortable mode renders `<TicketCard>` per ticket; terse mode renders inline `<TicketLink>` elements separated by `, `, wrapping naturally inside the cell. Both modes share the same `<SortableContext>` so the drop-index machinery works identically. Density persists in the hash query string (`?density=terse`) — a per-viewer concern kept out of `board.yaml`. `navigateToBoard` re-appends the density param when switching boards via the panel so the choice survives navigation.

### 5.15 Board Drag-and-Drop Over-IDs

`BoardTab.handleDragEnd` dispatches on the `over.id` string emitted by @dnd-kit. The active drop targets:

| Over-ID format | Source | Purpose |
|----------------|--------|---------|
| `lane-header:${id}` | `useSortable` on `SwimlaneBand` header | Swimlane reorder via drag of the lane's grip handle |
| `col-header:${id}` | `useSortable` on `SortableColumnHeader` (grip listeners only) | Column reorder via drag of the column header's grip handle |
| `col:${id}` | `useDroppable` on `SortableColumnHeader` (entire header) | Ticket drop on a column header — column-only move that preserves each ticket's swimlane |
| `${col}::${swimlane}` | `useDroppable` on `BoardColumn` cell | Cell drop — explicit column AND swimlane target; appends to the cell |
| `<ticket-path>` | `useSortable` on `TicketCard` | Ticket drop on a ticket — insert at that visual slot in the cell (intra-cell reorder, or cross-cell with explicit position) |

Cross-lane bulk move: `handleDragEnd` computes `sourceLanes` from the moved selection and treats `sourceLanes.size > 1` as a cross-lane move, preserving each ticket's origin swimlane regardless of which cell-drop or header-drop was used.

Drop-index translation: when `over.id` is a ticket path, `BoardTab.handleDragEnd` calls `computeFlatDropIndex` from `features/boards/utils/dropIndex.js` to translate the visual slot (in the swimlane-filtered rendered cell) to a flat index into the per-state YAML list. The flat index is forwarded to the daemon via `MoveTicketRequest.index`. Bulk drags advance the index per same-lane move so multiple tickets land at sequential positions starting from the drop slot.

### 5.16 Additional Subsystems

Brief descriptions of cross-cutting subsystems not covered by dedicated sections above.

| Subsystem | Location | Description |
|-----------|----------|-------------|
| Message queuing | `managers/MessageQueueManager.js` | Queues user messages during SSE reconnection or while awaiting response; drains on response completion, compaction boundary, or connection restore |
| Path resolution | `managers/PathResolutionManager.js` | Resolves and highlights file paths in tool output; caches resolved paths for click-to-open. Alt+Click routes the resolved path through the same editor-URL resolution as the tool-block affordance (`utils/editorUrl.js`) instead of the clipboard; plain click is unaffected |
| Conversation fork | `features/chat/` + daemon `/sessions/{id}/fork` | Branch a session at a specific turn into a child session, optionally reusing the live container (web UI only — leverages the daemon's fork API; rewind itself is the upstream Claude Code CLI's built-in `/rewind` command) |
| Desktop notifications | `features/chat/hooks/` + `utils/` | Browser Notification API integration; triggers on response completion when tab is not focused; plays chime sound |
| Dynamic favicon | `features/chat/hooks/` | Updates favicon to reflect assistant state (responding, idle, error) |
| Session prompt editor | `features/sessions/` | Inline editor for per-session system prompt; persisted via container API |
| Model/permission switching | `features/chat/` | Dropdown selectors for model and permission mode; changes dispatched as setting change events rendered as dividers in chat |
| Attachment handling | `features/chat/` | File attachment via drag-and-drop or button; reads files as base64; previews before send |
| Markdown preview | `features/chat/components/` | Renders markdown content in tool blocks with toggle to raw source; mirrors MermaidDiagram pattern |
| Mermaid rendering | `features/chat/` | Renders Mermaid diagram syntax in assistant messages as inline SVGs |
| Minimap | `features/chat/components/minimap/` | Conversation overview sidebar; proportional sub-bars per turn, click/drag navigation, auto-show/hide with pin toggle. Reads per-turn heights from `useTurnHeights`, which prices every turn from content rather than from the DOM - a windowed-out turn has no element to measure |
| Setting change dividers | `features/chat/` | Visual dividers in chat when model or permission mode changes mid-conversation |
| Slash command autocomplete | `features/chat/` | Autocomplete dropdown for `/` commands in chat input; populated from container API command list |
| Workspace session-defaults cache | `hooks/useSessionDefaults.js` | Module-level cache + in-flight-request map keyed by workspace id, TTL `SESSION_DEFAULTS_CACHE_TTL_MS`, so `useCapabilities`'s many call sites share one request instead of one each. A rejection is never cached |
| Render failure containment | `components/ErrorBoundary.jsx` | The only class component in the codebase - hooks can't express `componentDidCatch`. Wraps every dockview panel (`features/app/components/withPanelBoundary.jsx`, reset on session change), plus a nested boundary around just the chat transcript so a transcript-only throw leaves the composer usable, and a root backstop in `main.jsx`. Errors log via `utils/errorReporting.js`, reaching the daemon log |

### 5.17 URL hash schema and scroll synchronization

The browser URL hash is the source of truth for "what is this browser tab showing":

- `#/workspaces/{id}` — welcome state, no active session
- `#/workspaces/{id}/sessions/{sessionId}` — active session at bottom (autoscroll engaged)
- `#/workspaces/{id}/sessions/{sessionId}/turns/<role>-<turnId>` — active session paused at a specific turn (autoscroll disengaged); `<role>` is `u` for user message, `a` for assistant message
- `#/workspaces/{id}/boards/{boardId}` — active board

A throttled scroll listener on the chat scroll container calls `replaceTurnInUrl(turnId | null, role | null)` (defined in `src/context/SessionRoutingContext.jsx`) to keep the hash in sync with the topmost-visible turn. `history.replaceState` is used so back/forward history is not polluted, and no `hashchange` event fires (preventing routing loops).

On page load, `parseHash` extracts the optional `/turns/<role>-<turnId>` segment; the chat panel scrolls to that turn after replay completes. With no turn segment, the chat panel scrolls to bottom and engages autoscroll (existing §3.4 behavior).

Cross-session navigation (bookmarks, deep-links) carries the turn target through the URL, so opening a bookmark in a new browser tab (Alt+click) lands on the bookmarked turn.

### 5.18 Main panel — URL-driven content slot

The dockview center group hosts a single `main` panel registered in `config/layout.js` and added to dockview by `features/app/utils/default-layout.js`. The panel renders `features/app/components/MainPanel.jsx`, which selects content based on the active URL read from `SessionRoutingContext`:

- bare workspace URL → the welcome view (`ChatPanel`'s internal welcome branch)
- `/sessions/{sid}` segment → `ChatPanel` for that session
- `/boards/{bid}` segment → `BoardTab` for that board

`MainPanel` always renders `SessionHeaderStrip` as its chrome above the URL-driven body. There is no tab bar on the main panel and there are no per-board sibling panels — switching content (e.g., chat to board) happens through the existing URL-routing mechanism: bookmark click, board sidebar click, deep-link, browser back/forward.

Side panels (Sessions, Bookmarks, Boards, Todos, Stash, Tasks, Usage, MCP, Commands, Help, Logs) anchor to the `main` panel via `referencePanel: 'main'` in `default-layout.js` and `SidePanelManager._openPanel`. The save path inside `useDockviewLayout.onDidLayoutChange` consults `sessionIdRef.current` — bound by `onSessionAttach(sessionId)` — to know which session's UI state to PATCH on every layout change.

### 5.18.1 Chrome Button Tokens

Vertical metrics for chrome icon buttons (panel headers, the session header strip, session-item icon buttons) consume a shared token set defined in `App.css`:

- `--chrome-btn-h: 22px` — hover-bg height
- `--chrome-btn-pad-y: 3px` — top/bottom padding inside the button
- `--chrome-btn-mar-y: 3px` — top/bottom margin so 22 + 3 + 3 = 28px (the strip height)
- `--chrome-btn-line-height: 1` — prevent line-height inflation of single-icon buttons
- `--header-icon-color: var(--text-primary)` — brighter color applied to the four main-area-header buttons (Stop, `+`, chevron, workspace switcher) so they read as a coherent action set

Adopted by `SessionHeaderStrip.css`, `WorkspaceSwitcher.css`, `NewSessionSplitButton.css`, `SessionsPanel.css`, and `SessionItem.css`. Any future chrome button must consume the tokens; redefining vertical metrics per surface is forbidden (see GUIDELINES.md §6 Chrome Buttons).

### 5.19 Interaction Conventions

Use the Pointer Events API (`onPointerDown`/`onPointerMove`/`onPointerUp` and `addEventListener('pointer*')`) for all drag, click-vs-drag, scroll-gating, and resize handlers. Pointer events unify mouse, touch, and pen input behind one contract. Filter `event.pointerType === 'touch'` when behavior should fire only on touch gestures. Avoid `touchstart`/`mousedown` pairs. Shared helpers live in `utils/pointer.js` (currently `isPrimaryPointer`; `getPointerDistance` and `DRAG_THRESHOLD_PX` land with the first click-vs-drag consumer).

Outside-click detection (`useDropdown`, `useAttachments`) and prevent-blur handlers (`SessionItem`, `SessionNameEditor`, `CommandAutocomplete`) keep `mousedown` because they target click semantics, not drag. Pure hover (`mouseenter`/`mouseleave`) stays on mouse events; pointer events fire alongside on desktop, so UX is unchanged.

### 5.20 Client-Side Storage Contract

`useLocalStorage` writes from a `useEffect`, never from inside the `setState` updater - React can replay a queued updater during render, and a `QuotaExceededError` thrown there would unmount the tree uncaught. `persist()`/`flush()` wrap the actual write in try/catch and degrade silently on failure.

Four per-session prefixes (`draft:`, `inputHistory:`, `inline-replies:`, `queue:`; registered in `config/storage.js`) hold session-scoped state; only `inputHistory:` is capped, via `utils/inputHistoryCap.js`'s oldest-first eviction. `utils/sessionStorageGc.js`'s `sweepDeadSessionStorage` removes entries once their session no longer exists, run from `SessionsContext.jsx` after each successful session fetch.

The prefixes carry no workspace segment, so a session live in another workspace looks dead from one workspace's own fetched list alone. `collectLiveSessionIdsAcrossWorkspaces` unions every registered workspace's session list before the sweep runs, falling back to the current workspace's own set if that lookup fails.

This section covers browser `localStorage` only. Session-scoped preferences persisted through the
server-side `/api/ui-state` PATCH contract instead (`minimapPinned`, `terminalSplitEnabled`,
`terminalSplitRatio`, bottom-panel layout, dockview layout) are documented alongside the feature
that owns them - see §5.6 for the terminal split keys.

---

## 6. Daemon (`claudebox_daemon`)

Host-side process orchestrating multiple workspaces and containers. Runs outside containers, managing their lifecycle via podman/docker.

### 6.1 Three-Layer Architecture

```
DaemonService (singleton via domain.current)
├── Broadcaster (daemon-level SSE)
├── ContainerProxyClient (reverse proxy to containers)
├── HealthMonitor (periodic polling of registered workspaces and their containers)
├── SessionMutationObserver (polls each container's /api/sessions/current for updated_at
│                             changes → emits SessionsChangedEvent on the daemon stream)
├── DaemonConfig (reloaded on every workspace lookup, source of truth for the registered list)
└── WorkspaceService[] (one per registered workspace)
    ├── ContainerService (podman lifecycle, registry)
    ├── SessionService (session CRUD, fork, container orchestration)
    ├── UIStateService (layout/panel state persistence)
    └── BoardService (board listing, mutation, mtime-driven updates)
```

**DaemonService** lazily loads `WorkspaceService` instances from `~/.claudebox/daemon.json`.

**WorkspaceService** provides isolated per-workspace state. When the workspace directory is unavailable, the *sub-services* are set to None on the (still non-None) WorkspaceService.

**ContainerService** broadcasts `STOPPING` status before initiating stop, then `STOPPED` after completion — two-phase broadcast enables frontend stopping state feedback.

**Per-workspace config reload on container create.** `WorkspaceService` loads each workspace's `Config` once at construction, and that snapshot drives `ContainerService`'s construction-time concerns — backend selection (`create_runtime`), `config_dir` / state-file path, and the `agent` / `profile` bound into `SessionService` — so changing any of them needs a daemon restart. Run-arg settings are re-read per container create instead: `ContainerService._start_container` calls `Config.load(workspace.path)` and threads the fresh copy into `ContainerRuntime.run_container(config=...)`, so mounts, ports, env vars, network mode, and the nested-containers opt-in follow the current `settings.toml` from the next created session (new / resume / fork) on. Distinct from `DaemonService._reload_config()`, which re-reads only the registered-workspace list (`DaemonConfig`).

**SessionService** orchestrates session lifecycle: listing from disk via `SessionRepository`, spawning containers for new/resumed sessions, forking sessions at turn boundaries. `create()`, `resume()`, and `fork()` all return a unified `SessionInfo` shape (extends `SessionMetadata` with `container_id`, `workspace`, `permission_mode`, `effort_level`) so the frontend can populate the footer from the response without waiting for the SDK init event. `fork(reuse_container=True)` transfers ownership of the live container to the new (child) session by calling `ContainerService.update(container, session_id=new_session_id)` after seeding the child's `session.json` (with `parent_session_id` linking back); `find_by_session()` then resolves the running container under the child id, so the parent's running indicator clears in the sessions panel and stop affects only the child. `parent_session_id` on the child remains the back-link from child to parent across the fork tree.

**Fork seed — three sources.** The child's `session.json` is composed from three sources rather than spread verbatim from the parent: (1) identity fresh — `session_id`, `parent_session_id`, `session_dir`, `workspace`, `started_at`, `updated_at`; (2) `INHERITED_CONFIG_FIELDS` from the parent's `session.json` — `name`, `model`, `permission_mode`, `effort_level`, `session_prompt`, `first_message`, `context_window`, `commands`; (3) accumulated counters and last-value snapshots derived from the child's (possibly truncated) `events.jsonl` via `_compute_derived_fields` — `total_cost_usd`, `total_duration_ms`, `num_turns`, `last_message`, `last_context_tokens`, `todos`. Truncation runs BEFORE the derivation step so the totals reflect the events the child's transcript will actually contain, not the parent's tail. The seed also carries `fork_point_cost_usd` (= the derived `total_cost_usd` at fork moment) — a snapshot consumed at rollup time by the usage panel: the panel deducts each session's snapshot from its reported total so the shared pre-fork cost is attributed once to the ancestor, not double-counted across siblings. Missing or unparseable parent metadata falls back to a minimal seed (identity fields only, derived counters from the file if present).

### 6.1.1 Blocking-Path Contract

One event loop serves every handler across every registered workspace; an unbounded call anywhere stalls the whole daemon, not just its own request.

Five bounds close that surface:

- **Outbound HTTP.** The shared `ContainerProxyClient` carries `CONTAINER_PROXY_TIMEOUT` (`connect=5.0, read=15.0, write=30.0, pool=30.0`) and explicit `CONTAINER_PROXY_LIMITS`. One `read` bound covers both ordinary requests and SSE streams, since every stream pings every second. `httpx.TimeoutException` maps to `ContainerTimeout` (504).
- **FileLock acquisition.** Every `FileLock` (the daemon's own three sites; ten board-mutation sites in `parser.py`) carries `timeout=FILE_LOCK_TIMEOUT_SECONDS` (5s); a `filelock.Timeout` becomes a typed `LockTimeout`/`BoardLocked` instead of blocking forever.
- **Podman subprocess.** `ContainerBackend._exec` takes an explicit `timeout=`: `PODMAN_COMMAND_TIMEOUT` (15s) for admin commands, `PODMAN_RUN_TIMEOUT` (60s) for a detached spawn. The interactive foreground session and `build_image` stay unbounded - the daemon never calls either.
- **Poller backstop.** `AsyncPoller._loop` wraps each `_poll()` in `asyncio.wait_for`, sized off the poll interval - a backstop against a future unbounded call in a `_poll()` override, not the fix for any one call.
- **Disk listing.** `BoardService.list_all`/`SessionService.list_all` dispatch to the listing pool and wrap that dispatch in a 15s `asyncio.wait_for`, raising a typed `ListingTimeout` (504). Concurrent callers share one scan per workspace via `SingleFlight` (`claudebox.core.concurrency`) — every open tab refetches on the same `sessions_changed` broadcast, so ten tabs across two workspaces asked the same question up to twenty times at once and each copy occupied a worker. Callers await through a shield, so one caller hitting its bound never cancels the scan the others are still waiting on.

**A bound around a dispatch measures admission, not execution.** `asyncio.wait_for(loop.run_in_executor(...))` starts its clock at submission, so it covers time spent queued *plus* time spent running, and cancelling it reclaims a worker only while the job is still queued — once a thread has picked the job up it runs to completion regardless. A listing that never started therefore logged the same line as one that hung on the filesystem, which is how a merely-full pool came to be read as a dead network mount. Both listings now record whether a worker ever picked the job up (`executors.tracked`) and log `scan_started` / `walk_started`, the seconds spent queued, and the depth of the pool they were queued on.

**Executor ownership.** Three dedicated pools (`domain/executors.py`), never the process-wide default, split by class of work: `listing` (8) for the disk scans above, `podman` (4) for every runtime invocation, `state` (4) for `FileLock`-guarded registry and ui-state writes. Sizing is per concern and shared across workspaces rather than per workspace, which would multiply threads by a number the operator sets without seeing the cost. One shared pool was the arrangement that let a listing backlog take podman dispatch, registry writes and ui-state patches down with it.

**Pool observability.** `ObservedPool` wraps `submit`, so every dispatch is counted wherever it was written, including `run_in_executor`. `stats()` reports workers, queued, running and oldest-queued age per pool; `DaemonExecutors.saturated()` names the backed-up pools longest-wait-first. A job that waits longer than `QUEUE_WARN_SECONDS` (2s) for a worker logs `pool_queue_backlog` once it completes, naming the wait it incurred; a job still sitting in the queue has nothing to report from, so live depth is read from `stats()` — which is what the listing-timeout log and the health body carry. None of this was measured before, which is why a saturated pool could only be diagnosed by elimination.

Board/session **mutation** paths stay on the loop, bounded only by their own lock/subprocess timeouts - not dispatched to the executor. `BoardService._discover`'s per-listing index rebuild is unchanged; persisting it across listings is a separate concern.

### 6.2 Module Map

```
app.py                    # FastAPI factory, uvicorn entry
serving.py                # Dev (uvicorn+reload+Vite) vs production (uvicorn+Caddy reverse proxy)
constants.py              # health/lifecycle timings, registry filenames (paths live in claudebox.constants)

domain/
├── service.py            # DaemonService — top-level singleton
├── config.py             # DaemonConfig — daemon.json loader (registered workspaces)
├── errors.py             # DaemonError base class (status_code, error_key)
├── health.py             # HealthMonitor — periodic workspace/container polling (extends AsyncPoller)
├── mutation_observer.py  # SessionMutationObserver — polls each container's session state and broadcasts SessionsChangedEvent on changes
├── workspaces/
│   ├── models.py         # RegisteredWorkspace dataclass
│   └── service.py        # WorkspaceService — per-workspace orchestration (Container/Session/UIState/Board services)
├── containers/
│   ├── models.py         # Container, ContainerStatus, ContainerStatusEvent
│   ├── service.py        # ContainerService — podman lifecycle (backed by ContainerRuntime or LocalRuntime)
│   ├── proxy.py          # ContainerProxyClient — reverse proxy via httpx
│   └── errors.py         # ContainerNotFound, ContainerTimeout, ContainerUnavailable
├── sessions/
│   ├── models.py         # SessionInfo(SessionMetadata), SessionProgressEvent, SessionsChangedEvent
│   ├── service.py        # SessionService — session CRUD, fork, container orchestration
│   └── errors.py         # SessionNotFound, session-specific errors
├── ui_state/
│   ├── models.py         # UIState dataclass (global_state + session_state)
│   └── service.py        # UIStateService — versioned JSON state with dot-path PATCH operations
└── boards/
    ├── models.py         # BoardUpdateEvent — daemon-emitted SSE event.
    │                     # Re-exports Board, BoardState, BoardSummary, BoardTicket, Swimlane from claudebox.extensions.tickets
    ├── service.py        # BoardService — board listing/mutation; delegates parsing and YAML I/O to claudebox.extensions.tickets
    ├── watcher.py        # BoardWatcher — extends MtimeWatcher, polls board directories for mtime changes (deliberately mtime-based for NFS/container-mount reliability)
    └── errors.py         # BoardNotFound, BoardParseError, TicketNotFound, SwimlaneNotFound

handlers/
├── daemon.py             # /api/daemon/* — health, stream, workspaces
├── containers.py         # /api/workspaces/{id}/containers/* — container CRUD + reverse proxy
├── sessions.py           # /api/workspaces/{id}/sessions/* — session CRUD, resume, fork
├── workspaces.py         # /api/workspaces/{id}/session-defaults — workspace-level config metadata
├── ui_state.py           # /api/workspaces/{id}/ui-state — GET/PATCH
├── boards.py             # /api/workspaces/{id}/boards/* — board listing, detail, ticket and swimlane mutations, state reordering
├── _shared.py            # FastAPI dependency injection (DaemonDep, WorkspaceDep annotations)
└── _models.py            # Pydantic request/response models
```

### 6.3 API Endpoints

**Daemon-level** (no workspace prefix):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/daemon/health` | GET | Daemon liveness probe — `{mode, status}` plus the signal breakdown and pool counters (see §6.6) |
| `/api/daemon/stream` | GET (SSE) | Daemon-level event stream |
| `/api/daemon/report` | POST | Frontend failure report (`kind`, `message`, `stack_trace`, `app_version`, `client_timestamp`), logged via `DaemonService.report_frontend_error` at WARNING - no free-form field, so nothing to smuggle conversation content into. Named `stack_trace` not `stack`: structlog's `StackInfoRenderer` silently drops a literal `stack` key. |

**Top-level cross-workspace**:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workspaces` | GET | List registered workspaces with container counts |
| `/api/workspaces` | POST | Register a workspace |
| `/api/workspaces/{id}` | DELETE | Deregister a workspace |
| `/api/containers` | GET | Aggregate containers across all workspaces |

**Workspace-scoped** (`/api/workspaces/{workspace_id}/...`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/containers` | GET | List all containers for a workspace |
| `/containers` | POST | Spawn a new container |
| `/containers/{id}` | GET | Get container details |
| `/containers/{id}` | DELETE | Stop and remove a container |
| `/containers/{id}/{path}` | * | Reverse-proxy to container backend |
| `/sessions` | GET | List all sessions from workspace disk |
| `/sessions/new` | POST | Spawn container and start new session — returns full `SessionInfo` (workspace, session_dir, model, effort_level defaults populated) |
| `/sessions/{id}` | PATCH | Update session metadata |
| `/sessions/{id}/resume` | POST | Resolve or spawn container, resume session — returns full `SessionInfo` (reads on-disk metadata via `_build_session_info` and overlays defaults) |
| `/sessions/{id}/fork` | POST | Fork session at turn, optionally reusing the source's container — returns full `SessionInfo`. With `reuse_container=true`, transfers `Container.session_id` to the new session so the running indicator moves to the child. |
| `/ui-state` | GET | Retrieve UI state (global + session) |
| `/ui-state` | PATCH | Apply patch operations to UI state |
| `/boards` | GET | List board summaries from workspace docs/boards/ |
| `/boards/{id}` | GET | Parse and return full board (states, tickets, swimlanes) |
| `/boards/{id}` | PATCH | Rename a board (sets `name:` in board.yaml) |
| `/boards/{id}/tickets/{path}/content` | GET | Raw markdown content of a ticket file |
| `/boards/{id}/tickets/{path}/move` | PATCH | Move a ticket between states/swimlanes; optional `index` field inserts at a specific flat-list position (omit to append) |
| `/boards/{id}/tickets/{path}` | DELETE | Archive (remove from YAML; file stays on disk) |
| `/boards/{id}/assign` | POST | Batch-assign tickets to new sessions |
| `/boards/{id}/swimlanes` | POST | Create new swimlane |
| `/boards/{id}/swimlanes/{swimlane_id}` | PATCH | Rename swimlane |
| `/boards/{id}/swimlanes/{swimlane_id}` | DELETE | Delete swimlane (its tickets become unsorted) |
| `/boards/{id}/swimlanes/reorder` | PATCH | Reorder swimlanes |
| `/boards/{id}/states/reorder` | PATCH | Reorder columns/states |
| `/boards/{id}/states/{state_id}` | PATCH | Rename a state's display label (`{label: str}` body). Folder name and state ID are intentionally immutable — ticket files are stored under `{folder}/` and the state ID is the column key in board.yaml; only the human-facing label changes. |
| `/session-defaults` | GET | Workspace path + model / permission / effort defaults a new session would inherit, plus the `available_models` / `available_permission_modes` / `available_effort_levels` choice lists, plus the workspace's live `rate_limits` (§1.5 Persistence) for the footer before any session attaches. Sourced from `claudebox.claude.definitions` constants today; future workspace overrides slot in here without changing the response shape. Sole source of these lists in the frontend — consumed by `useSessionDefaults` (footer welcome-screen values) and `SessionDataProvider` (picker dropdown contents). |
| `/commands` | GET | Workspace's filesystem-discovered slash commands and skills, payload `{custom, mcp, builtin}` matching the in-session `commands` field shape. `mcp` and `builtin` are always empty for the welcome catalog (the daemon has no visibility into running MCP servers or SDK-emitted built-ins). Funnels through the same `claudebox.claude.parser.load_slash_commands` parser as the in-container session catalog, so naming and metadata stay consistent. Consumed by `useWorkspaceCommandCatalog` and falls into `SessionDataContext.commands` whenever `sessionData?.commands` is null (welcome screen). |

Board change events are broadcast on the daemon-level `/api/daemon/stream` (as `BoardUpdateEvent`) — there is no per-board SSE endpoint.

#### Container-proxy path contract

`Container.base_url` is deliberately `/api`-less (`http://localhost:{port}`), and the proxy forwards to `f"{container.base_url}/{path}"` using the caller-supplied trailing path verbatim. **The caller therefore supplies the container's own `/api` prefix.** A container endpoint declared as `/api/logs` is reached at `/api/workspaces/{ws}/containers/{id}/api/logs` — the doubled `api` is correct, not a typo.

Both callers follow this: the frontend (`LogsStreamContext`, `SSEConnectionManager`) and the CLI (`cmd_logs._container_logs_url`). Do not "fix" the omission by injecting `/api` inside the proxy — that would break every other proxied path.

#### Welcome → session config buffer drain

Frontend pickers (model / permission mode / effort level) live in the footer and are visible on the welcome screen, before any session attaches. Today picker setters call container-proxied endpoints that require an active container; on welcome they would silently fail. Instead `SessionDataProvider` checks `getContainerId()`: when no container is active the value is buffered in `deferredModel` / `deferredPermissionMode` / `deferredEffortLevel`. Latest-wins — repeated picker changes overwrite the buffered value before drain. When `sessionData?.session_id` transitions from null to set (session attached), a single drain effect awaits the buffered config in strict order: model → permission → effort. Each await ensures the SDK applied the change before the next call. A failed call surfaces via `onError` and the remaining successful changes still apply. The deferred message in `useChatController` keys off the same session_id transition, so the first message is sent only after the config drain completes.

### 6.4 Serving

Two modes selected by `is_dev_mode()`. The user-facing port (`DAEMON_PORT` in production, `DAEMON_DEV_PORT` in development) shifts via `_resolve_port()`; the backend uvicorn always listens one port above the user-facing port.

| Mode | User-facing | Backend (uvicorn) | Notes |
|------|-------------|-------------------|-------|
| Development | `DAEMON_DEV_PORT` (Vite) | `DAEMON_DEV_PORT + 1` | Hot reload; HTTP only |
| Production | `DAEMON_PORT` (Caddy) | `DAEMON_PORT + 1` | Caddy handles H2/TLS via `tls internal`, proxies to uvicorn; Caddyfile written to temp dir |

Caddy is the only externally-bound listener; the uvicorn backend binds loopback only via
`http_serve`'s `host` parameter. The container API keeps all interfaces, since its port is
published from inside a container and a loopback bind there would be unreachable from the host.

Startup: banner logged via Rich; Caddy/uvicorn output is captured by the structlog-routed logging stack and lands in the daemon log file (`use_rotating_log_file` in `app.py`).

Shutdown: both the Vite and Caddy subprocesses are launched with `start_new_session=True` and
stopped by signaling their whole process group (`_stop_subprocess`), not just the immediate
process — `npm`/`npx` do not forward a received SIGTERM to the `vite` child they spawn, so
single-process signaling would leave that grandchild running after every dev-mode stop.

### 6.5 SSE Broadcasting

`DaemonService.events` (Broadcaster) pushes events to all connected `/api/daemon/stream` subscribers. `SessionProgressEvent` broadcasts progress during session lifecycle (spawning, health checks, ready). `SessionsChangedEvent` signals that the sessions list changed (after create, resume, fork, update) — the frontend uses this to refetch immediately instead of polling.

### 6.6 Systemd Deployment

The daemon runs as a user-level systemd service (`claudebox-daemon.service`, in `lib/etc/systemd/`). Critical configuration:

```ini
[Unit]
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
Type=simple
ExecStart=%h/.local/bin/claudeboxd          # symlink → lib/bin/claudebox_daemon.sh
KillMode=process
Delegate=yes
TimeoutStopSec=15
Restart=always
RestartSec=8
```

**KillMode=process** — only SIGTERM/SIGKILL the main daemon process. With rootless podman, container helper processes (`rootlessport`, `conmon`, network executors) live in the daemon's cgroup. The default `control-group` or `mixed` kill modes send SIGKILL to the entire cgroup on stop, destroying podman's port forwarding infrastructure. Containers survive (separate PID namespace) but their host port mappings die — the daemon rediscovers them as "running" with correct ports, yet all proxy connections fail with `ConnectError`.

**Delegate=yes** — gives the service its own cgroup subtree. Podman can create proper sub-cgroups for container processes, cleanly separating them from the daemon process.

**Process lifecycle** — the launcher script (`lib/bin/claudebox_daemon.sh`) runs `uv run --project $ROOT_DIR $ROOT_DIR/src/host_daemon.py` as a backgrounded child and traps SIGTERM/SIGINT via a `cleanup()` function. On signal, the function recursively walks the child process tree via `pgrep -P` and sends SIGTERM to each descendant (depth-first), sleeps 5 seconds for graceful shutdown, then SIGKILLs any survivors — the budget fits comfortably under `TimeoutStopSec=15`. This two-phase approach is necessary because uvicorn's graceful shutdown plus Caddy's atexit termination can exceed `TimeoutStopSec` on a busy daemon, causing systemd to SIGKILL only the wrapper (because of `KillMode=process`) while children survive as orphans. The recursive tree walk (rather than process-group signalling) is required because `uv run` creates a new process group for its child Python and does not propagate SIGTERM; signalling the wrapper's process group or `exec`-ing into `uv` will not reach the child tree.

**Crash vs. clean-shutdown exit contract** — the wrapper exits 0 only when shutdown was signal-initiated: the `cleanup()` trap sets a flag, and the main path exits 0 when that flag is set, otherwise it propagates the child's exit status (captured via `wait … || status=$?` to stay clear of `set -e`). Combined with `Restart=always`, a crash (e.g. a startup port-bind race) surfaces as a non-zero exit that systemd restarts after `RestartSec` and records in `systemctl --user status`, while an intentional `systemctl stop`/`restart` exits 0 and is a systemd-initiated stop, so no spurious restart loop occurs. `Restart=always` (rather than `on-failure`) recovers from any unexpected exit — appropriate for an always-on daemon.

**Health-polling supervision** — `Restart=always` only recovers from the daemon exiting, not from a daemon that stays alive but stops answering (port open, every request hangs) — the failure that actually happens. `DaemonWatchdog` (`claudebox_daemon/domain/watchdog.py`, an `AsyncPoller` subclass) measures that gap: every `WATCHDOG_HEARTBEAT_INTERVAL` (5s) tick it compares intended wake-up against actual, since that's what a hung event loop looks like from the outside (a timer that fires unconditionally would report healthy through a stall). `.healthy` flips false once lag exceeds `WATCHDOG_LAG_THRESHOLD` (15s).

**What health aggregates.** Loop lag alone described a daemon that stops scheduling, not one that stays alive and cannot answer — during the incident behind the pool split above, the loop was dispatching callbacks at millisecond granularity while every request queued behind eight busy threads, so health returned `ok` throughout and the daemon was restarted by hand. `/api/daemon/health` now aggregates two signals and names the one that tripped: `event_loop` (`DaemonWatchdog`, lag as above) and `serving` (`ServingProbe`, `domain/serving.py`) — every `SERVING_PROBE_INTERVAL` (5s) the probe submits a trivial job to each serving pool and requires it back inside `SERVING_PROBE_TIMEOUT` (20s). That bound covers queueing *and* execution, so it sits deliberately **above** `DISK_LISTING_TIMEOUT` (15s) — listings running their full contractual bound are progressing, not stuck, and a probe queued behind them must not read as a daemon that cannot serve. `SERVING_PROBE_MAX_FAILURES` (3) consecutive failures are required before the verdict flips, because the host script's three checks span ~4s against a verdict refreshed every 5s and would otherwise all read one transient spike. A probe that does not return reads unhealthy, never as still pending. The `podman` pool is deliberately not part of the verdict: a spawn is legitimately bounded at 60s and four concurrent ones are healthy, and since the pools were split its saturation no longer blocks the paths that serve requests — its counters are reported, not gated on. Top-level `status` stays `ok` / `degraded` because the host script greps for it; the body carries `degraded`, `signals`, per-pool latency and the pool counters, and `claudebox_watchdog.sh` logs that body before restarting so a restart is explicable afterwards. **The endpoint reads cached probe results and counters only — nothing on its path dispatches to a blocking pool** (FastAPI resolves the sync `get_daemon` dependency on AnyIO's own threadpool, which is disjoint from these), since a health check that queues behind the saturation it reports would be useless. Still undetectable by either signal: a daemon that answers health promptly while a specific request path is broken (a wedged proxy connection, a workspace whose disk is gone), since neither signal exercises per-workspace work. A separate host-side unit, `claudebox-watchdog.timer`, polls that endpoint every 30s (`lib/bin/claudebox_watchdog.sh`) and restarts `claudebox-daemon.service` after three consecutive unhealthy-or-unreachable checks, 2s apart. `StartLimitIntervalSec=600` / `StartLimitBurst=5` on the daemon unit bound the resulting restart rate — polling carries no restart-limiting of its own, unlike systemd's native watchdog, so the unit supplies it; a daemon that hangs immediately on every start reaches systemd's start-limit and stops there instead of restarting forever, visible as a failed unit in `systemctl --user status`.

**Why not systemd's native watchdog (`Type=notify`)** — `NotifyAccess=main` accepts datagrams only from the process systemd tracks as the unit's main one. `lib/bin/claudebox_daemon.sh` backgrounds its Python payload and traps signals in the wrapper for teardown (see Process lifecycle above) — the process that would call `sd_notify` is a grandchild, not the main process, and no value of `NotifyAccess` admits a grandchild. `NotifyAccess=all` accepts the whole delegated cgroup, which under `Delegate=yes` includes conmon, rootlessport, and (with nested containers) a second podman — none of them should be trusted as the notifier either. Making the daemon itself the main process would fix this but breaks the teardown contract the wrapper exists for. `Type=notify` is therefore not available to this daemon while the wrapper owns teardown — do not reintroduce it.

Catches a stalled event loop (lock/synchronous-filesystem stalls), not a loop still running with a request parked on an await that never returns - that needs a liveness signal from the pollers themselves (`HealthMonitor`, `SessionMutationObserver`), deliberately deferred rather than blocking this fix on it.

**Maintenance timer** — `claudebox-maintenance.service` (oneshot) re-runs `lib/bin/install.sh` to refresh the local installation: it pulls the latest library, rebuilds the container image with `--update`, cleans stale session/temp directories, and prunes dangling images. `claudebox-maintenance.timer` schedules this `OnCalendar=daily` with `RandomizedDelaySec=1h` and `Persistent=true` so missed runs catch up after the host wakes from sleep.

**Watchdog timer** — `claudebox-watchdog.service` (oneshot) runs `lib/bin/claudebox_watchdog.sh`, the poll-and-restart script behind Health-polling supervision above. `claudebox-watchdog.timer` schedules it `OnBootSec=30s` / `OnUnitActiveSec=30s`.

---

## 7. Testing

### 7.1 Python Tests

Two pytest trees from `lib/` root: `tests/` for unit tests (mirrors source package layout) and `e2e/cli/` for CLI E2E tests (invokes the `claudebox` binary as a subprocess via `run_claudebox` fixture in `conftest.py`). Both registered as `testpaths` in `pyproject.toml`.

```
tests/
├── conftest.py                               # anyio_backend (asyncio), tmp_workspace, isolate_home fixtures
├── test_pytest_socket_policy.py              # Sentinel - pytest-socket deny-by-default is active
│
├── claudebox/
│   ├── agent_session/
│   │   ├── langgraph_tools/
│   │   │   ├── conftest.py                   # Shared fixtures for this tree
│   │   │   ├── test_filesystem.py            # read_file, write_file, edit_file
│   │   │   ├── test_mcp.py                   # list_mcp_resources + read_mcp_resource defensive routing
│   │   │   ├── test_meta.py                  # tool_search keyword discovery over ctx.tool_catalog
│   │   │   ├── test_middleware.py            # ClaudeboxToolHookMiddleware
│   │   │   ├── test_notebook.py              # notebook_edit
│   │   │   ├── test_question.py              # ask_user_question backed by interrupt()
│   │   │   ├── test_search.py                # glob, grep
│   │   │   ├── test_shell.py                 # bash
│   │   │   ├── test_skill.py                 # workspace skill lookup + body return + ARGUMENTS appending
│   │   │   ├── test_subagent.py              # task() sub-agent dispatcher + agent registry
│   │   │   ├── test_task_mgmt.py             # 6 wrappers over TaskService
│   │   │   └── test_web.py                   # web_fetch, web_search
│   │   ├── orchestration/
│   │   │   ├── _helpers.py                   # Shared helpers for this tree
│   │   │   ├── test_async_monitor.py         # AsyncTaskMonitor
│   │   │   ├── test_async_tasks.py           # background task lifecycle
│   │   │   ├── test_attachments.py           # path resolution and MIME inference
│   │   │   ├── test_conversion.py            # message-to-event pipeline
│   │   │   ├── test_models.py                # event and session data models
│   │   │   ├── test_persistence.py           # event log I/O
│   │   │   ├── test_pipeline.py              # result-only turn and echo suppression
│   │   │   ├── test_pipeline_init.py         # initialization and event processing
│   │   │   ├── test_pipeline_inject.py       # event injection and buffering
│   │   │   ├── test_projection.py            # session summary accumulator
│   │   │   ├── test_projection_runtime_coupling.py # Skill metadata comes from the active runtime, not ClaudeRuntime
│   │   │   ├── test_session.py               # content block building and internal commands
│   │   │   ├── test_session_internals.py     # dispose, projection resolution, state tracking
│   │   │   ├── test_session_lifecycle.py     # send and stop lifecycle
│   │   │   ├── test_tool_output.py           # file retrieval
│   │   │   └── test_turn_tracker.py          # turn ID state machine
│   │   ├── test_capability_transport.py      # Session.get_capabilities, REST endpoint, session-info envelope, SSE init enrichment
│   │   ├── test_catalogs.py                  # ClaudeRuntime catalog accessors + Skill parser
│   │   ├── test_config_builder.py            # config -> SDK options round-trip
│   │   ├── test_event_translation.py         # SDK message -> typed AgentEvent
│   │   ├── test_events_typed_shapes.py       # Typed init/usage shapes - no escape-hatch dicts
│   │   ├── test_events_validation.py         # Typed AgentEvent payloads fail loud on contract violations
│   │   ├── test_factory.py                   # make_agent_session factory + UnknownRuntime dispatch
│   │   ├── test_hook_adaptation.py           # ClaudeRuntime hook adaptation + delta detection
│   │   ├── test_profile_hooks.py             # Profile session-start hook resolution and execution
│   │   ├── test_protocol.py                  # Structural Protocol satisfaction for AgentSession
│   │   ├── test_providers.py                 # ProviderSpec parsing, install_hint, strategy dispatch, lookup helpers
│   │   ├── test_registry.py                  # Resolver maps workspace `agent` strings to runtime classes
│   │   ├── test_runtime_claude.py            # ClaudeRuntime composition adapter
│   │   ├── test_runtime_langgraph_catalogs.py # Catalog methods - models via Ollama, context-window, defaults
│   │   ├── test_runtime_langgraph_checkpointer.py # Persistent checkpointer - SqliteSaver per session_dir
│   │   ├── test_runtime_langgraph_failures.py # Failure modes - Ollama unreachable, model not pulled, tool error, compaction
│   │   ├── test_runtime_langgraph_hooks.py   # Hook synthesis - on_session_start at connect, compaction start and boundary
│   │   ├── test_runtime_langgraph_interrupt.py # Interrupt / resume routing
│   │   ├── test_runtime_langgraph_lifecycle.py # Lifecycle + event assembly + usage telemetry, against a stub model
│   │   ├── test_runtime_langgraph_providers.py # Universal-provider dispatch
│   │   ├── test_runtime_langgraph_real_graph.py # Driven through a real compiled graph
│   │   ├── test_runtime_langgraph_skeleton.py # Capability matrix, Protocol stubs, factory dispatch
│   │   ├── test_runtime_langgraph_slash_routing.py # `_resolve_slash_skill`/`_tag_slash_command` - LangGraph's take on native slash handling
│   │   ├── test_runtime_langgraph_tool_binding.py # Binds langgraph_tools/ factories into the compiled graph
│   │   ├── test_skills.py                    # Shared skill walker - walk_skills, parse helpers, body extraction, source lookup
│   │   └── test_tasks_service.py             # TaskService - in-memory store + event-replay rebuild
│   ├── containers/
│   │   ├── test_backend.py                   # subprocess abstraction
│   │   ├── test_build.py                     # build argument generation
│   │   ├── test_run.py                       # container CLI argument generation
│   │   └── test_runtime.py                   # facade behavior over backend
│   ├── core/
│   │   ├── test_broadcaster.py               # async pub-sub with replay support
│   │   ├── test_concurrency.py               # sync/async bridging and call collapsing
│   │   ├── test_file_cache.py                # mtime-based file cache
│   │   ├── test_fs.py                        # filesystem utilities
│   │   ├── test_http.py                      # HTTP proxy client
│   │   ├── test_io.py                        # file I/O utilities
│   │   ├── test_log_rendering.py             # ISO timestamp + shape normalization + file-format guard
│   │   ├── test_logging.py                   # rotating file handler in core logging module
│   │   ├── test_polling.py                   # async polling primitives - AsyncPoller and MtimeWatcher
│   │   ├── test_serialization.py             # JSON encoding and deserialization
│   │   ├── test_structures.py                # DataClass mixin and deep merge
│   │   └── test_time.py                      # timestamp generation and parsing
│   ├── extensions/
│   │   └── tickets/
│   │       └── test_parser.py                # board YAML parser
│   ├── session/
│   │   ├── test_context.py                   # session context and path derivation
│   │   ├── test_metadata.py                  # shared session metadata model
│   │   └── test_repository.py                # shared session disk I/O
│   ├── user/
│   │   ├── test_hook.py                      # hook decorator and request/response types
│   │   └── test_statusline.py                # statusline decorator and request type
│   ├── test_cleanup.py                       # stale directory removal
│   ├── test_config.py                        # configuration loading and merging
│   ├── test_config_langgraph_mcp.py          # `[langgraph.mcp.<name>]` blocks -> Config.langgraph_mcp_servers
│   ├── test_constants.py                     # env-overridable accessors
│   ├── test_env.py                           # runtime environment checks
│   ├── test_install.py                       # info formatting (install.format_install_info)
│   ├── test_paths.py                         # workspace discovery and session naming
│   ├── test_temp.py                          # session-scoped /tmp symlink management
│   └── test_workspace.py                     # workspace context and session access
│
├── claudebox_cli/
│   ├── test_containers_targets.py            # ``claudebox containers`` action + target parsing
│   ├── test_dispatch.py                      # Verb-mode parser dispatches each verb to its handler
│   ├── test_doctor.py                        # ``doctor`` environment checks
│   ├── test_help_snapshots.py                # Inline-snapshot --help output for all 12 verbs, stubs included
│   ├── test_logs_targets.py                  # ``claudebox logs`` target + flag parsing
│   ├── test_prune_errors.py                  # prune failure reporting - the runtime's own error must reach the user
│   ├── test_unknown_verb.py                  # Bare, unknown-verb and legacy flag-mode invocations exit 2
│   ├── test_update_flock.py                  # Anchor for SPEC ``cli:update:concurrent-blocked``
│   └── test_workspaces_targets.py            # ``claudebox workspaces`` action + arg parsing
│
├── claudebox_container_api/
│   ├── files/
│   │   ├── test_file_service.py              # orchestrator facade
│   │   └── test_path_resolver.py             # path resolution and file indexing
│   ├── test_handlers_chat.py                 # Chat handlers - stream readiness gating
│   ├── test_logging.py                       # LogBroadcaster file-based replay
│   └── test_session.py                       # Session lifespan - log-routing callback wiring
│
├── claudebox_daemon/
│   ├── domain/
│   │   ├── boards/
│   │   │   └── test_service.py               # BoardService
│   │   ├── containers/
│   │   │   ├── test_models.py                # container data models
│   │   │   ├── test_proxy.py                 # ContainerProxyClient timeout/pool bounds
│   │   │   └── test_service.py               # container lifecycle
│   │   ├── sessions/
│   │   │   └── test_service.py               # session lifecycle
│   │   ├── ui_state/
│   │   │   └── test_service.py               # persistent UI state store
│   │   ├── workspaces/
│   │   │   └── test_service.py               # workspace management
│   │   ├── test_broadcaster.py               # daemon event delivery to subscribers
│   │   ├── test_config.py                    # DaemonConfig persistence and workspace management
│   │   ├── test_executors.py                 # per-concern pools and admission tracking
│   │   ├── test_health.py                    # container health monitoring
│   │   ├── test_mutation_observer.py         # session mutation detection
│   │   ├── test_service.py                   # daemon service orchestration
│   │   ├── test_serving.py                   # health must track serving capacity, not just lag
│   │   └── test_watchdog.py                  # event-loop lag detection
│   ├── handlers/
│   │   ├── test_boards.py                    # HTTP adapter responses
│   │   ├── test_daemon.py                    # HTTP adapter responses
│   │   ├── test_workspaces.py                # HTTP adapter responses
│   │   └── test_workspaces_runtime_agnostic.py # Defaults endpoint keys off `agent`: LangGraph its own matrix, unknown agents 422
│   ├── test_containers_lifecycle.py          # service stop/kill/remove + DELETE composite + POST routes
│   ├── test_serving.py                       # port calculation
│   └── test_workspaces_routes.py             # CRUD routes - GET / POST / DELETE /api/workspaces
│
├── distribution/
│   └── test_optional_dependencies.py         # Drift-guards pyproject extras against _providers.PROVIDER_EXTRAS
│
└── lint/
    ├── test_callback_catchall_audit.py       # CallbackCatchAllAudit bans a **kwargs catch-all beside named callbacks
    └── test_sdk_containment.py               # SdkContainmentAudit enforces SDK import prefix bans outside the allowlists
```

**Stack**: pytest, pytest-anyio (async), inline-snapshot (complex assertions), pytest-cov (coverage).

### 7.2 Frontend Tests

- **Unit**: Vitest + React Testing Library (jsdom). Co-located: `Component.test.jsx` alongside `Component.jsx`.
- **E2E**: Playwright (Chromium) at `lib/e2e/app/` (own `package.json` + `playwright.config.js`) with SSE/API mocking via fixtures.
- **Deterministic text rendering**: the app self-hosts its fonts (`@fontsource/*`, imported once in `main.css`) behind `--font-sans`/`--font-mono` in `App.css`, so no component requests a generic family (`monospace`, `system-ui`) an OS could resolve differently. `waitForAppReady` (`e2e/app/helpers.js`) awaits `document.fonts.ready` before any screenshot.
- **SPEC coverage**: Claims in SPEC.md tracked via `just test-e2e-cov` — runs `lib/scripts/spec-coverage.js` against both `e2e/app/tests/*.spec.js` (`// SPEC:` markers) and `e2e/cli/test_*.py` (`# SPEC:` markers).

### 7.3 Task Runner

All dev tasks (lint, test, fix, build) managed via [justfile](../justfile). Run `just --list` from `lib/` for available commands. See [GUIDELINES.md](GUIDELINES.md) §0 for full command reference.
