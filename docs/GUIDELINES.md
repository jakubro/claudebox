# Claudebox Guidelines

> **Purpose**: Coding conventions, style rules, and development commands. For architecture, see [ARCHITECTURE.md](ARCHITECTURE.md). For user-facing behavior, see [SPEC.md](SPEC.md) (product specification).

Conventions here reflect patterns **actually in the codebase**. Focus on what agents get wrong — skip what they naturally get right.

**⚠️ Mandatory**: Run lint checks after every code change, before committing. Fix all issues.

**Comments describe current state, not change history.** No "was:", "moved from", "previously", "renamed from", or other temporal references. Git tracks history — code comments explain what exists now and why.

**Bleeding-edge: defensive migrations are debt, not value.** The product is under heavy development; data shapes change faster than migration shims can earn their keep. When a change would orphan persisted state, accept the wipe and document it in the ticket. Don't add `if (typeof entry === 'string') return { name: entry }`-style fallbacks for "older" layouts.

All development commands run from `lib/` via [justfile](../justfile). See §0 for the full reference; `just --list` for grouped view.

```bash
just check       # full pre-commit (lint + test)
just lint        # lint all (python + JS + e2e spec coverage)
just fix         # auto-fix all (python + JS)
just test        # run all tests (python unit + frontend unit + frontend e2e + CLI e2e)
```

---

## 0. Development Commands

### Composite

```bash
just install         # install all dependencies (python + shared JS + frontend + e2e)
just check           # full pre-commit (lint + test)
just lint            # lint all (python + JS + e2e spec coverage)
just fix             # auto-fix all (python + JS)
just outdated        # report current-vs-latest per direct dependency; never fails, not part of check
just test            # run all tests (python unit + frontend unit + frontend e2e + CLI e2e)
just coverage        # all tests with coverage enforcement
just build           # production build (frontend → dist/)
just docs            # write docs/reference/{cli,shortcuts}.md from the CLI parser and the binding registry; golden-tested by check
just site            # build the docs site (Astro/Starlight over docs/); its own job, not part of check
just preview         # serve the docs site with live reload
```

### Python (ruff + ty + pytest)

```bash
just install-py      # uv sync --extra dev (auto-routes to /tmp venv when CLAUDEBOX_AGENT is set)
just test-py         # pytest tests/
just test-py-cov     # pytest tests/ with coverage
```

`just install-py` installs the core dev surface. The Tier 1 Anthropic integration test (`tests/claudebox/agent_session/test_runtime_langgraph_providers.py::TestTier1AnthropicIntegration`) needs the `langchain-anthropic` provider package, behind the `[anthropic]` extra — install it explicitly to run that test locally; without it, the test skips via `pytest.importorskip`:

```bash
UV_PROJECT_ENVIRONMENT='<agent-venv>' VIRTUAL_ENV= uv pip install langchain-anthropic
```

### Shared JS (biome + jscpd + knip)

```bash
just install-shared-js  # npm ci at lib root (biome + jscpd + knip)
```

Linting and auto-fix are whole-repo only: `just lint` runs ruff check + ruff format --check + ty +
python-guidelines-audit + biome + frontend-guidelines-audit + spec-coverage + architecture-drift-check +
knip + jscpd, and `just fix` runs ruff check --fix + ruff format + ty --fix + biome check --fix. There
are no per-language `lint-*` / `fix-*` recipes - reach for a tool directly (`npx biome check <path>`)
when iterating on one file.

`architecture-drift-check.js` checks ARCHITECTURE.md's fenced tree/module-map blocks and HTTP route
tables against the filesystem and the registered routers, both directions - an entry naming a file
that doesn't exist and a real file the doc omits are both failures. Its own fixture tests
(`architecture-drift-check.test.js`, run via `node --test`) run ahead of it in `just lint`.

`tests/lint/test_image_layer_table_drift.py` checks README.md's and ARCHITECTURE.md's image-layer
tables against the Containerfile's real install steps, and the README's rebuild-control prose
against `cmd_build.py`'s `--layer` choices - a fifth install layer or a renamed flag value fails it.

### Frontend (vite + vitest)

```bash
just install-fe         # npm ci in src/claudebox_frontend
just build-fe           # vite build → src/claudebox_frontend/dist/
just test-fe            # vitest run
just test-fe-cov        # vitest run --coverage

# Not in justfile (one-time setup / runtime):
cd lib/src/claudebox_frontend && npm run dev   # dev server (proxies /api to container API)
```

### E2E (playwright + pytest + spec-coverage)

```bash
just install-e2e-app          # npm ci in e2e/app + Playwright browsers (chromium)
just test-e2e-app             # Playwright at lib/e2e/app/
just test-e2e-cli             # pytest at lib/e2e/cli/
just test-e2e-cov             # spec-coverage.js (// SPEC: + # SPEC: tracking)
just update-e2e-app-snapshots # regenerate visual regression snapshots
```

### Shell completion (argcomplete)

Bash tab-completion is wired via [argcomplete](https://github.com/kislyuk/argcomplete): `host_cli.py` carries the `# PYTHON_ARGCOMPLETE_OK` marker and calls `argcomplete.autocomplete(parser)` before argparse parses. Entity completers (workspace ids, container ids) live in `claudebox_cli/_completers.py`, attached to their argparse actions; `install.sh` generates the shell snippet via `register-python-argcomplete claudebox`.

`e2e/cli/test_completion.py` exercises it by driving argcomplete's completion protocol against the CLI subprocess (`_ARGCOMPLETE=1`, `COMP_LINE`, `COMP_POINT`; completions read from fd 8), reusing the hermetic harness (bwrap + fake bins + fake daemon).

### Test UI (in-container harness)

See [TEST-UI.md](TEST-UI.md) for the full reference.

```bash
just test-ui-start           # daemon + Vite dev server (port 41930)
just test-ui-stop            # tear down
just test-ui-browse          # headless Playwright helpers (screenshot, click, eval, ...)
just test-ui-run             # run arbitrary Playwright script against test UI
```

---

## 1. Framework (`claudebox`)

### SDK Containment

External runtime SDK / library imports are restricted to their respective adapter files. Any other source file importing them fails `just check`:

- `claude_agent_sdk` — only in `lib/src/claudebox/agent_session/runtime_claude.py`
- `langchain*` / `langgraph*` (full prefix families) — only in `lib/src/claudebox/agent_session/runtime_langgraph.py` and `lib/src/claudebox/agent_session/langgraph_tools/`

The boundary is enforced two ways:

1. **Structurally** — the `AgentSession` Protocol (ARCHITECTURE.md §1.4) is the only legitimate dependency target for any module needing a runtime. Consumers depend on the Protocol, not on the SDK directly.
2. **Statically** — the `SdkContainmentAudit` class in `lib/scripts/python-guidelines-audit.py` (an AST import walk over `src/` and `tests/`) flags forbidden imports outside their adapter file. Each rule carries the package regex, an allowlist (the adapter file plus the test files that legitimately exercise the SDK→AgentEvent boundary with SDK-typed fixtures), and the containment message. The audit runs as `just lint`.

Prefix-pattern enforcement matters because the LangChain ecosystem ships new provider packages monthly (e.g. `langchain_anthropic`, `langchain_groq`, `langchain_xyz_future_provider`). A regex-bounded match (`^(langchain|langgraph)($|_|\.)`) auto-bans every future package without per-package list maintenance — the previous ruff `banned-api` table required enumerating each one and would have decayed into a treadmill.

When adding a new runtime (`runtime_<name>.py`), add a `_ContainmentRule` to `SdkContainmentAudit.RULES` in `lib/scripts/python-guidelines-audit.py` with the package regex, allowlist, and containment message — same shape as existing rules. No other config changes needed.

A tool family whose *behavior* (not its SDK-typed construction) is shared across runtimes never gets written twice to satisfy this rule: SDK-typed construction (`tool()`/`create_sdk_mcp_server()`, `@tool` decorators) stays inside its adapter file, but the logic it wraps lives in a plain-Python, runtime-neutral module each adapter imports and binds thinly — see `agent_session/_sibling_sessions.py` and its two bindings (`runtime_claude.py`, `langgraph_tools/sibling.py`) for the pattern.

### Runtime Resolution

Daemon-side code that needs a workspace's runtime — capability matrix, catalog defaults, classmethod-callable helpers — resolves through `claudebox.agent_session._registry.resolve_runtime_class(agent)` rather than importing a specific runtime directly. This keeps the workspace's `agent` TOML key authoritative: a LangGraph workspace's daemon endpoints return LangGraph's capability matrix and defaults, not the inverse-of-the-default.

```python
from claudebox.agent_session._registry import UnknownRuntime, resolve_runtime_class

cls = resolve_runtime_class(workspace_config.agent)
defaults = {
    "model": cls.get_default_model() if cls.CAPABILITIES.supports_models else None,
    "available_models": cls.AVAILABLE_MODELS if cls.CAPABILITIES.supports_models else None,
}
```

The resolver lazy-imports each runtime, so a Claude-only deployment never pays the langgraph dep cost (and vice versa). Unknown agent strings raise `UnknownRuntime`; handlers map to HTTP 422.

Adding a new runtime means: (a) implement the adapter file per §SDK Containment, (b) add the `@classmethod` form of `get_default_model / get_default_effort_level / get_default_permission_mode / get_skills` so the resolver-driven daemon path sees a uniform call shape, (c) add class-level `AVAILABLE_MODELS / AVAILABLE_EFFORT_LEVELS / AVAILABLE_PERMISSION_MODES` constants matching the runtime's actual catalog (empty lists are fine when the catalog is dynamic), (d) extend `resolve_runtime_class` with a branch.

### Orchestration Boundary

`claudebox_container_api/` is HTTP plumbing only — FastAPI handlers, the app wiring, the lifespan context manager (`session.py`), and the file service. All session orchestration (lifecycle, event pipeline, conversion, persistence, projection, broadcaster) lives in `claudebox/agent_session/orchestration/` and is part of core, not the container API. Handlers import from `claudebox.agent_session.orchestration`, never the inverse — orchestration code that needs container-API-layer behavior (e.g., the per-session log file attach/detach hooks) carries an explicit, sanctioned back-arrow import documented in the source.

### Capability-Gated UI

Frontend affordances that depend on runtime capabilities MUST gate rendering via `useCapabilities()`. The hook returns `{capabilities, runtimeName}` from `SessionDataContext` with a `useSessionDefaults` fallback for the pre-session welcome screen. During the brief race before either source resolves, `capabilities === null`; consumers default to **show-all** in that window so new sessions never flash an empty UI. Gate inline at the component's first return:

```jsx
const { capabilities } = useCapabilities()
if (capabilities && !capabilities.supports_skills) return null
```

Tests pass synthetic flag overrides via `src/test-utils/mockCapabilities.js`.

### Executor Ownership

Unbounded filesystem or CPU work **never** goes on the default thread-pool executor. Give it a dedicated, bounded one.

- 🚫 **Never** hand work whose cost scales with user data to `asyncio.to_thread(...)` or `run_in_executor(None, ...)` — both mean the process-wide default pool, which is where `EventLog.append` (via aiofiles) and `Projection._async_save` write
- ✅ **Always** own a `ThreadPoolExecutor` on the service doing the work, size it explicitly, and release it on the owning lifespan's teardown
- ✅ **Always** prefer a single worker when the work is a cache rebuild — serializing it is the point, and it pairs with single-flighting so concurrent callers share one run instead of queueing N

```python
# claudebox_container_api/files/file_service.py
self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="path-resolve")
await loop.run_in_executor(self._executor, self._resolver.resolve, candidates, temp_dir)
```

**Worked example.** `PathResolver._build_index` walked the whole workspace on the default pool. On a workspace with hundreds of session directories the walks took every worker, `EventLog.append` never got one, and the session went silent mid-turn — no exception, no log line, `is_alive` still true, the runtime still writing complete replies to its own transcript. Container restarts made it worse, since restart triggers replay and replay triggers path resolution. The only signal was the absence of events; assume any starvation you introduce presents the same way. See ARCHITECTURE.md §1.5 Executor Ownership.

### Conventions

- ✅ **Always** use `claudebox.serialization` for JSON (re-exported from `claudebox/core/serialization.py`) — custom encoder handles datetime, Path, dataclass
- ✅ **Always** use `pathlib.Path` — never raw string path manipulation
- ✅ **Always** accept `str | Path` on public APIs, convert to `Path` internally
- 🚫 **Never** import from `claudebox_cli` or `claudebox_container_api` — framework has zero reverse dependencies

**Extending the hook system**: New hooks follow the `@hook` / `@statusline` decorator pattern. The decorator handles stdin/stdout JSON I/O. `@hook` functions receive `request` and `response` kwargs — mutate the response builder (`.add_to_context()`, `.show()`, `.stop()`). `@statusline` functions receive `request` and return a display string.

---

## 2. CLI (`claudebox_cli`)

### Conventions

- ✅ **Always** use `ContainerRuntime` as the primary interface — it combines `Config`, `ContainerBackend`, and CLI flags
- ✅ **Always** use Rich `console` for user-facing output — not bare `print()`
- 🚫 Never sprinkle async throughout the CLI; default to synchronous code. Use asyncio only where genuinely concurrent work is needed (e.g., multiplexing live streams into one output).

### Per-verb `EPILOG`

Every `cmd_*.py` defines an `EPILOG` with the same shape, so a new verb does not have to be reverse-engineered from an existing one:

```
Examples:
  claudebox logs                    tail daemon log, then follow
  claudebox logs --tail 50          backfill 50 lines, then follow

<Topic>:
  Two-space indented content.

Notes:
  Prose that does not fit a topical heading.
```

- ✅ **Always** lead with `Examples:` — two columns, command left, effect right, hand-aligned
- ✅ **Always** use title-case, colon-terminated section headings and indent their content two spaces
- ✅ **Always** put trailing prose under a heading (`Notes:` when nothing more specific fits) — never a bare paragraph
- ✅ **Always** use single backticks for literal values and paths; double backticks render literally and read as noise
- 🚫 **Never** state an option's default in the epilog — it belongs in that option's `help=`, which is the single source (the formatter no longer appends one)

### Cold path

Shell completion re-executes the program on every keypress, so import-time work is paid per keystroke (ARCHITECTURE.md §2, "CLI cold path").

- ✅ **Always** import through the `claudebox` facade (`from claudebox import console`) — the cross-package audit requires it, and the lazy root makes it cost exactly what the defining submodule costs. Deep imports like `from claudebox.core.cli import console` fail `just lint`
- 🚫 **Never** put import-time side effects in a CLI entry module — no subprocess, no network, no filesystem scan while the parser is being built. Defer to render or call time (`LazyEpilogParser` is the pattern)
- ✅ **Always** import a heavy dependency inside the function that needs it when only some verbs use it — `ContainerRuntime` / `ImageBuildMode` pull structlog and the container backend; add a one-line comment saying why
- ✅ **Always** keep the parser complete. Completion accuracy is non-negotiable: the win comes from making the full parser cheap to build, never from describing fewer verbs or flags
- 🚫 **Never** re-export a name from `claudebox/__init__.py` that is also a submodule name — importing the submodule binds it on the package and shadows the export (see ARCHITECTURE.md §2, "CLI cold path")

**Volume mounts**: New mounts go in `get_volumes()` generator in `claudebox.containers.run`. Each mount is a `(host_path, container_path)` tuple via `prepare_volume()` which resolves and ensures host path exists.

---

## 3. Daemon (`claudebox_daemon`)

### Architecture

Three-layer DDD with strict import boundaries:

| Layer | Location | Responsibility |
|-------|----------|----------------|
| App | `app.py`, `serving.py` | FastAPI factory, server wiring, lifespan composition |
| Handlers | `handlers/` | Thin HTTP adapters — delegate immediately to domain |
| Domain | `domain/` | Business logic in aggregates (`boards/`, `containers/`, `sessions/`, `ui_state/`, `workspaces/`) |

- ✅ **Always** keep handlers thin — delegate via `**body.model_dump()`, zero business logic
- ✅ **Always** import domain types through `domain/__init__.py` facade — never reach into sub-modules
- ✅ **Always** prefix internal handler modules with underscore (`_models.py`, `_shared.py`)
- 🚫 **Never** prefix router files with underscore — that prefix is reserved for shared internals with no public HTTP surface
- 🚫 **Never** put business logic in handlers — validation, orchestration, and state management live in domain

### Executor Ownership

§1's Executor Ownership rule extends to the daemon: one event loop serves every workspace, so one wedged podman call or contended lock stalls all of them.

- ✅ **Always** dispatch podman calls, `FileLock` writes, and synchronous filesystem listing to `DaemonService`'s owned executor — never the default pool
- ✅ **Always** give outbound HTTP calls an explicit bounded timeout — one profile safe for both ordinary requests and proxied SSE streams, not `read=None`
- ✅ **Always** give every `FileLock` an explicit `timeout=` and translate a `filelock.Timeout` into a typed error — never let acquisition block forever
- ✅ **Always** give subprocess dispatch an explicit `timeout=` and log argv + elapsed time before it propagates; exempt only long-running foreground processes the daemon never calls
- 🚫 **Never** assume `AsyncPoller`'s `asyncio.wait_for` backstop makes an unbounded call inside `_poll()` safe — bound the call itself
- 🚫 **Never** read a bound placed around `run_in_executor` as a bound on the work — it starts at submission, so it measures queueing plus execution, and firing it reclaims a worker only while the job is still queued. Record whether the job ever started (`executors.tracked`) so a full pool is never logged as a hung filesystem call
- ✅ **Always** dispatch to the pool that matches the work's concern (`listing` / `podman` / `state`) — a single shared pool makes every class of blocking work fail together
- ✅ **Always** collapse concurrent callers asking one question onto one job (`SingleFlight`) before widening a pool — N tabs refetching on one broadcast is one scan, not N
- ✅ **Always** make a liveness signal observe the resource that actually serves requests, and keep the endpoint reporting it off that resource — a proxy that stays green through an outage is worse than no signal, because it is trusted

### Error Handling

Two-line typed errors with one global exception handler — no per-handler try/except:

```python
class ContainerNotFound(DaemonError):
    status_code = 404
    error_key = "container_not_found"


# App wiring (once): app.add_exception_handler(domain.DaemonError, handle_daemon_error)
# Produces: {"error": "container_not_found", ...context_kwargs}
```

- ✅ **Always** inherit from `DaemonError` — define `status_code` and `error_key` as class attributes
- ✅ **Always** pass context as `**kwargs` to error `__init__` — merged into JSON response body
- 🚫 **Never** catch domain errors in handlers — the global handler converts them

### Dependency Injection

`Annotated` type aliases centralize DI in `handlers/_shared.py`:

```python
DaemonDep = Annotated[DaemonService, Depends(get_daemon)]
WorkspaceDep = Annotated[WorkspaceService, Depends(get_workspace)]


# Handlers use clean signatures:
async def list_containers(svc: WorkspaceDep): ...
```

### Service Lifecycle

Every service class implements `start()`/`stop()` in its `# Service` section with consistent log ceremony: DEBUG `"Starting {name}..."` → work → INFO `"{Name} started"`. Shutdown always reverses startup order. Lifespans compose via `AsyncExitStack`.

### Module-Level Singleton

Domain state via module-level singleton managed by async context manager (`managed()` sets/clears `domain.current`). Getter (`get_daemon()`) raises typed `DaemonNotReady` instead of returning `None` — used directly as FastAPI dependency.

### Class Organization

Section dividers (`# Name` + `# ---...---`) in classes >100 lines, and in handler modules that carry multiple concern groups or multiple router instances. Standard class order:

1. **Service** — `start()`, `stop()`
2. **Domain-specific** — `Container Management`, `Workspace Discovery`, `Probes`, etc.
3. **State Management** — `save()`, `_load()`, `sync_state()`
4. **Misc** — `_broadcast_status()`, `_log_context` property (always last)

Public before private within each section.

### Structured Log Context

Service classes define a `_log_context` property returning structured dict context, spread into every log call:

```python
@property
def _log_context(self) -> dict:
    return {"workspace": {"id": self.workspace.id, "path": self.workspace.path}}


logger.info("Started", **self._log_context)
# Extended context: ctx = {"container": {"id": cid}, **self._log_context}
```

### Package Facades

Every `__init__.py` re-exports the public surface with selective imports. Callers import from the package, never from internal modules.

---

## 4. Container (Shell)

### Commands

```bash
# Build image
claudebox --build           # cached
claudebox --update          # agent layer only
claudebox --rebuild         # full no-cache

# Run
claudebox                   # interactive agent session (TUI)
claudebox -- <command>      # custom command (bypass agent)
```

### Conventions

- ✅ **Always** use `set -euo pipefail` in scripts (after shebang, before logic)
- ✅ **Always** use guard flags for one-time initialization (e.g., `__CLAUDEBOX_BASHENV_LOADED__`)
- ✅ **Always** source container hooks (`container-start.sh`, `container-end.sh`) — they run in entrypoint's shell context
- ✅ Agent hooks (`agent-start.sh`, `agent-stop.sh`) are executed as subprocesses, not sourced
- ⚠️ **Ask first** before modifying the Containerfile layer structure — affects build caching for all users
- 🚫 **Never** modify `install_base.sh` for profile-specific packages — use `image-build.sh` hook instead

**New lifecycle hooks**: Add to `claudebox-agent` script. Follow the pattern: function that executes `~/.claudebox/profile/hooks/{hook_name}.sh` with a guard flag to prevent double-execution.

### Agent Venv Isolation

Container agents must never use the workspace `.venv` — it contains symlinks to host Python paths. Use the container-local venv instead:

```bash
# Install (creates venv in /tmp/{module_path}/.venv/ when CLAUDEBOX_AGENT is set)
just install-py

# Activate for interactive use
source "/tmp/$(pwd)/.venv/bin/activate"

# Or prefix individual commands
UV_PROJECT_ENVIRONMENT="/tmp/$(pwd)/.venv" python -m pytest tests/
```

- ✅ **Always** use `just install-py` inside containers — the recipe auto-detects `CLAUDEBOX_AGENT` and routes `UV_PROJECT_ENVIRONMENT` to the `/tmp` venv
- 🚫 **Never** run `uv sync` directly inside containers — bypasses the `CLAUDEBOX_AGENT` redirect and corrupts host `.venv` with dangling symlinks

### User-output style (host scripts)

User-facing output in `bin/install.sh` (and any future host script that grows similar surface) goes through the `print_*` helpers — never bare `echo`.

| Helper | Shape | Use |
|--------|-------|-----|
| `print_header "🎯 Title"` | rule + bold 2-space-indented title; no trailing ellipsis | major phase boundary |
| `print_step "Doing X..."` | 3-space indent, no glyph, gerund | in-flight sub-step narration |
| `print_skip "<reason>"` | `   ○ Skipped — <reason>` | idempotent no-op |
| `print_success "Past-tense"` | `   ✓ <Verb>`, green | step completion |
| `print_warn "<msg>"` | `   ⚠ warning: <msg>`, yellow | sub-step warning |
| `print_fail "<msg>"` | `   ✗ error: <msg>`, red | sub-step failure |
| `print_hint "<msg>"` | `   → <msg>`, dim | follow-up action after a warning |
| `print_error_top "<msg>"` | `error: <msg>` (no indent, stderr) | top-level abort before/outside any `print_header` |
| `print_banner` / `print_result` | full-width box | run intro / success summary |

Lexicon: lowercase `warning:` / `error:` (POSIX); em-dash `—` separator in skip reasons; bare past-tense verb for success (`Installed`, `Built`); skip reasons are short noun phrases (`already installed`, `systemd not available`).

---

## 5. Container API (`claudebox_container_api`)

### Commands

```bash
# Run dev server (from within container)
CLAUDEBOX_DEV=1 container_api_launcher.sh
```

### Design Principles

- ✅ **Always** use the facade pattern — `session.py` is the only public interface to the session package
- ✅ **Always** use callbacks for child→parent notification — components don't import their parents
- ✅ **Always** use dependency injection — components receive dependencies via constructor
- 🚫 **Never** import session internals (pipeline, broadcaster, persistence) from handlers — go through `session.get_session()` / `session.get_registry()`
- 🚫 **Never** access `session.registry` from within the session package — handlers-only

### Event Architecture

- **events.jsonl** is the source of truth (append-only)
- **session.json** is a derived projection (recomputable from events)
- Event conversion pipeline: `SDK Message → Event → PublishedEvent → dict (SSE)`
- Each conversion step is a pure function (except TurnTracker which is stateful)
- ⚠️ **Ask first** before adding new event types or subtypes — affects frontend rendering pipeline

### Module Conventions

- Section banners (`# Name` + `####...`) for major sections in classes >100 lines
- Imports: stdlib → third-party → claudebox core → relative (session package)
- structlog for logging: `logger = get_logger(__name__)`
- API handlers: raise `ApiError` (from `session.errors`) for domain errors — centralized exception handler in `app.py` converts to typed HTTP responses

---

## 6. Frontend (`claudebox_frontend`)

Frontend-specific recipes (`install-fe`, `build-fe`, `test-fe`, `test-fe-cov`) are listed in §0.

### Design Principle

Features are **modular, self-contained, and encapsulated** — everything a feature needs (components, hooks, utils, styles) lives together in one directory, so its folder tells you everything about it without scanning elsewhere. Cross-feature code lives in top-level `components/`, `hooks/`, `utils/`; truly global concerns (contexts, constants, API clients) also live at the top level.

### Directory Architecture

```
src/
  main.jsx        — Entry point
  main.css        — Cascade orchestrator (imports all feature index.css in order)
  api/            — API client modules (one per endpoint group)
  config/         — App configuration and constants (layout, panel, timing, dimensions, thresholds, urls, storage)
  context/        — React contexts (app-wide state providers)
  features/       — Feature modules (self-contained)
    {feature}/
      index.js            — Barrel re-export of root component
      index.css           — Barrel import of feature styles (public entry point)
      {Feature}.jsx       — Root component (Panel suffix for side panels)
      {Feature}.css       — Styles for root component (same filename as .jsx)
      components/         — Sub-components (fractal nesting)
        {Leaf}.jsx        — Leaf component (no exclusive dependencies)
        {Complex}/        — Component with exclusive children, hooks, or utils
          {Complex}.jsx
          {Complex}.css   — Styles for this component (same filename as .jsx)
          components/     — Exclusive child components (pattern repeats)
          hooks/          — Hooks exclusive to this component
          utils/          — Utils exclusive to this component
      hooks/              — Feature-scoped custom hooks
      utils/              — Feature-scoped pure functions (extracted from hooks/components)
      effects/            — Side-effect components: container lifecycle (recovery, status, stop), daemon reconnection, session routing, workspace accent/reset, plus session bridges (NewSessionBridge, SessionDataBridge). App feature only.
  components/     — Cross-feature React components (CopyButton)
    index.css           — Barrel import of cross-feature component styles
  hooks/          — Cross-feature hooks (useLocalStorage)
  utils/          — Cross-feature pure functions (formatters, parsers, eventProcessing)
  managers/       — Coordination logic classes (SidePanelManager, SessionTabManager, BoardTabManager, PathResolutionManager, SSEConnectionManager)
```

**Import rules** — enforced by convention, not tooling:

| From | Can import from |
|------|-----------------|
| `features/app/` | All features (app shell), `components/`, `hooks/`, `utils/`, `managers/`, `config/`, `context/`, `api/` |
| `features/{other}/` | Own internals, `components/`, `hooks/`, `utils/`, `config/`, `context/`, `api/` |
| `components/`, `hooks/`, `utils/` | `config/`, `context/`, `api/` |
| `config/` | `features/` (component imports + registry imports for tool formatting utils) |
| `context/` | Other contexts, `hooks/`, `utils/`, `config/`, `api/` |

- ✅ **Always** co-locate code with its feature — single-consumer code lives in `features/{feature}/`
- ✅ **Always** barrel-export the root component: `export { default } from './ChatPanel'`
- 🚫 **Never** import from one feature into another (except `app`, which is the layout shell)
- 🚫 **Never** place single-consumer code in top-level `components/`/`hooks/`/`utils/` — promote only when a second feature needs it

**Component nesting** — directory structure mirrors the import graph:

- A component gets its own folder when it has **exclusive** children, hooks, or utils
- Multi-consumer components stay at their **lowest common ancestor** level as plain files
- Leaf components with no exclusive dependencies stay as plain `.jsx` files
- The pattern is fractal — a component's `components/` can contain further nested folders

### Context Rules

Split contexts exist to prevent unnecessary re-renders. This is the most common source of performance bugs:

- ✅ **Always** isolate a continuously-updating element (e.g. the active streaming turn) from a long-lived list of otherwise-stable siblings (completed turns) — render it separately and place the siblings behind a `React.memo`ed subtree with referentially-stable props, so they don't reconcile on each update. See ARCHITECTURE.md §5.4 (active/historical turn split).
- ✅ **Always** use granular context hooks — `useEvents()`, `useSessionData()`, `useSessionDir()`, `useSessionId()`, `useSessionActions()`, `useInteraction()`, `useStash()`, `useSessionsList()`, `useAppActions()`, `useWorkspace()`, `useSessionRouting()`
- ✅ **Always** use composition hooks to combine cross-context actions (e.g., `useNewSession()` composes tab creation + navigation + container spawning)
- ✅ **Always** use `useMemo` for context value objects
- ✅ **Always** use `useCallback` for handlers passed as props or in dependency arrays
- ✅ **Always** buffer high-frequency per-event state into a `useRef` and expose only flushed snapshots through context value — provider value identity changing per event cascades to every consumer subtree. When a context represents a streaming data source, split synchronous flag updates (cheap, drive status indicators) from heavy derived state (events / turns / diffs), and dispatch the latter on a coalescing timer (`NORMAL_BATCH_INTERVAL` is 50 ms) so the provider value's identity changes at flush rate, not at SDK event rate
- ⚠️ **Ask first** before adding state to EventsContext — it re-renders on every SSE event batch
- 🚫 **Never** create aggregate contexts that merge multiple sub-contexts — defeats React's render optimization

### Component Patterns

```javascript
// Canonical component structure:
// 1. File header comment
// 2. Imports (Biome auto-organizes alphabetically — `just fix` to apply)
// 3. function declaration (never arrow)
// 4. hooks at top
// 5. handlers
// 6. return JSX
// 7. export default ComponentName (memo() only for hot-path components)

/** Brief description of what this component does. */
function ComponentName({ prop1, prop2 }) {
  // hooks
  const { events } = useEvents()

  // handlers
  const handleClick = useCallback(() => { ... }, [dep])

  return <div>...</div>
}

export default ComponentName
```

- ✅ **Always** use function declarations for components — never arrow functions
- ✅ **Always** destructure props in the function signature
- ✅ **Always** use `handle*` for internal handlers, `on*` for callback props
- 🚫 **Never** build a component-override map inline in a render body when the subtree beneath it is expensive — it's used as the JSX element type per tag, so a new identity per render forces React to rebuild instead of reconcile. Hoist to module scope; route per-render values through context instead of a closure (see ARCHITECTURE.md §5.8)

### API Patterns

Three tiers for API calls:

| Tier | Pattern | Use when |
|------|---------|----------|
| Data-returning GET | `fetch()` + `if (!res.ok) throw` + `return res.json()` | Reading data (sessions, files) |
| Fire-and-forget POST | No `res.ok` check, void return | Actions (send, interrupt) |
| Best-effort write | `.catch(() => {})` with comment | Persistence (UI state, layout) |

### Error Handling

- API errors: bubble to caller
- User actions (send, interrupt): catch → `setError()` via InteractionContext
- Best-effort ops (persistence, scroll): `.catch(() => {})` with comment
- SSE errors: reconnect silently

### Styling

- Plain CSS files with kebab-case class names
- Component prefix convention: `.chat-panel`, `.tool-block`, `.session-item`
- State modifiers via chaining: `.turn-container.pending`
- CSS variables for theme values (defined in `features/app/App.css`)
- Font stacks are pinned, not generic: `--font-sans` / `--font-mono` (`features/app/App.css`) lead with a self-hosted webfont (`@fontsource/inter`, `@fontsource/jetbrains-mono`) so text renders identically everywhere. 🚫 **Never** write a bare `font-family: monospace` / `system-ui` directly in component CSS — use the variable, which still falls back to the OS stack if the webfont fails to load.
- The pinned mono face ships contextual alternates that merge `--`, `->` and `!=` into one glyph, so `:root` carries `font-variant-ligatures: no-contextual` — the narrowest setting that disables them, since the face ships no `liga` table for `font-variant-ligatures: none` to act on beyond `calt` — and the `button, input, select, textarea` reset re-inherits it, since the UA font shorthand resets it on form controls.
- Continuous **decorative** animations (shimmers, glows, spinners) must animate compositor-accelerated properties (`transform` / `opacity`) — never animate custom properties that feed `background`/`box-shadow`/gradient repaints, which run on the main thread and stutter under load (e.g. while streaming). Rotate a transform-driven layer and reveal it through a border/mask instead
- `src/main.css` is the top-level cascade orchestrator — imports feature and cross-feature `index.css` files in deterministic order
- App foundation (variables, resets, layout, theme) in `features/app/` — imported first by orchestrator
- ✅ **Always** co-locate CSS with its component — `{Component}.css` next to `{Component}.jsx` (same filename)
- ✅ **Always** expose feature styles via `features/{feature}/index.css` (public barrel that imports component CSS files)
- ✅ **Always** expose cross-feature component styles via `components/index.css` (public barrel)
- 🚫 **Never** CSS-in-JS, CSS modules, or Tailwind
- 🚫 **Never** import feature CSS directly from components — always through the cascade orchestrator
- 🚫 **Never** put component styles in a separate `styles/` directory — CSS lives next to the component

#### Loading / empty / error states (panel convention)

Panels use a class triplet `.{panel}-loading / -empty / -error` as panel-root modifiers, sharing the canonical `.todos-panel.todos-empty` shape (flex-centered, italic, muted). Loading copy is `"Loading..."` (3 ASCII dots). Replicate the rule in each panel's CSS — **do not extract a shared component** until ≥3 panels need divergence.

### Constants

| Location | What belongs there |
|----------|--------------------|
| `config/` directory, grouped by domain (`timing.js`, `dimensions.js`, `thresholds.js`) | Module-scoped config: `MAX_*`, `DEFAULT_*`, `*_INTERVAL`, `*_THRESHOLD`, `*_DELAY`, `*_URL` |
| Component file | Rendering-intrinsic lookup maps only — `STATUS_ICONS`, `SEGMENT_COLORS`, `FILTER` tabs — things that are meaningless outside the component's JSX |

- ✅ **Always** centralize timing/threshold constants — polling intervals, debounce delays, reconnect delays go in `config/timing.js`
- ✅ **Always** centralize layout constants — dimensions, panel configs, canonical orders go in `config/dimensions.js` and `config/layout.js`
- 🚫 **Never** put size limits, URLs, or behavioral thresholds in component files

### File Boundaries

- ✅ **Always** one exported component per `.jsx` file
- ✅ **Always** one class per `.js` file (managers, controllers, services) — same one-export rule applies to JS classes
- ✅ **Always** extract private sub-components to their own file once they exceed ~30 lines
- ✅ **Always** extract pure functions (no React APIs) into the nearest enclosing `utils/` (component-level if exclusive, feature-level otherwise)
- ✅ **Always** use descriptive filenames for extracted utils — `notifications.js`, `sessionTree.js`, not generic `helpers.js`
- ✅ **Always** order top-level declarations public-before-private — exported functions/classes before non-exported helpers, which form a trailing block at the bottom. Function declarations are hoisted, so order is purely a readability concern; exports lead because they are the file's contract, helpers follow because they are implementation detail.
- 🚫 **Never** export utility functions from component files (e.g., `readFileAsBase64` from `AttachmentPreview.jsx`)

### Utils Placement

Two tiers — placement depends on code nature, not consumer count:

| Location | Admission criteria | Examples |
|----------|--------------------|----------|
| `utils/` | General-purpose pure logic — no feature coupling | `formatDuration()`, `diff()`, `escapeXml()`, `parseGrepLine()`, `playChime()` |
| `features/{feature}/utils/` | Feature-specific transforms — operates on feature domain model | `buildSessionTree()`, `getContextBarColor()` |

**The test**: Does this function import anything from its own feature tree? If no — it's generic, belongs in `utils/`. If yes — it's feature-coupled, stays co-located.

- ✅ **Always** name utils files descriptively by domain — `notifications.js`, `diff.js`, `xml.js`
- ✅ **Always** keep feature utils pure (no React imports) — they're extracted specifically because they don't need React
- ✅ **Always** place general-purpose pure logic in `utils/` — even with a single consumer
- ✅ **Always** centralize canonical implementations — important logic (message formatting, file size formatting) must have one source of truth to prevent divergent reimplementations
- 🚫 **Never** put feature-specific data transforms in top-level `utils/` — co-locate with the feature
- 🚫 **Never** bury generic utilities deep in feature trees — they become undiscoverable

### Separation of Concerns

Four layers within each feature, each with a clear responsibility:

| Layer | Location | Responsibility | Example |
|-------|----------|----------------|---------|
| Components | `features/{feature}/components/` | Render UI from props/hooks. ≤500 lines target. | `Turn`, `ChatInput`, `SessionItem` |
| Hooks | `features/{feature}/hooks/` | Stateful behavior, subscriptions, side effects — React lifecycle only | `useFavicon`, `useNotifications`, `useBlockCollapse` |
| Utils | `features/{feature}/utils/` | Pure functions — computation, parsing, data transforms, no React | `buildSessionTree()`, `categorizeCommands()`, `findAllBlocks()` |
| Managers | `managers/` (root) or feature root | Coordination logic, layout math, multi-step workflows | `SidePanelManager`, `SessionTabManager`, `SSEConnectionManager`, `ChatController` |

**Hook ↔ Utils split**: Hooks contain only React lifecycle (state, effects, callbacks, refs). Non-React logic is extracted to `utils/` and imported back. The hook becomes a thin orchestrator:

```javascript
// ✅ Hook imports pure functions, owns only React lifecycle
import { buildNotificationTitle, playChime, getResponsePreview } from '../utils/notifications'

export default function useNotifications({ isResponding, events, ... }) {
  const wasRespondingRef = useRef(false)
  useEffect(() => { /* lifecycle logic calling pure functions */ }, [isResponding])
}
```

- ✅ **Always** extract pure functions from hooks/components into `utils/` — keeps hooks testable and focused
- ✅ **Always** extract state logic to custom hooks when a component exceeds ~500 lines
- 🚫 **Never** let a component orchestrate complex coordination — that's a manager's job
- 🚫 **Never** import React in a `utils/` file — if it needs React, it's a hook

**Do NOT extract** — the audit rule looks for *module-level* pure helpers in `hooks/*.js` or `*.jsx` files. Some patterns surface as candidates but are intentionally *not* extracted:

- **Closure-bound helpers** declared inside a `useEffect`, `useCallback`, or `useMemo` body (e.g. `recompute`, `schedule`, `updateHeights`, `observeTurns`, `handleMouseDown`). They close over hook-local state or refs; lifting them to module scope would force an awkward parameter list and break their dependency tracking.
- **React-coupled renderers and prop comparators** (e.g. `arePropsEqual` for `memo`, `createTableRowRenderer`, `getIndicator` returning JSX). These produce `<element>` output or feed React APIs directly — they belong with the component.
- **Tightly-bound constants** the component formats into UI strings (e.g. `WRAP_PAIRS`, `RewindModal` text constants). Move them to `utils/` only when reused; isolated constants stay co-located with their sole consumer.

### Prop Drilling

When props pass through 3+ levels, replace with context or composition:

- ✅ **Always** introduce a context when the same props thread through a parent → child → grandchild chain (e.g., turn metadata flowing through `Turn` → `ToolBlock` → `ToolBlockExpandedContent`)
- ✅ **Always** co-locate feature-scoped contexts with their component tree — `TurnContext.jsx` lives in `turn/`, `SessionTreeContext.jsx` lives in `session-tree/` (not in top-level `context/`)
- ✅ **Always** prefer composition (`children` / render props) over forwarding opaque prop bundles
- ⚠️ **Ask first** before creating a new context — verify the data truly crosses 3+ levels and isn't better solved by restructuring the component tree
- 🚫 **Never** accept 10+ props in a component signature — it signals the component is doing too much or the data should be contextual

### Context Scope

Each context should own **one concern**. Split when a context mixes unrelated responsibilities:

| Concern type | Example | Belongs in |
|--------------|---------|------------|
| Transport (SSE, WebSocket) | Connection lifecycle, reconnection, batching | Dedicated transport hook or context |
| Data processing | Event filtering, turn grouping, diffing | Pure utility functions called from a thin context |
| API mutations | `setModel()`, `setPermissionMode()` | Co-located with the data they mutate, not in a polling context |
| UI side effects | Browser title, favicon, notifications | Dedicated hooks, not mixed into data contexts |

- ✅ **Always** keep contexts thin — state + minimal coordination, delegate processing to pure functions or hooks
- ✅ **Always** split a context when it exceeds ~500 lines or manages 3+ unrelated state slices
- 🚫 **Never** mix transport/connection logic with data transformation in the same context

### Context Write-Back Loops

A context value that a component both **writes to** and **renders from** is a loop waiting to
close. It closes when an effect writes on every run and the write always changes state identity:

```jsx
// 🚫 the shape that loops
<IconStrip bottomPanels={['logs']} />        // new array identity every render
useEffect(() => {
  register(id)                                // adds -> new Map -> new context value
  return () => unregister(id)                 // removes -> new Map -> new context value
}, [bottomPanels])                            // identity changed -> runs again -> forever
```

The parent re-renders because the context value changed, rebuilds the literal, and the effect runs
again. Early-return guards inside the setters do not save it: remove-then-add nets to unchanged
content but two new identities. React aborts the tree with "maximum update depth exceeded" and the
page goes blank — though it may only cross that threshold under load, spinning and burning CPU the
rest of the time.

- ✅ **Always** hoist array/object literals passed as props to module constants, or `useMemo` them
- ✅ **Always** key an effect on a value's **content** (e.g. a joined id string) when the container
  holding it is rebuilt each render
- ✅ **Always** make context writers idempotent — return the previous state when the new state is
  content-equal, so a repeated write costs nothing
- ✅ **Always** state ownership declaratively (`setIds(side, ids)`) rather than as incremental
  add/remove pairs, so there is no intermediate state to churn through
- 🚫 **Never** release-and-reclaim on every dependency change when the intent is "release on
  unmount" — that is the churn, not the cleanup
- 🚫 **Never** mock a context's writers to `vi.fn()` in the only test that renders the component —
  the real provider never runs, and this entire class of bug stays invisible

**The same loop closes without a context, from a single dep-less effect.** An identity-guarded
`setState` inside a `useLayoutEffect` with no dependency array looks harmless - it runs every
commit, but only dispatches when the value actually changed:

```jsx
// 🚫 the shape that loops - no context in sight, but the same mechanism
useLayoutEffect(() => {
  const value = ref.current
  setValue(prev => (prev === value ? prev : value))   // guarded... but the guard is not enough
})
```

The guard is checked inside the updater, but React only *consults* the updater's return value
after deciding it cannot bail out eagerly - and the eager bail-out itself only applies while the
fiber carries no other pending work. The instant anything else dispatches from the same commit
(another effect, a child's `useReducer`, a measurement callback firing earlier in the same layout
phase), the bail-out fails and this "guarded" call schedules a real update anyway, despite
returning an unchanged value. Riding along with whatever legitimate churn is already happening,
that redundant reschedule is what pushes a session past React's fifty-nested-update limit - see
`useMirroredScrollElement`'s history in `useVirtualListGeometry.js` for the production instance,
and its `useVirtualListGeometry.test.jsx` for a reproduction of the mechanism in isolation.

- ✅ **Always** hold the last-seen value in a `ref` and gate the dispatch *before* calling the
  setter, not inside the updater - `if (ref.current !== value) { ref.current = value; setValue(value) }`
- ✅ **Always** prefer driving the write from attachment (a stable callback ref, fired by React
  only on a real mount/unmount/node-swap) over mirroring a ref into state on every commit, when the
  value in question is a DOM node or anything else React already has an attachment hook for
- 🚫 **Never** trust an identity-guarded updater alone to make a dep-less effect free - it is only
  free until something else on the same fiber has pending work, which is not an edge case in a
  tree with virtualizers, ResizeObservers, or streaming updates nearby

### Hook Scope

Same single-responsibility rule applies to hooks:

- ✅ **Always** one clear purpose per hook — if the name needs "and" to describe it, split it
- ✅ **Always** extract pure functions from hooks into `features/{feature}/utils/` with descriptive filenames
- ✅ **Always** use composition hooks to combine actions from multiple contexts (e.g., `useNewSession`)
- ✅ **Always** run side effects (I/O, storage writes, anything that can throw) from `useEffect` or an explicit callback — never inside a `setState` updater, which React can replay during render
- 🚫 **Never** let a hook exceed ~500 lines — decompose into smaller composable hooks

### Chrome Buttons

- ✅ **Always** consume `--chrome-btn-h`, `--chrome-btn-pad-y`, `--chrome-btn-mar-y`, `--chrome-btn-line-height` for chrome icon buttons (panel headers, header strip, session-item icon buttons). The tokens are the single source of truth for vertical metrics across all chrome surfaces.
- ✅ **Always** apply `--header-icon-color` to icons + text on the four main-area-header buttons (Stop, `+`, chevron, workspace switcher).
- ✅ **Always** use symmetric horizontal padding on chevron buttons so the icon centers in its hover-bg rectangle.
- 🚫 **Never** redefine button vertical metrics per surface. If a chrome button needs a different metric, extend the token set, do not hard-code.

### Interaction Patterns

- ✅ **Always** use the Pointer Events API (`onPointerDown`/`onPointerMove`/`onPointerUp`, `addEventListener('pointer*')`) for drag, click-vs-drag, scroll-gating, and resize handlers. Filter `event.pointerType === 'touch'` when behavior should fire only on touch gestures.
- ✅ **Always** import shared helpers from `utils/pointer.js` (`isPrimaryPointer` today; `getPointerDistance` and `DRAG_THRESHOLD_PX` land alongside their first click-vs-drag consumer).
- ✅ **Always** keep `mousedown` for outside-click detection (`useDropdown`, `useAttachments`) and prevent-blur handlers (`SessionItem`, `SessionNameEditor`, `CommandAutocomplete`) — those target click semantics, not drag.
- ✅ **Always** keep `mouseenter`/`mouseleave` for pure hover affordances — pointer events fire alongside on desktop, no migration needed.
- 🚫 **Never** pair `touchstart`+`mousedown` listeners on the same element — choose pointer events instead.

### Daemon-Frontend Patterns

When the frontend communicates with the daemon (multi-workspace mode), these conventions apply:

**Workspace-scoped API calls**: All container endpoints are prefixed with `/api/workspaces/{workspace_id}/`. Use `workspaceFetch(path, options)` from `api/apiClient.js` — it auto-injects the workspace prefix. Container-scoped calls use `containerFetch(path, options, containerId?)`, which further adds the container ID prefix: the active session's by default, or an explicit `containerId` (resolved from `ContainerMapContext`'s session→container map) to address a session other than the active one. `containerUrl(path, containerId?)` takes the same optional third argument for SSE URL construction. For daemon-level endpoints (`/api/daemon/*`), use plain `fetch()`.

**Daemon SSE stream**: The daemon broadcasts events via `GET /api/daemon/stream`. Current event types: `container_status` (container lifecycle changes), `session_progress` (progress during create/resume/fork), and `sessions_changed` (session list mutations). The frontend subscribes via `useDaemonStream()` hook (`hooks/useDaemonStream.js`), which wraps `useSSE`. New daemon-level push events should be added as dataclasses in the appropriate domain models module and broadcast via the shared `Broadcaster`.

**Frontend failure reporting**: `api/errorReport.js`'s `reportError({ kind, message, stack })` best-effort-POSTs to `/api/daemon/report`, deduplicated client-side by `kind:message`, and logs to the daemon log via `DaemonService.report_frontend_error`. A `catch` that only degrades silently or `console.warn`s should call this instead — see `ErrorBoundary`'s `componentDidCatch` and `useLocalStorage`'s persist-failure catch. Never pass message text, draft content, or file contents — `message` identifies the failure, not the conversation.

**Testing daemon-facing code**: Mock `workspaceFetch`/`containerFetch` at the `api/apiClient` module level. For contexts, mock the API modules they call. For hooks, mock both the context and API modules.

**Coalescing a signal-driven refetch**: when an external signal (SSE event, poll interval, cross-tab storage event) can trigger the same fetch faster than it resolves, coalesce onto one in-flight request rather than firing one per signal. Shape: an in-flight-promise ref, an identity ref recording what the request addressed (workspace, container, board id), a pending flag a joiner sets, and an ownership check in the settling `finally` (`if (inFlightRef.current === run)`) so a request superseded by a fresh one for a different identity neither clears the new one's bookkeeping nor applies its own stale response to state. A joiner awaits `createDeferred()` (`utils/deferred.js`), resolved once the re-armed refetch settles — never the in-flight promise it joined, which resolves on data older than the joiner's own request. See `context/SessionDataContext.jsx`, `features/boards/hooks/useBoardData.js`, and `context/SessionsContext.jsx`.

---

## 7. Testing

### Commands

All commands run from `lib/` via [just](https://github.com/casey/just) — `just --list` for the full list.

```bash
# All tests (python + frontend unit + e2e)
just test

# Python tests (fast, no coverage)
just test-py

# Python tests (single package or specific test)
just test-py tests/claudebox/
just test-py -k test_walk_up

# Python tests with coverage
just test-py-cov

# Frontend unit tests (vitest)
just test-fe

# Frontend unit tests (specific file)
just test-fe src/features/chat/components/tools/utils/helpers.test.js

# E2E tests (playwright)
just test-e2e-app
```

### Visual Regression Snapshots

`visual-regression.spec.js` renders identically in the container and on a
local dev machine — the app pins its own webfonts (see Styling above), so
either is a valid source of truth. A failure is a genuine visual difference
(or occasionally a real bug); investigate it, never dismiss it as noise.

Regenerate reference images only when a change is intended to alter the
rendered output, via `just update-e2e-app-snapshots` (runs the suite with
`--update-snapshots`).

### Documentation Screenshots

Every image on a documentation page is recorded from the mock harness, never from a real session.

```bash
just docs-captures         # check the committed captures against the app; fails on drift
just update-docs-captures  # re-record every one of them
```

- Captures live beside the pages that embed them (`docs/features/images/`, `docs/guide/images/`), one
  PNG per capture, named for what it shows. The file Playwright writes IS the committed artifact -
  the `docs` project's `snapshotPathTemplate` points there, so nothing is copied by hand.
- ✅ **Always** pass the snapshot name as an array (`['features', 'images', 'x.png']`). A
  slash-bearing string is sanitised and the capture lands flat in `docs/`.
- ✅ **Always** compare at the default zero tolerance. The visual suite's one-percent allowance is
  for antialiasing; a docs capture that drifts is a stale picture, and widening the tolerance hides
  exactly the staleness the gate exists to catch.
- ✅ **Always** drive state from a fixture with fixed timestamps. Anything reading the wall clock -
  a running turn's elapsed counter above all - moves between runs and cannot be captured.
- 🚫 **Never** mask a region: a mask paints a solid box into a PNG that ships. Choose a state with
  nothing live in frame instead.
- 🚫 **Never** capture a panel in its empty or error state unless the empty state is the subject.
- Three captures per page is the ceiling, not a quota, and content is invented - no real workspace,
  employer or personal vocabulary, and no `foo`/`test123` placeholders either.

### Principles

**Test behavior, not implementation:**
- ✅ Call the public API and verify output
- ✅ Use real dependencies when practical
- ✅ **Always** assert observable outcomes — no "should not raise" without explicit assertion
- ✅ **Always** parameterize tests that differ only in input values
- 🚫 Don't mock everything — mocking internals couples tests to implementation. Specifically: if you mock the only collaborator and assert its return value reaches the response, you're testing the framework, not your code.
- 🚫 Don't test language guarantees — enum names, dataclass defaults, `default_factory` execution, kwarg/keyword enforcement, class constant values, `isinstance` on typed constructs
- 🚫 Don't re-implement production logic in tests — if suppression logic is `flag and isinstance(msg, X) and msg.field is None`, don't copy that condition into the test; call the actual code path

**Anti-patterns** — if your test fits one of these shapes, delete it or rewrite it. Each of these has shipped here and been regretted.

| Shape | Example | Why useless | Where it belongs |
|-------|---------|-------------|------------------|
| **Code-structure introspection** | `vars(MyService)[-1] == "_log_context"` — assert via `vars()` / `inspect` / `__annotations__` / `dir()` / `hasattr()` that members are ordered/named/decorated a certain way | Tests the convention for one target only; refactor reorders silently for the other N targets. Exercises no behavior. | Linter rule (ruff custom plugin) or AST audit script. Not pytest. |
| **Dataclass-default mirror** | `c = Container(id="c1"); assert c.id == "c1"; assert c.status == DEFAULT_STATUS` | Tests Python `@dataclass` semantics, not your code. Mirrors the field declaration 1:1. Breaks mechanically on every refactor; never catches a real bug. | Delete. The dataclass declaration is the spec. If defaults matter for an external contract, fold them into a round-trip test. |
| **`default_factory` framework test** | `assert obj.created_at is not None` after construction | Tests that `field(default_factory=...)` runs — pure Python framework semantics. | Delete. |
| **Mock-echo handler test** | Handler test mocks `service.X` to return a hand-crafted object, then asserts the JSON response echoes each of that object's fields | Exercises FastAPI/Pydantic serialization, not the handler. Handler is a thin pass-through; this proves nothing about it. | Rewrite: assert URL-param → service-arg mapping, status code, content-type, error contract. Or delete. |
| **Helper-setup echo** | Test calls `_make_service(available=False)` (which constructs sub-services as `None`), then asserts `svc.sub_service is None` after `start()` | The assertion checks the helper's setup, not the method under test. The method could be a no-op or wildly broken — test still passes. | Rewrite to assert the actual contract (no exception, no state mutation), or delete. |
| **Name-vs-body mismatch** | `test_kw_only_enforced` constructs with kwargs and asserts identity, never attempts a positional call | Body would pass even with `kw_only=False`. The name promises behavior the body doesn't check. | Rewrite to trigger the failure path (`with pytest.raises(TypeError): Cls("positional")`), or delete. |
| **Same-source assertion** | Parsing a systemd unit file and asserting on a field read from that same file; reading a live parser object's own `.description` and checking the rendered `--help` text contains it; rebuilding a source function's rounding/formatting math inline to construct a test's expected value | Expected value is derived from the identical artifact or formula the assertion checks - no source change in the codebase could ever make it fail | Delete. If the property matters, lock it with an independently authored literal (a hardcoded string, a captured `inline_snapshot`) or size the input to sidestep the source's own math, never by re-deriving it. Not this: cross-referencing two independently maintained artifacts for drift, or feeding hand-crafted input to a parser/classifier under test. |
| **Reimplemented mock** | Mocking `formatDurationClock` with a hand-rolled `MM:SS` formula in a component test, when the real formatter returns `H:MM:SS` | The real logic never executes; a wrong render passes clean because the mock, not the function, defines correctness | Don't mock a pure, side-effect-free function to isolate a test - let it run for real. |

**The acid test for any new test**: if you flipped the implementation to a no-op or a wrong implementation, would the test fail? If no, the test isn't earning its keep. If the answer needs you to flip a *Python language feature* (dataclass kwargs, default values, type hints), you're testing the language — not your code.

**Python testing:**
- Framework: pytest with `pytest-anyio` for async, `inline-snapshot` for complex assertions, `pytest-cov` for coverage
- Test directory: unified `lib/tests/` at project root, mirroring source package layout (`tests/claudebox/`, `tests/claudebox_daemon/`, `tests/claudebox_container_api/`)
- Test dependencies: `pip install -e ".[test]"` or managed automatically via `uv run pytest`. Inside container: `just test-py` (uses system Python directly).
- Shared fixtures in `tests/conftest.py`: `anyio_backend` (pinned to asyncio), `tmp_workspace` (temp dir with `.workspace` marker)

**Host safety:**

Tests run on the host machine inside a [bubblewrap](https://github.com/containers/bubblewrap) sandbox (`conftest.py` re-execs pytest under `bwrap`). The sandbox makes the entire filesystem read-only except `/tmp`, blocks network access, and masks the container runtime socket (`/run`). Inside containers, bwrap is skipped (namespace creation unavailable; container already provides isolation) — `pytest-socket` provides the network-block fallback in-container via `addopts = "--disable-socket --allow-unix-socket"` in `pyproject.toml`. All socket calls fail loudly unless the test opts in via `@pytest.mark.enable_socket` or `@pytest.mark.allow_hosts(['<host>'])`.

**CLI e2e — three concentric isolation layers:**

The `e2e/cli/` suite runs the real `claudebox` binary via subprocess. Three layers prevent it from mutating real host state (daemon, `~/.claudebox/`, podman, systemctl):

1. **Sandbox** — bwrap on host (`lib/tests/conftest.py:19-59`) / the container in-container. Same isolation contract either way: read-only root, `tmpfs /tmp` and `/run`, network namespace (loopback brought up automatically). Kernel-level guarantee against escape.
2. **`lib/e2e/cli/claudebox-test` wrapper** — hard-fails if `CLAUDEBOX_TEST_HOME` or `CLAUDEBOX_TEST_PATH_PREFIX` are unset; sets `HOME`, `UV_OFFLINE=1`, and prepends `$PATH` with `lib/e2e/cli/fake_bins/`; execs `lib/bin/claudebox_cli.sh`. Test-author-error guard: impossible to invoke the wrapper unsafely even outside pytest.
3. **Fakes + fake daemon** — `lib/e2e/cli/fake_bins/{podman,systemctl,git}` record invocations to `$CLAUDEBOX_TEST_RECORD_DIR` and return canned output; `pytest-httpserver` binds the fake daemon to `127.0.0.1:<random>` (CLI honors `CLAUDEBOX_DAEMON_URL`). Tests verify *what* the CLI did, not just *that* it didn't escape.

Test modules using these fixtures must declare `pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])` at module level (the mark does not propagate from `conftest.py`).

**Subject routing for CLI tests:**

- **Parser-level tests** — dispatch, help snapshots, parser errors, unknown verbs — live in `lib/tests/claudebox_cli/`. Fast in-process unit tests via `host_cli.app.parser`. SPEC markers are forbidden here (see §8 — e2e-only).
- **End-to-end binary-behavior tests** — real `subprocess.run` exec paths, raw `print()` output, Rich/structlog rendering, filesystem side-effects, `Traceback`-absence at the process boundary, `importlib.metadata` resolution from the installed binary — live in `lib/e2e/cli/`. SPEC markers go here.

- ✅ **Always** use `tmp_path` for any filesystem writes — it targets `/tmp` which is writable in the sandbox
- ✅ **Always** mock `touch_file`/`touch_dir` when testing code paths that create host files (e.g., `get_container_args` → `map_volume`)
- ✅ **Always** mock subprocess/container-backend calls — the sandbox blocks the runtime socket but mocking prevents the call entirely
- 🚫 **Never** write to paths outside `/tmp` — the sandbox will raise `OSError: Read-only file system`
- 🚫 **Never** set `PYTEST_SANDBOXED=1` manually to bypass the sandbox — it exists to catch real side effects and protect the host

**Contract testing for utils:**
```javascript
// Utility functions are contracts — test input→output
describe('buildToolHeader', () => {
  it('Bash: shows command', () => {
    expect(buildToolHeader('Bash', { command: 'ls -la' })).toBe('Bash(ls -la)')
  })
})
```

**Frontend testing:**
- Unit tests: Vitest + React Testing Library (jsdom)
- E2E tests: Playwright (Chromium) with SSE/API mocking via fixtures
- Test files co-located: `Component.test.jsx` alongside `Component.jsx`

**Wait for the capability, not for a proxy that paints earlier.** Before `page.keyboard.press` of a global shortcut, await `waitForShortcutsReady(page)` from `e2e/app/helpers.js` (already folded into `waitForAppReady`). The app shell attaches its keydown listener in an effect that runs after paint, so anything visible — the footer included — can be on screen while the listener is not yet attached; a press landing in that gap is dropped silently, nothing retries it, and the check fails on a wait for a panel that never opens. Raising the timeout hides the race instead of removing it and slows every run. The same shape applies to any capability wired up in an effect: wait on a signal the feature itself publishes.

---

## 8. SPEC Claims

SPEC.md contains testable claims marked with `<!-- claim:[scope]:[name] -->`. The E2E test coverage tool tracks which claims have corresponding tests.

### Claim Format

```
<!-- claim:[scope]:[name] -->
```

- **scope**: UI area (kebab-case; singular by default — see Rules below for the feature-plural exception)
- **name**: Specific behavior (kebab-case)

### Standard Scopes

| Scope | Description |
|-------|-------------|
| `layout` | Overall UI structure, panels, maximize |
| `panel-session` | Sessions panel |
| `panel-log` | Logs panel |
| `panel-task` | Tasks (background) panel |
| `panel-todo` | Todos panel |
| `panel-stash` | Stash panel |
| `panel-usage` | Usage panel |
| `panel-command` | Commands panel |
| `panel-help` | Help panel |
| `panel-mcp` | MCP panel |
| `panel-boards` | Boards panel (feature-name plural) |
| `panel-bookmarks` | Bookmarks panel (feature-name plural) |
| `board` | Individual board (board view, ticket detail) |
| `bookmark` | Individual bookmark item |
| `input` | Chat input area |
| `chat` | Chat messages area |
| `turn` | Individual message turn |
| `tool` | Tool call rendering |
| `shortcut` | Keyboard shortcuts |
| `notify` | Notifications (desktop, sound, favicon) |
| `footer` | Footer bar |
| `error` | Error states |
| `workspace` | Workspace discovery, switching |
| `container` | Container lifecycle, overlays |
| `mobile` | Mobile-specific layout and behavior |

### Rules

1. **Singular by default** — `task`, `session`, not `tasks`, `sessions`. Exception: feature-name plurals are allowed when the feature itself is named in plural (e.g., `panel-boards`, `panel-bookmarks` for the Boards and Bookmarks features).
2. **No compound hyphenation** — `codeblock` not `code-block`
3. **Scope first** — related claims sort together alphabetically

### Referencing Claims in Tests

```javascript
// SPEC: [scope]:[name]
test('description matches claim', async ({ page }) => {
  // test implementation
})
```

- ✅ **Always** anchor SPEC claims from E2E Playwright tests under `e2e/app/tests/*.spec.js` (marker: `// SPEC: scope:name`) or pytest CLI tests under `e2e/cli/test_*.py` (marker: `# SPEC: scope:name`)
- 🚫 **Never** put SPEC markers in unit tests (`*.test.js`/`*.test.jsx`/`*_test.py`) — only E2E tests are valid coverage anchors. Unit tests verify implementation details; SPEC.md describes user-visible behavior. If a claim cannot be exercised through E2E, the claim itself is wrong — rewrite it as user-visible behavior or remove it from SPEC.md.
- 🚫 **Never** use `skip:claim:` to dodge E2E coverage of a real user-facing claim — every legitimate claim must be E2E-anchored

### Commands

```bash
just test-e2e-cov
```

---

## 9. Python Conventions (Cross-Package)

These apply to all Python packages (`claudebox`, `claudebox_cli`, `claudebox_daemon`, `claudebox_container_api`).

### Docstrings

**The acid test**: Does this docstring tell a senior engineer something NOT already visible from the function name, signature, and class context? If no — delete it.

- ✅ Module docstring on every `.py` file — single line: `"""Brief description."""`
- ✅ **Always** blank line after module docstring (before imports)
- ✅ **Always** class docstring on every class, including dataclasses
- ✅ **Always** function docstring on public functions — except when name + signature + class context already tells the complete story
- ✅ **Always** blank line after any docstring (between `"""` and code body)
- ✅ **Always** default to one line; a second line must carry a fact the first doesn't — name it, or delete the line
- ✅ **Always** keep comment/docstring lines under ~100 chars (biome's `lineWidth`) — compress wording first; if content genuinely doesn't fit, split into multiple tight lines (each a complete thought), never one crammed mega-line or word-wrapped prose
- 🚫 **Never** docstrings after variables — use `# comment` before the variable instead
- 🚫 **Never** repeat information already visible in type hints or class Attributes
- 🚫 **Never** comment sentinel patterns — `NOT_PROVIDED = object()` and `MISSING = object()` are self-evident
- 🚫 **Never** explain standard library usage, common design patterns, or language idioms

**Docstring sizing** — wrappers and obvious functions get single lines:

```python
# ✅ Simple wrapper → single-line docstring
def dumps(obj: Any, **kwargs) -> str:
    """Serialize object to JSON string using extended encoder."""

    return json.dumps(obj, cls=JSONEncoder, **kwargs)


# 🚫 Over-documented wrapper (Args/Returns just restate signature)
def dumps(obj: Any, **kwargs) -> str:
    """Serialize Python object to a JSON string.

    Args:
        obj: Python object to serialize.
        **kwargs: Additional arguments passed to json.dumps.

    Returns:
        JSON string representation of the object.
    """

    return json.dumps(obj, cls=JSONEncoder, **kwargs)
```

**When to omit docstrings** — these patterns are self-documenting:

- **Trivial `__init__`**: Body is only attribute assignment and/or `super()` calls, and the class docstring (with Attributes) already documents the fields
- **Self-evident properties**: Property name + return type tells the full story (e.g., `session_id -> str`, `value -> dict`)
- **Trivial delegations**: Method delegates to a single call and the name says what it does (e.g., `close()`, `stop_all()`, `build_image()`)
- **Obvious private methods**: `_log_context`, `_broadcast_status` — name is the documentation

```python
# ✅ Trivial __init__ — class Attributes is sufficient, no __init__ docstring needed
class ContainerBackend:
    """Container runtime abstraction for podman/docker commands.

    Attributes:
        name: The container runtime command name.
        verbose: Whether to print executed commands.
    """

    def __init__(self, name: str, *, verbose: bool = False):
        self.name = name
        self.verbose = verbose


# ✅ Non-trivial __init__ — docstring explains non-obvious behavior
class Workspace:
    """Resolved workspace with session management."""

    def __init__(self, path: str | Path):
        """Resolve workspace root by walking up from path to find .workspace marker.

        Falls back to path itself if no marker found. Creates .claudebox/
        directory structure on first access.
        """
```

**Always keep** docstrings on these — they serve functional purposes beyond code documentation:

- **FastAPI route handlers**: Docstrings become OpenAPI/Swagger API documentation
- **MCP tool functions**: Docstrings are exposed as tool descriptions to MCP clients
- **Non-trivial `__init__`**: Side effects, deferred creation, fallback logic, disk I/O — anything the caller wouldn't expect from the signature
- **Protocol classes**: The docstring explains the callback contract (when it fires, what it means)

**Variable documentation**: Use comments before, not docstrings after:

```python
# ✅ Correct: comment before variable
# Global log broadcaster for SSE streaming.
log_broadcaster = LogBroadcaster()

# 🚫 Wrong: docstring after variable (not valid Python docstring semantics)
log_broadcaster = LogBroadcaster()
"""Global log broadcaster for SSE streaming."""
```

### Keyword-Argument Discipline

- 🚫 **Never** put a `**kwargs` catch-all on a constructor/factory that also declares named callback parameters (`on_*`, `*_callback`, `*_cb`). A caller wiring a misnamed callback (`on_session_start` vs `on_start`) gets it silently swallowed instead of failing loud. Declare the callbacks explicitly and drop the catch-all so an unknown kwarg raises `TypeError`. Enforced by `CallbackCatchAllAudit` in `lib/scripts/python-guidelines-audit.py` (runs under `just lint`).
- ✅ Underscore-prefixed catch-alls (`**_server_args`) are intentional "ignore the rest" markers and exempt; genuine pass-through wrappers (forwarding to a framework constructor that validates its own kwargs) are fine.
- 🚫 Methods that apply caller-supplied fields to a model (`update` / `patch` style) should reject unknown fields (`hasattr` guard + raise) rather than blindly `setattr` them, so a typo'd field name fails loud instead of creating a dead attribute.

### Type Hints

- ✅ **Always** return type on all functions, including `-> None` (exception: `__init__` may omit `-> None` when the class is trivial or the return type is obvious)
- ✅ **Always** modern union syntax: `str | None` not `Optional[str]`
- ✅ **Always** parameterized generics: `list[str]`, `dict[str, Any]`, `Iterable[str]`
- ✅ **Always** use `Protocol` with `__call__` for callback type hints — named parameters visible at the call site vs opaque positional types in `Callable[[X, Y], R]`
- ✅ **Always** use `| None` only when `None` is a meaningful runtime value (optional config, legitimate return) — not for "not yet initialized" attributes
- ✅ **Always** use `if TYPE_CHECKING:` for imports used only in annotations — string-quote the references (`"Type"`), no `from __future__ import annotations`

### Imports

```python
# Order: stdlib → third-party → claudebox core → relative
import asyncio
import json
from pathlib import Path

import structlog
from fastapi import APIRouter

from claudebox import serialization
from .models import Event, PublishedEvent
```

- Absolute imports for cross-package, relative for intra-package
- Blank lines between import groups (PEP 8 style)

### Whitespace & Control Flow

Separate logical phases with blank lines; keep cohesive runs tight. The acid test: each blank line sets off one logical step — a branch, a loop, a context, or the function's conclusion; lines forming a single thought stay together.

- ✅ **Always** a blank line before every control block (`if` / `for` / `while` / `with` / `try`) and every `return` / `raise` that is not the first statement in its block
- ✅ **Always** a blank line after a block before the next statement at the outer level
- ✅ **Always** `if` / `elif` / `else` for mutually-exclusive return dispatch — not a sequence of bare `if cond: return` ending in a fallthrough `return`
- 🚫 **Never** pad cohesive runs — dataclass fields, dict/list literals, comprehensions, runs of related simple assignments, and `elif` / `else` / `except` / `finally` chains stay tight
- 🚫 **Never** hand-tune `def` / `class` blank-line spacing — `ruff format` owns it

```python
# ✅ Phases separated; mutually-exclusive dispatch is if/elif/else
def serialize(obj: Any) -> Any:
    asdict = getattr(obj, "asdict", None)

    if callable(asdict):
        obj = asdict()

    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, Decimal):
        return float(obj)
    else:
        return obj
```

### Data Structures

| Type | When |
|------|------|
| `@dataclass` | Data containers (Event, Config, SessionSummary) |
| Regular class | Stateful/behavioral objects (Session, Pipeline, Backend) |
| `enum.Enum` | Finite sets (BuildMode, NodeType) |

Adding a field to `Config` means adding it to `etc/settings.sample.toml` too - `tests/claudebox/test_settings_sample_drift.py` fails the build otherwise.

### Constants

- `ALL_CAPS` at module level for cross-module constants
- Class-level for class-scoped config (e.g., `UIStateStore.VERSION`)
- Type annotations optional (type obvious from value)

#### Home-derived paths

- Paths derived from `Path.home()` (or any other runtime-resolved root) MUST be exposed as zero-arg accessor functions, NOT module-level constants.
- Rationale: a module-level `CONSTANT = Path.home() / "x"` evaluates `Path.home()` at import time. The resulting `Path` object is frozen and ignores `monkeypatch.setattr("pathlib.Path.home", …)` in tests — leading to silent test-correctness bugs where the code under test operates on the real host home while the test sets up state under a fake home.
- Naming: `lowercase_snake_case()` (e.g., `claude_settings_file()`, `daemon_config_path()`). The `()` at call sites signals "resolves now, honors current home."
- Default-arg trap: do NOT write `def load(path = some_accessor()): …` — default args evaluate once at function-def time. Use a sentinel: `def load(path: Path | None = None): path = path or some_accessor()`.
- The same trap applies to any `Path.cwd()`-derived or environment-derived constants — same rule, same fix.

### Private Naming

- Single underscore `_name` for private — no double-underscore mangling
- `_method()` for internal methods
- `_variable` for internal state

### Logging

Unified structlog-based logging across all packages:

```python
from claudebox import get_logger

logger = get_logger(__name__)
logger.info("event_name", key="value")
```

| Package | Log File | Notes |
|---------|----------|-------|
| `claudebox` | `{session_dir}/user.log` (filename in `USER_LOG_FILENAME`) | Core logging with memory buffer |
| `claudebox_container_api` | `{session_dir}/container_api.log` | Extends core with SSE broadcasting |
| `claudebox_cli` | Rich console | User-facing output (separate from operational logging) |
| `claudebox_daemon` | Console (always) + `{daemon_log_dir()}/daemon-{port}.log` (rotating, prod only — skipped when `--dev` is passed) | Host-side daemon; structured context via `_log_context` properties |

- ✅ **Always** use `get_logger(__name__)` for operational logging
- ✅ **Always** use structlog's key-value style: `logger.info("event", key=value)`
- 🚫 **Never** use `print()` for logging — only for protocol I/O (hooks) or user-facing CLI output

---

## 10. JavaScript Conventions

These apply to all JS/JSX files in the frontend.

### JSDoc Comments

- ✅ File comment on every file — single line: `/** Brief description. */` (barrel `index.js` re-exports exempt)
- ✅ **Always** blank line after file comment (before imports)
- ✅ **Always** JSDoc on every exported function/component — imperative mood
- ✅ **Always** `@param` for props on React components
- ✅ **Always** default to one line; a second line must carry a fact the first doesn't — name it, or delete the line
- ✅ **Always** keep comment/JSDoc lines under ~100 chars (biome's `lineWidth`) — compress wording first; if content genuinely doesn't fit, split into multiple tight lines (each a complete thought), never one crammed mega-line or word-wrapped prose
- 🚫 **Never** repeat information already visible in function signature or PropTypes

**File-level comments**: Single line at top of file:

```javascript
// ✅ Correct: single-line file comment with blank line before imports
/** Markdown renderer with syntax highlighting for code blocks. */

import ReactMarkdown from 'react-markdown'

// 🚫 Wrong: multi-line file comment, no blank line
/**
 * Markdown renderer component.
 * Uses react-markdown with rehype-highlight for syntax highlighting.
 */
import ReactMarkdown from 'react-markdown'
```

**Component JSDoc**: Include `@param` for props:

```javascript
// ✅ Correct: JSDoc with @param for props
/**
 * Render a file tree with expandable folders and selectable files.
 * @param {object} props
 * @param {object} props.tree - Tree data structure with nodes.
 * @param {string} props.selectedId - Currently selected node ID.
 * @param {function} props.onSelect - Callback when node is selected.
 */
function FileTree({ tree, selectedId, onSelect }) {

// 🚫 Wrong: no @param, or redundant descriptions
/**
 * FileTree component that renders a tree of files.
 * This component displays files in a tree structure.
 */
function FileTree({ tree, selectedId, onSelect }) {
```

**Simple functions**: Single-line JSDoc is sufficient:

```javascript
// ✅ Simple utility → single-line JSDoc
/** Format duration in seconds to "Xm Ys" string. */
function formatDuration(seconds) {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// 🚫 Over-documented simple function
/**
 * Format a duration value.
 * @param {number} seconds - The duration in seconds to format.
 * @returns {string} A formatted string in "Xm Ys" format.
 */
function formatDuration(seconds) {
```

**Test files**: Only need file-level comment:

```javascript
// ✅ Test file: single-line file comment with blank line
/** Tests for FileTree component. */

import { render } from '@testing-library/react'

describe('FileTree', () => {
  // test names are self-documenting
  it('renders folder icons for directories', () => {
```
