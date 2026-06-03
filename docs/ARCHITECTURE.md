# Claudebox Architecture

> **Purpose**: Implementation details, internal architecture, and technical decisions. For user-facing behavior, see [SPEC.md](SPEC.md) (product specification). For coding conventions, see [GUIDELINES.md](GUIDELINES.md).

---

## 0. Workspace Layout

`lib/` is the build root — recipes (`justfile`), JS lint configs (`biome.json`, `.jscpd.json`, `knip.json`), Python project (`pyproject.toml`), and shared tooling (`scripts/`) all live here. Source packages, tests, e2e suites, and tooling sit as siblings underneath.

```
lib/
├── src/                          # Python packages + claudebox_frontend (React)
├── tests/                        # Python unit tests — see §7.1
├── e2e/
│   ├── app/                      # Frontend E2E (Playwright) — own package.json + playwright.config.js
│   └── cli/                      # CLI E2E (pytest) — invokes claudebox binary as subprocess
├── scripts/                      # Cross-tree tooling
│   ├── frontend-guidelines-audit.js  # Frontend convention checks (non-fatal)
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
cli.py                    # CLI epilog and installation metadata utilities
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
├── config.py             # AgentSessionConfig base + ClaudeAgentSessionConfig subclass + RuntimeCapabilities (15-flag matrix)
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

The agent runtime is reached through the `AgentSession` Protocol owned by `claudebox/agent_session/`. The Protocol declares everything claudebox-core needs from any backend runtime — connection lifecycle, query input, control plane (model / permission / effort), MCP delegation, telemetry, event stream, runtime identity, capabilities, and metadata catalogs. No code outside `claudebox/agent_session/runtime_claude.py` may import `claude_agent_sdk`; ruff enforces the rule (see GUIDELINES §SDK Containment).

`ClaudeRuntime` is the only adapter today. It **composes** (does not inherit) `BaseClaudeSDKClient` as a private `_sdk` attribute and translates between the SDK's native message/hook surface and claudebox-native types. Future runtimes implement the same Protocol and declare their own `RuntimeCapabilities`.

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
| Capabilities | `capabilities -> RuntimeCapabilities` | 15-flag boolean matrix (see below). |

**`RuntimeCapabilities`** is a frozen dataclass declaring which optional features a runtime supports. **15 booleans, all required, no defaults** — every adapter is forced to be explicit. Claudebox-core reads the matrix at connect time to decide whether to expose related controls in the frontend; `ClaudeRuntime` returns all `True`. Runtimes that return `False` for an operation tell consumers to hide the affected control. The runtime display name lives on a **sibling field** of the session-info envelope, not on `RuntimeCapabilities` itself, which stays purely boolean.

**`AgentEvent`** is the claudebox-native event yielded by `receive_events()`. Each event carries a `kind` discriminator ("system", "user", "assistant", "result") and a `payload` dict projected by `ClaudeRuntime._translate_sdk_message()` from the SDK message. Downstream of `AgentSession`, no SDK type reaches `EventPipeline`, `conversion`, or any subscriber. A future slice may tighten `payload` to a per-kind frozen-dataclass tagged union; consumers today read it as a typed dict.

**`HookCallbacks`** is a dataclass of optional lifecycle callbacks passed in via `AgentSessionConfig.hooks`. Five slots — `on_session_start`, `on_pre_compact`, `on_permission_mode_changed`, `on_model_changed`, `on_effort_level_changed`. State-change callbacks fire from setter calls AND from SDK-detected drift (the PostToolUse-as-permission-mode-detector path is an internal implementation detail; consumers see only the canonical signal). Delta detection lives in `ClaudeRuntime._fire_*_changed` helpers: a callback fires iff a baseline was established AND the new value differs.

**`AgentSessionConfig`** is the base config dataclass with universal fields (`runtime`, `model`, `permission_mode`, `effort_level`, `session_dir`, `hooks`, etc.). Per-runtime subclasses carry runtime-specific fields: `ClaudeAgentSessionConfig(AgentSessionConfig)` holds SDK-passthrough fields (`sdk_passthrough`, `setting_sources`, `max_buffer_size`, `system_prompt`, `debug_mode`). Future runtimes add their own subclasses.

**Invariants:**

1. `claude_agent_sdk` is imported only from `claudebox/agent_session/runtime_claude.py`. Ruff fails `just check` on any other importer.
2. `AgentSession.receive_events()` yields `AgentEvent` only; SDK message types stay inside `ClaudeRuntime._translate_sdk_message()`.
3. Hook callbacks receive claudebox-typed payloads — never raw `HookInput` / `HookContext`.
4. `RuntimeCapabilities` is a frozen 15-boolean dataclass with no defaults. Runtime metadata (display name, version) lives on sibling fields of the session-info envelope, not on the capability dataclass.

**ClaudeRuntime-specific notes** (not Protocol-level invariants):

- `~/.claude/settings.json` writes (the effort-level side-channel) happen inside `ClaudeRuntime._write_effort_to_settings()`. The per-session symlink trick (`_isolate_settings_file()`) runs during `ClaudeRuntime.connect()` — see §1.4.1. Other runtimes have no `~/.claude/` to isolate.
- Pre-connect query buffering lives inside ClaudeRuntime. `ready: asyncio.Event` exposes the connect-state to consumers; `_flush_on_ready` drains the buffer + pending control-plane calls after `connect()` returns.
- Delta-detection state (`_last_known_model`, `_last_known_permission_mode`, `_last_known_effort_level`) lives on ClaudeRuntime; setter calls and the PostToolUse adapter both feed `_fire_*_changed` so a single filter governs both paths.

**Adding a runtime** — implement `AgentSession` at `claudebox/agent_session/runtime_<name>.py`, declare an `AgentSessionConfig` subclass, return a `RuntimeCapabilities` instance with the actual support matrix, translate the native event stream into `AgentEvent`, and route the native hook system through `HookCallbacks`. No other claudebox module changes — the Protocol is the entire contract.

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
| **Result-only turn** | Result-kind AgentEvent without a preceding assistant AgentEvent in the same response cycle (e.g., unknown slash command). Pipeline injects synthetic events to make it visible. |
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

SDK-message-to-AgentEvent projection happens inside `ClaudeRuntime._translate_sdk_message` (§1.4) before the stream reaches the pipeline — no module in `claudebox/agent_session/orchestration/` imports `claude_agent_sdk` (enforced by ruff per GUIDELINES §SDK Containment).

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
  + attachments
```

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

**session.json** — derived projection. Recomputable from events. Contains: `session_id`, `session_dir`, `workspace`, `started_at`, `updated_at`, `name`, `model`, `num_turns`, `permission_mode`, `effort_level`, `todos`, `total_cost_usd`, `total_duration_ms`, `last_context_tokens`, `context_window`, `first_message`, `last_message`, `commands`, `session_prompt`, `parent_session_id`.

#### Capability-Aware Frontend Wiring

The frontend consumes the runtime capability surface (§1.4) to gate UI affordances that depend on optional features. The wiring is intentionally narrow:

- **Source of truth** — the session-info envelope (`GET /api/sessions/current`) and the workspace session-defaults endpoint (`GET /api/workspaces/{id}/session-defaults`) both carry `capabilities` (the 15-flag matrix) and `runtime_name` as sibling fields. The SSE init event payload also carries them on session-start.
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
| `doctor` | `cmd_doctor` | 9 ordered environment checks; aggregate exit 1 on any failure |
| `version` | `cmd_version` | Package version + branch/commit/install path/python/podman |

| Noun-group | Implementation | Sub-actions |
|---|---|---|
| `daemon` | `cmd_daemon` | `start` / `stop` / `restart` / `status` — systemctl `--user` wrappers |
| `containers` | `cmd_containers` | `list` / `stop {<id>\|all}` / `kill {<id>\|all}` — CLI-side prefix resolution; `all` via `asyncio.gather` |
| `workspaces` | `cmd_workspaces` | `list` / `register [<path>]` / `deregister <id>` — POST/DELETE on top-level `/api/workspaces` |

Workspace registration is explicit via `claudebox workspaces register`. Sessions in unregistered cwds fall back to cwd-as-workspace silently and skip writing a `.workspace` marker.

### 2.1 Config Hierarchy

TOML walk-up: `Config.load()` (in `claudebox.config`) searches from cwd upward for `.claudebox/settings.toml` files, deep-merges them (nearest wins). When `workspace_path` is provided, uses it directly without walking up. Config dataclass holds: `work_dir`, `config_dir`, `profile`, `agent`, `backend`, `mounts`, `ports`, `network_mode`, `env`.

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

`podman run --rm -it` with volumes + env → container runs interactively, exits on agent exit.

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

Three installation layers in `lib/container/build/Containerfile`:

| Layer | Script | Content | Rebuild frequency |
|-------|--------|---------|-------------------|
| Base | `install_base.sh` | System packages, mise, Python 3.13, Node 24, uv, Rust, just, gh | Rare |
| Profile | `install_profile.sh` | Overridden by `{profile}/hooks/image-build.sh` — dev tools, linters, runtimes | On profile change |
| Agent | `install_agent.sh` | Claude Code CLI (via mise) + Python dependencies (`uv sync` into `/opt/claudebox/.venv`) | On `--update` |

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

`Session` is imported from `claudebox.agent_session.orchestration.session`. All handlers access `session_lifespan.current` via the `get_session()` dependency injected through `SessionDep` in `handlers/_shared.py`. FastAPI lifespan manages the singleton across container startup / shutdown.

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
│   ├── chat/         # ChatPanel, ChatController
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
├── hooks/            # Cross-feature hooks (useBookmarks, useDaemonStream, useDropdown, useIsMobile, useLocalStorage, useNewSession, usePathResolution, useSSE)
├── managers/         # Coordination logic classes — see §5.5
├── utils/            # Cross-feature pure functions (event processing, predicates, formatters, parsers, language detection, diff, xml block folding, scroll, color, comparators, collections, attachment helpers, layout persistence, mermaid loader, path candidates, bookmark IDs, categorization, navigation, flash status)
├── main.jsx          # React entry point
└── main.css          # Cascade orchestrator (imports all feature index.css in order)
```

### 5.2 SSE Connection

`SSEConnectionManager` manages the `EventSource` to the container SSE endpoint (routed via daemon as `/api/workspaces/{wsId}/containers/{cId}/api/stream`):

1. Connect → dispatch `connecting`
2. `onopen` → dispatch `connected`
3. `onmessage` → parse JSON, handle replay boundaries, accumulate in `pendingBatch`
4. `onerror` → close, auto-reconnect with exponential backoff (1s–10s)
5. `close()` → permanent shutdown (`_closed` flag prevents reconnect)

**Daemon Reconnect Recovery**: `DaemonReconnectEffect` monitors the daemon SSE connection and triggers automatic session recovery when the daemon restarts. It distinguishes initial connections from reconnections by tracking whether the daemon has been connected before; only non-initial `connected` transitions fire recovery. When triggered, it checks whether the container SSE is still alive — if so, recovery is skipped. Otherwise, it calls the resume endpoint to obtain a fresh container ID and reconnects the container SSE. On failure, a "Session reconnect failed" error is shown to the user.

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
  SSE event → EVENT_RECEIVED (flags + pendingBatch accumulation, no flush)
  replay_ended → flushBatch(state.pendingBatch) once
```

`SyntaxHighlightedCodeBlock` is `React.memo`ed on `(code, language, startingLineNumber, className)` — already-finalized code blocks bail out of re-render on each flush, so re-highlight cost is bounded to the actively-growing block. Provider value identity changes at flush rate (~20×/sec), not at SDK event rate, leaving the main thread enough headroom for input handlers between flushes.

**Active/historical turn split**: `ChatPanel` renders the last (active) turn directly — it carries the live streaming events and re-renders per flush — while every earlier turn renders through `HistoricalTurnList`, a `React.memo`ed component whose props stay referentially stable between lifecycle transitions (completed turn objects keep their identity across flushes; `appendTurns` only clones the active turn). During a streaming turn the memo bails, so the historical subtree — the bulk of a long session — is not reconciled per flush; only the single active turn pays the streaming cost, regardless of how many completed turns precede it. The active→historical hand-off is the slice boundary moving as `turns` grows; turn keys (`turn_id`) are preserved, so the completing turn does not remount. This is the per-event axis; it composes with the per-turn-count `content-visibility` skipping below.

Container listing is workspace-scoped end-to-end: the daemon exposes `GET /api/workspaces/{workspace_id}/containers` — CLI consumers (`status`, `containers`, `logs`) aggregate via N per-workspace concurrent `httpx.AsyncClient` requests, and the frontend's `useContainerList` calls `listContainers()` (workspace-prefixed) so the Containers panel automatically refreshes when the workspace switcher fires. `ResumeControl` lives at top-level `components/` as a cross-feature shared Play+chevron split-button consumed by `ContainerRow`.

`flushBatch` runs two derived-state pipelines per batch: `appendTodoDiffs` (TodoWrite) and `appendTaskDiffs` (TaskCreate / TaskUpdate). The two tool families are mutually exclusive at the SDK init level, so at most one produces non-empty output per session, but both run unconditionally and feed the same `todoDiffs` + `todosBySubagent` stores. `appendTaskDiffs` binds the numeric `taskId` returned by `TaskCreate`'s tool_use_result back to a subagent + list-position so subsequent `TaskUpdate` events can mutate the running list; the per-call diff classifies transitions into `added` (TaskCreate), `started` / `completed` (TaskUpdate's `status` field), or `added` (pure `addBlockedBy` update). On `_applyTaskResult`, the `_taskId` is back-patched directly onto the bound item (a single mutation propagates through both `todosBySubagent[subagentKey][index]` and the `todoDiffs.get(creatingToolUseId).added[0]` reference — both pointers share one item object) so the in-chat grouped renderer can dedup by identity (one row per `_taskId` within a run).

The in-chat grouped renderer (`TodosGroup`) derives the "blocked" flag at render time by resolving each item's `blockedBy` taskIds against the same merged-run set (frozen-snapshot semantics: cross-run blocker references are treated as resolved, keeping the group self-contained). The panel (`TodosPanel`) does the same resolution against the live cumulative `todosBySubagent` partition. No new store mutation — both consumers operate on the read side of the existing state.

The run-detector (`groupBlocks` in `TurnBlockList`) only emits a grouped-Todos segment when the run contains at least one `TaskCreate` or `TaskUpdate`; runs composed entirely of `TaskList` / `TaskGet` (inspection-only) are demoted to individual `single` segments so the per-block ToolBlock dispatch renders each inspection's payload. The grouped renderer wraps its rows in the shared ToolBlock chrome (`ToolBlockHeader` + `.tool-expanded-content`), so its expand / collapse affordance matches every other tool block; the row body is a CSS grid with three columns (state icon · title · description) and each row uses `display: contents` so its cells participate directly in the parent grid — columns align across rows.

### 5.5 Key Patterns

**Uncontrolled textarea**: `ChatInput` uses `ref.current.value` instead of controlled state — avoids re-render on every keystroke.

**Ref-based scroll state**: `chatScrollPositionRef` and `chatAutoScrollEnabledRef` persist scroll position across tab switches without triggering re-renders.

**Manager classes**: plain JS classes in `managers/` (SSE, side panels, session/board tabs, message queue, path resolution) and `features/chat/ChatController` encapsulate business logic outside React's render cycle, connected via custom hooks. They hold mutable state, expose imperative methods, and avoid re-renders on internal updates.

**ChatController scroll model**: user-intent detection is input-source driven — passive `wheel` / `touchstart` / `touchmove` / `keydown` listeners attached to `.chat-messages` (which carries `tabIndex={-1}` to receive keyboard events) call `markUserIntent()`, which latches `userIntentActive=true` and disables auto-scroll. Auto-scroll re-engages only when the user manually scrolls back within `AUTOSCROLL_THRESHOLD` of the bottom — handled in the React `onScroll` callback (`handleUserScroll`), which also persists the latest scroll position. Auto-scroll DOM writes are coalesced through a single `requestAnimationFrame` (`_requestScroll`) so a burst of `onEventsChange` / `onPendingMessagesChange` / `onQueueChange` / `ResizeObserver` callbacks in the same tick produce exactly one `scrollTop` write. Programmatic scrolls (initiated by `useMessageJump`'s `scrollToEdge`, by `scrollToBottom`, or by the resize observer) bracket their writes with `markProgrammaticScroll()` so the `onScroll` handler treats them as not-user-intent.

**Re-engagement invariant**: At-bottom, only inputs that can actually move the view away from bottom count as intent. The wheel listener filters downward wheel (`deltaY > 0`) at-bottom; the keydown listener filters scroll-down keys (PageDown / End / ArrowDown / unshifted Space) at-bottom. Upward wheel and scroll-up keys at-bottom remain intent (the view will move). Touch keeps unconditional intent semantics — direction is unknowable at `touchstart`. Without per-listener gating, every wheel tick within the at-bottom zone races `markUserIntent` (disable) against `handleUserScroll` re-engagement (re-enable), producing a per-tick indicator flicker. The gates keep re-engagement monotonic when the user scrolls back toward bottom: exactly one `false → true` transition when the view enters the at-bottom zone, and no further transitions during the rest of the sweep.

**Fire-and-forget persistence**: Layout changes, stash updates, UI state use `fetch().catch(() => {})` — best-effort, never blocks UI.

**Off-screen turn skipping**: `.turn-container` uses CSS `content-visibility: auto` with a `contain-intrinsic-size` placeholder (`0 400px`, tuned to median observed turn height) so the browser skips layout/paint for turns outside the viewport. Turns stay in the DOM, so browser find, selection across the boundary, and Print/Save-as-PDF all behave as if turns were eagerly rendered. No JS bridge required; older browsers without the property fall back to the prior render-everything behavior.

**Minimap cache seeding + idle warmup**: under `content-visibility: auto`, an off-screen turn's `offsetHeight` returns the 400px intrinsic placeholder, not its real layout height — caching that value would lock the minimap into uniform subbars for every never-visited turn. `useTurnHeights` seeds the cache for off-screen first observations with `predictTurnHeight(turn, effectiveWidth)` — a content-derived estimate scaled to chat column width (text wrap, tool/thinking blocks, attachment rows). After mount, an idle-time warmup walks predicted turn chunks in `requestIdleCallback` slices, applies a `.force-measure` opt-out (`content-visibility: visible`), reads `offsetHeight` synchronously, removes the class — replacing predictions with real measurements within a few seconds without paint cost. Warmup defers while `isStreamingRef.current` is true. Predictor coefficients live in `config/dimensions.js`; `e2e/app/tests/predictor-calibration.spec.js` asserts per-fixture drift stays under 30% across three viewport widths.

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

**Panel registry**: `config/layout.js` is the central panel configuration — maps panel IDs → components, defines side assignments (left/right/bottom), and canonical ordering per side. Bottom-slot panels are intentionally absent from `PANEL_SIDES` for dockview routing — they route through `BottomPanelsContext`, not `SidePanelManager`. The bottom-side membership is published dynamically by `<IconStrip>` mount: each strip with `bottomPanels=[...]` calls `registerBottomPanel(id, position)` on mount and `unregisterBottomPanel(id)` on unmount, so `useBottomPanels().panelSideMap` always reflects the current registration.

**Bottom-panel container state**: `BottomPanelsContext` owns `{openSet: Set<panelId>, height: number, panelSideMap: Map<panelId, 'left'|'right'>}`, hydrated from `session.bottomPanels = {openSet: string[], height: number}` on session attach and persisted via debounced PATCH on user-initiated toggle/resize. `BottomPanelContainer` renders a fixed-position bar (`position: fixed; bottom: 24px`) above the footer; one open panel fills it full-width, two split 50/50 horizontally (left slot first, right slot second). One shared drag handle resizes the whole strip via `--logs-strip-h`. While dockview maximizes a group, the whole strip collapses to 0 regardless of `openSet` (global maximize semantics — no per-slot maximize).

**Routing**: `DesktopLayoutBody.handleTogglePanel` consults `useBottomPanels().isBottomPanelId(id)` — bottom-slot IDs route through `togglePanel(id)`, everything else stays on dockview's `onTogglePanel`. The dockview `augmentedActivePanels` adds the open bottom-slot IDs so their icons highlight as active alongside dockview panels.

Panel state (widths, heights, visibility, ordering) persisted to `/api/ui-state` with 500ms debounce.

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
| `Markdown` | `components/` | Canonical markdown renderer — GFM, math, mermaid, syntax-highlighted code, path highlighting; degrades gracefully outside `SessionDataContext` |
| `MarkdownPreview` | `features/chat/components/` | Wraps `Markdown` with toggle to raw source; mirrors MermaidDiagram pattern |
| `SyntaxHighlightedCodeBlock` | `features/chat/.../tool-content-renderer/components/code-block/` | Syntax highlighting with table-row layout; language auto-detected via `utils/languageDetection.js` |
| `ToolCodeBlock` | `features/chat/.../tool-content-renderer/components/code-block/` | Parses tool-specific formats → `CodeBlock` |
| `CodeBlock` | `features/chat/.../tool-content-renderer/components/code-block/` | Low-level table renderer with sticky gutter |

**Gutter inference**: CodeBlock infers gutter structure from line data — file column if any line has `file`, lineNum column if any line has `lineNum`, no gutter otherwise (Edit diffs).

### 5.9 Event Processing Pipeline

SSE events flow through batching, turn grouping, and visibility filtering before reaching UI components.

**SSE lifecycle**:

```
EventSource('/api/stream')
├─ onopen → SET_CONNECTION_STATUS 'connected'
├─ onmessage → parse JSON
│  ├─ replay_started → REPLAY_STARTED with flushSync() (early return)
│  ├─ replay_ended → REPLAY_ENDED, flush entire batch (early return)
│  └─ other → EVENT_RECEIVED
│     ├─ Accumulate in pendingBatch
│     ├─ Arm 50ms timeout if not replaying
│     └─ Update isResponding (assistant=true, result=false)
├─ onerror → SET_CONNECTION_STATUS 'error'
└─ Reconnect after 2000ms
```

**Batching modes**:

| Mode | Trigger | Behavior |
|------|---------|----------|
| Live streaming | 50ms timeout | Flush pendingBatch every 50ms |
| Replay | `replay_ended` event | Accumulate all, flush once (`flushSync()` used at `replay_started` for immediate UI feedback, not at flush) |

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

**Interactive tools**: AskUserQuestion and ExitPlanMode render forms via InteractiveQuestions. Form submit sets `wasAnsweredLocally`, collapses block, sends answer to the container API.

**Per-tool formatters**: `utils/toolResultFormatters.js` exposes `buildToolHeader`, `getToolStatus`, `getToolTooltip`, `hasSpecializedFormatter`, and `shouldCollapseByDefault`. Tool routing for the *expanded* content area lives in `ToolContentRenderer` and consults `getToolConfig(toolName).renderer` from `config/toolRegistry.js` (`syntax-or-code`, `code`, `markdown`).

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

**Layout persistence**: Debounced 500ms save to `/api/ui-state` on `onDidLayoutChange`.

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
| Path resolution | `managers/PathResolutionManager.js` | Resolves and highlights file paths in tool output; caches resolved paths for click-to-open |
| Session tabs | `managers/SessionTabManager.js` | Manages dynamic session tabs in the center panel; workspace-scoped storage (`claudebox:sessionTabs:{workspaceId}`); handles creation, naming, and cleanup via Dockview API |
| Conversation fork | `features/chat/` + daemon `/sessions/{id}/fork` | Branch a session at a specific turn into a child session, optionally reusing the live container (web UI only — leverages the daemon's fork API; rewind itself is the upstream Claude Code CLI's built-in `/rewind` command) |
| Desktop notifications | `features/chat/hooks/` + `utils/` | Browser Notification API integration; triggers on response completion when tab is not focused; plays chime sound |
| Dynamic favicon | `features/chat/hooks/` | Updates favicon to reflect assistant state (responding, idle, error) |
| Session prompt editor | `features/sessions/` | Inline editor for per-session system prompt; persisted via container API |
| Model/permission switching | `features/chat/` | Dropdown selectors for model and permission mode; changes dispatched as setting change events rendered as dividers in chat |
| Attachment handling | `features/chat/` | File attachment via drag-and-drop or button; reads files as base64; previews before send |
| Markdown preview | `features/chat/components/` | Renders markdown content in tool blocks with toggle to raw source; mirrors MermaidDiagram pattern |
| Mermaid rendering | `features/chat/` | Renders Mermaid diagram syntax in assistant messages as inline SVGs |
| Minimap | `features/chat/components/minimap/` | Conversation overview sidebar; proportional sub-bars per turn, click/drag navigation, auto-show/hide with pin toggle. Reads cached per-turn heights from `useTurnHeights` so it is unaffected by content-visibility-driven measurement fluctuations as off-screen turns toggle between intrinsic and real heights |
| Setting change dividers | `features/chat/` | Visual dividers in chat when model or permission mode changes mid-conversation |
| Slash command autocomplete | `features/chat/` | Autocomplete dropdown for `/` commands in chat input; populated from container API command list |

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

**DaemonService** owns the daemon-wide singletons listed above. Lazy-loads WorkspaceService instances from `~/.claudebox/daemon.json`.

**WorkspaceService** provides isolated per-workspace state. Holds ContainerService, SessionService, UIStateService, and BoardService. When the workspace directory is unavailable, the *sub-services* are set to None on the (still non-None) WorkspaceService.

**ContainerService** manages podman lifecycle for containers. Broadcasts `STOPPING` status before initiating stop, then `STOPPED` after completion — two-phase broadcast enables frontend stopping state feedback.

**SessionService** orchestrates session lifecycle: listing from disk via `SessionRepository`, spawning containers for new/resumed sessions, forking sessions at turn boundaries. `create()`, `resume()`, and `fork()` all return a unified `SessionInfo` shape (extends `SessionMetadata` with `container_id`, `workspace`, `permission_mode`, `effort_level`) so the frontend can populate the footer from the response without waiting for the SDK init event. `fork(reuse_container=True)` transfers ownership of the live container to the new (child) session by calling `ContainerService.update(container, session_id=new_session_id)` after seeding the child's `session.json` (with `parent_session_id` linking back); `find_by_session()` then resolves the running container under the child id, so the parent's running indicator clears in the sessions panel and stop affects only the child. `parent_session_id` on the child remains the back-link from child to parent across the fork tree.

**Fork seed — dump-and-override.** The child's `session.json` is built by reading the parent's `session.json` directly (via `read_json` of the source's path; `_copy_claudebox_session` deliberately excludes the file from the copytree) and then overriding only the fork-specific identity fields: `session_id`, `parent_session_id`, `session_dir`, `workspace`, `started_at`, `updated_at`. Every other parent field — `name`, `model`, `permission_mode`, `effort_level`, `session_prompt`, plus accumulated display state — is inherited verbatim. This bypasses the `SessionInfo`/`SessionMetadata` shape limitation (those models do not expose `permission_mode`/`effort_level`/`session_prompt`) by going straight to disk. Missing or unparseable parent metadata falls back to a minimal seed (identity fields only).

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
    ├── models.py         # BoardUpdateEvent, BoardSessionStatusEvent — daemon-emitted SSE events.
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
| `/api/daemon/health` | GET | Daemon liveness probe — returns `{mode, status}` |
| `/api/daemon/stream` | GET (SSE) | Daemon-level event stream |

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
| `/session-defaults` | GET | Workspace path + model / permission / effort defaults a new session would inherit, plus the `available_models` / `available_permission_modes` / `available_effort_levels` choice lists. Sourced from `claudebox.claude.definitions` constants today; future workspace overrides slot in here without changing the response shape. Sole source of these lists in the frontend — consumed by `useSessionDefaults` (footer welcome-screen values) and `SessionDataProvider` (picker dropdown contents). |
| `/commands` | GET | Workspace's filesystem-discovered slash commands and skills, payload `{custom, mcp, builtin}` matching the in-session `commands` field shape. `mcp` and `builtin` are always empty for the welcome catalog (the daemon has no visibility into running MCP servers or SDK-emitted built-ins). Funnels through the same `claudebox.claude.parser.load_slash_commands` parser as the in-container session catalog, so naming and metadata stay consistent. Consumed by `useWorkspaceCommandCatalog` and falls into `SessionDataContext.commands` whenever `sessionData?.commands` is null (welcome screen). |

Board change events are broadcast on the daemon-level `/api/daemon/stream` (as `BoardUpdateEvent` / `BoardSessionStatusEvent`) — there is no per-board SSE endpoint.

#### Welcome → session config buffer drain

Frontend pickers (model / permission mode / effort level) live in the footer and are visible on the welcome screen, before any session attaches. Today picker setters call container-proxied endpoints that require an active container; on welcome they would silently fail. Instead `SessionDataProvider` checks `getContainerId()`: when no container is active the value is buffered in `deferredModel` / `deferredPermissionMode` / `deferredEffortLevel`. Latest-wins — repeated picker changes overwrite the buffered value before drain. When `sessionData?.session_id` transitions from null to set (session attached), a single drain effect awaits the buffered config in strict order: model → permission → effort. Each await ensures the SDK applied the change before the next call. A failed call surfaces via `onError` and the remaining successful changes still apply. The deferred message in `useChatController` keys off the same session_id transition, so the first message is sent only after the config drain completes.

### 6.4 Serving

Two modes selected by `is_dev_mode()`. The user-facing port (`DAEMON_PORT` in production, `DAEMON_DEV_PORT` in development) shifts via `_resolve_port()`; the backend uvicorn always listens one port above the user-facing port.

| Mode | User-facing | Backend (uvicorn) | Notes |
|------|-------------|-------------------|-------|
| Development | `DAEMON_DEV_PORT` (Vite) | `DAEMON_DEV_PORT + 1` | Hot reload; HTTP only |
| Production | `DAEMON_PORT` (Caddy) | `DAEMON_PORT + 1` | Caddy handles H2/TLS via `tls internal`, proxies to uvicorn; Caddyfile written to temp dir |

Startup: banner logged via Rich; Caddy/uvicorn output is captured by the structlog-routed logging stack and lands in the daemon log file (`use_rotating_log_file` in `app.py`).

### 6.5 SSE Broadcasting

`DaemonService.events` (Broadcaster) pushes events to all connected `/api/daemon/stream` subscribers. `SessionProgressEvent` broadcasts progress during session lifecycle (spawning, health checks, ready). `SessionsChangedEvent` signals that the sessions list changed (after create, resume, fork, update) — the frontend uses this to refetch immediately instead of polling.

### 6.6 Systemd Deployment

The daemon runs as a user-level systemd service (`claudebox-daemon.service`, in `lib/etc/systemd/`). Critical configuration:

```ini
[Service]
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

**Maintenance timer** — `claudebox-maintenance.service` (oneshot) re-runs `lib/bin/install.sh` to refresh the local installation: it pulls the latest library, rebuilds the container image with `--update`, cleans stale session/temp directories, and prunes dangling images. `claudebox-maintenance.timer` schedules this `OnCalendar=daily` with `RandomizedDelaySec=1h` and `Persistent=true` so missed runs catch up after the host wakes from sleep.

---

## 7. Testing

### 7.1 Python Tests

Two pytest trees from `lib/` root: `tests/` for unit tests (mirrors source package layout) and `e2e/cli/` for CLI E2E tests (invokes the `claudebox` binary as a subprocess via `run_claudebox` fixture in `conftest.py`). Both registered as `testpaths` in `pyproject.toml`.

```
tests/
├── conftest.py                              # anyio_backend (asyncio), tmp_workspace fixture
│
├── claudebox/                               # Core framework
│   ├── test_cleanup.py                      # Stale directory cleanup
│   ├── test_config.py                       # Config discovery, loading, hierarchical merge
│   ├── test_env.py                          # Dev mode detection
│   ├── test_paths.py                        # Workspace/session path discovery and naming
│   ├── test_workspace.py                    # Workspace init, ignore patterns
│   ├── claude/
│   │   ├── test_client.py                   # ClaudeSDKClient
│   │   └── test_parser.py                   # Slash command and skill frontmatter parser
│   ├── containers/
│   │   ├── test_backend.py                  # ContainerBackend CLI abstraction
│   │   ├── test_build.py                    # Image build pipeline
│   │   └── test_run.py                      # Container run orchestration
│   ├── core/
│   │   ├── test_broadcaster.py              # Pub-sub broadcaster
│   │   ├── test_concurrency.py              # Async/sync bridging
│   │   ├── test_file_cache.py               # Mtime-based file cache
│   │   ├── test_fs.py                       # walk_up, touch_dir/file, resolve/remove_path
│   │   ├── test_http.py                     # HTTP utilities
│   │   ├── test_io.py                       # File I/O operations
│   │   ├── test_logging.py                  # Logging configuration, log file rotation
│   │   ├── test_polling.py                  # AsyncPoller, MtimeWatcher
│   │   ├── test_serialization.py            # JSONEncoder, deserialize, dumps/loads roundtrip
│   │   ├── test_structures.py               # DataClass mixin, deep merge, invert
│   │   └── test_time.py                     # Timestamp generation and parsing
│   ├── extensions/
│   │   └── tickets/
│   │       └── test_parser.py               # YAML board parsing, ticket moves, swimlane and state CRUD
│   ├── session/
│   │   ├── test_context.py                  # Session context lifecycle
│   │   ├── test_metadata.py                 # SessionMetadata model
│   │   └── test_repository.py               # SessionRepository disk I/O
│   └── user/
│       ├── test_hook.py                     # @hook decorator
│       └── test_statusline.py               # @statusline decorator
│
├── claudebox_container_api/                 # Container API
│   ├── test_logging.py                      # Container API logging stack
│   ├── files/
│   │   ├── test_file_service.py             # FileService.resolve_paths
│   │   └── test_path_resolver.py            # PathResolver
│   └── session/
│       ├── _helpers.py                      # Test utilities
│       ├── test_async_monitor.py            # Async task monitoring
│       ├── test_async_tasks.py              # Async task management
│       ├── test_attachments.py              # Attachment service
│       ├── test_conversion.py               # Message-to-event conversion pipeline
│       ├── test_models.py                   # Event, PublishedEvent, SessionSummary
│       ├── test_persistence.py              # EventLog append/read
│       ├── test_pipeline.py                 # Event pipeline orchestration
│       ├── test_pipeline_init.py            # Pipeline initialization
│       ├── test_pipeline_inject.py          # Pipeline event injection
│       ├── test_projection.py               # Session summary projection
│       ├── test_session.py                  # Session facade
│       ├── test_session_internals.py        # Session internal methods
│       ├── test_session_lifecycle.py        # Session start/stop/restart
│       ├── test_tool_output.py              # Tool output reading
│       └── test_turn_tracker.py             # Turn ID state machine
│
└── claudebox_daemon/                        # Daemon
    ├── test_serving.py                      # Dev/production serving modes
    ├── domain/
    │   ├── test_config.py                   # DaemonConfig workspace CRUD, persistence
    │   ├── test_health.py                   # Health monitoring
    │   ├── test_mutation_observer.py        # SessionMutationObserver polling and broadcast
    │   ├── test_service.py                  # DaemonService singleton
    │   ├── boards/
    │   │   └── test_service.py              # BoardService listing/mutation, watcher integration
    │   ├── containers/
    │   │   ├── test_models.py               # Container models
    │   │   └── test_service.py              # ContainerService lifecycle
    │   ├── sessions/
    │   │   └── test_service.py              # SessionService CRUD, fork
    │   ├── ui_state/
    │   │   └── test_service.py              # UIStateService patch operations
    │   └── workspaces/
    │       └── test_service.py              # WorkspaceService orchestration
    └── handlers/
        └── test_sessions.py                 # Session HTTP adapters (CRUD, resume, fork)
```

**Stack**: pytest, pytest-anyio (async), inline-snapshot (complex assertions), pytest-cov (coverage).

### 7.2 Frontend Tests

- **Unit**: Vitest + React Testing Library (jsdom). Co-located: `Component.test.jsx` alongside `Component.jsx`.
- **E2E**: Playwright (Chromium) at `lib/e2e/app/` (own `package.json` + `playwright.config.js`) with SSE/API mocking via fixtures.
- **SPEC coverage**: Claims in SPEC.md tracked via `just test-e2e-cov` — runs `lib/scripts/spec-coverage.js` against both `e2e/app/tests/*.spec.js` (`// SPEC:` markers) and `e2e/cli/test_*.py` (`# SPEC:` markers).

### 7.3 Task Runner

All dev tasks (lint, test, fix, build) managed via [justfile](../justfile). Run `just --list` from `lib/` for available commands. See [GUIDELINES.md](GUIDELINES.md) §0 for full command reference.
