# Test-UI Harness Reference

> **Purpose**: In-container UI debugging environment — full claudebox stack (daemon + Vite dev server) running locally with a subprocess backend, headless Playwright browser, and no podman dependency.

---

## 1. Overview

Starts a daemon with `backend=local`, a Vite dev server, and Playwright browser helpers for headless in-container UI debugging. Use it to reproduce UI bugs, validate frontend changes, write visual regression scripts, and confirm fixes before committing.

### Live & Interactive

The harness connects to real Claude with active credentials — sessions produce genuine AI responses, not mocked data. Agents can perform any production interaction: send messages, bookmark turns, queue messages, interrupt generation, navigate tabs, resume and fork sessions.

---

## 2. Architecture

`start.sh` orchestrates the environment in this sequence:

1. **Stop** any existing test environment (kills process group via PID file)
2. **Create workspace** at `/tmp/claudebox-test/ws/` with `.workspace` marker and `.claudebox/settings.toml` configured for `backend = "local"`
3. **Sync dependencies** into an isolated venv at `/tmp/claudebox-test/.venv` via `uv sync --extra dev`; install Playwright into the same venv
4. **Rewrite daemon config** — deregisters all existing workspaces and registers only the test workspace, isolating from any host daemon configuration
5. **Start daemon** via `setsid` as a background process group:
   - Environment: `CLAUDEBOX_PWD` (workspace path), `CLAUDEBOX_NO_RELOAD=1` (no file watcher), `CLAUDEBOX_NO_TMP_REMAP=1` (disable `/tmp` symlink remapping in hook subprocesses)
   - Command: `host_daemon.py --port 41930 --dev`
   - Dev mode: Vite dev server on port 41930, uvicorn API on port 41931
6. **Poll for readiness** — checks `http://localhost:41930` every second, up to 30 seconds. Prints daemon log on failure.
7. **Wait** — blocks until Ctrl-C, then triggers cleanup (kill process group, remove PID file)

---

## 3. Directory Layout

```
/tmp/claudebox-test/
├── .venv/                  # Isolated Python venv (uv sync --extra dev + playwright)
├── ws/                     # Test workspace root
│   ├── .workspace          # Workspace marker
│   └── .claudebox/
│       └── settings.toml   # backend = "local"
├── pids                    # Process group PID file for cleanup
├── daemon.log              # Daemon stdout/stderr
├── screenshot.png          # Full-page screenshot (from browse.py)
├── element.png             # Element screenshot (from browse.py)
├── console.log             # Captured console messages (from browse.py)
└── network.log             # Captured network requests (from browse.py)
```

---

## 4. Commands

All commands run from `lib/` via `just`. The test venv is injected via `UV_PROJECT_ENVIRONMENT="/tmp/claudebox-test/.venv"`.

### `just test-ui-start`

Starts the test environment, killing any existing instance first; blocks until Ctrl-C.

**Prerequisites**: `just install-py` (installs Python deps into the container-local venv). Chrome ships in the container image at `/usr/bin/google-chrome`, which harness scripts use via `channel="chrome"`.

The image ships its own Playwright and matching browser builds, but `lib/e2e/app` pins its own `@playwright/test` and each release demands its own build. On a mismatch the suite fails outright - run `just install-e2e-app`, see GUIDELINES.md §0 and Troubleshooting below.

### `just test-ui-stop`

Stops the test environment by killing the daemon process group. Safe to call when nothing is running.

### `just test-ui-browse <subcommand> [args]`

Runs `browse.py`, a headless Playwright browser helper: launches Chrome, navigates to `http://localhost:41930`, executes the subcommand, then exits.

| Subcommand | Arguments | Output | Description |
|------------|-----------|--------|-------------|
| `screenshot` | `[selector]` | `screenshot.png` or `element.png` | Full-page screenshot, or element screenshot when a CSS selector is provided |
| `console` | — | `console.log` | Captures browser console messages for 5 seconds |
| `network` | — | `network.log` | Captures network requests/responses for 5 seconds |
| `click` | `<selector>` | — | Clicks the matched element, waits 1 second |
| `fill` | `<selector> <value>` | — | Fills an input field with the given value |
| `navigate` | `<path>` | — | Navigates to a path relative to base URL, waits 2 seconds |
| `eval` | `<expression>` | stdout | Evaluates JavaScript in page context, prints result (JSON-formatted for objects/arrays) |

Output files default to `/tmp/claudebox-test/`; override with `--output <dir>`, or the base URL with `--url <url>`.

### `just test-ui-run <script> [args]`

Runs an arbitrary Python script in the test venv, with access to Playwright, claudebox packages, and test dependencies. Extra arguments are forwarded to the script.

```bash
just test-ui-run path/to/repro.py
just test-ui-run path/to/repro.py --verbose
```

---

## 5. Writing Custom Playwright Scripts

Scripts run inside the container with Chrome pre-installed; no display server needed, everything runs headless.

### Minimal template

```python
#!/usr/bin/env python3
"""Repro script for [describe the bug]."""

from playwright.sync_api import sync_playwright

URL = "http://localhost:41930"
OUTPUT = "/tmp/claudebox-test"

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        channel="chrome",
        headless=True,
        args=["--no-sandbox"],
    )
    page = browser.new_page()
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)  # wait for SSE connection and initial render

    # --- Test logic ---
    # page.click(".some-button")
    # page.wait_for_selector(".expected-element")
    # page.screenshot(path=f"{OUTPUT}/result.png", full_page=True)

    # Assert expected state
    # assert page.query_selector(".expected-element") is not None

    browser.close()
    print("PASS")
```

### Useful Playwright APIs

| API | Purpose |
|-----|---------|
| `page.goto(url, wait_until="domcontentloaded")` | Navigate and wait for DOM |
| `page.wait_for_selector(selector, timeout=5000)` | Wait for element to appear |
| `page.query_selector(selector)` | Find element (returns `None` if missing) |
| `page.query_selector_all(selector)` | Find all matching elements |
| `page.click(selector)` | Click element |
| `page.fill(selector, value)` | Fill input field |
| `page.evaluate(expression)` | Run JS in page context |
| `page.screenshot(path=..., full_page=True)` | Capture screenshot |
| `page.wait_for_timeout(ms)` | Wait for a fixed duration |
| `page.on("console", callback)` | Listen for console messages |

### Tips

- **Wait for readiness**: After `page.goto()`, wait 2-3 seconds for SSE connection and initial render before interacting.
- **CSS selectors**: Use `data-testid` attributes where available (e.g., `[data-testid="panel-sessions"]`). Fall back to class-based selectors (`.chat-input`, `.turn-container`).
- **API calls**: Scripts can also call the API directly at `http://localhost:41931` for backend-level testing.
- **Assertions**: Use plain `assert` statements — the script exit code signals pass/fail to `just test-ui-run`.

---

## 6. Differences from Production

| Aspect | Test-UI | Production |
|--------|---------|------------|
| Container backend | `local` (subprocess runtime) | podman container |
| Ports | 41930 (Vite) / 41931 (API) | 41820 (Caddy) / 41821 (uvicorn) |
| Frontend server | Vite dev server (HMR) | Caddy reverse proxy to static build |
| Workspaces | Single test workspace | Multiple registered workspaces |
| Daemon config | Rewritten on each start | Persistent `~/.claudebox/daemon.json` |
| Process model | `setsid` process group + PID file | systemd user service |
| `/tmp` remapping | Disabled (`CLAUDEBOX_NO_TMP_REMAP=1`) | Active |
| File watcher | Disabled (`CLAUDEBOX_NO_RELOAD=1`) | Enabled in dev, disabled in prod |

---

## 7. Troubleshooting

**Port 41930 already in use**
Another test-UI instance or stale process is running. Run `just test-ui-stop` first, or manually kill processes on that port.

**Daemon dies on startup**
Check `cat /tmp/claudebox-test/daemon.log` for errors. Common causes: missing dependencies (run `just install-py`), port conflict, corrupted daemon config.

**Playwright or Chrome not found**
Run `just install-py` to sync the test venv. Chrome is pre-installed in the container image — if missing, the container image needs rebuilding.

**`Executable doesn't exist at .../chromium_headless_shell-<build>`**
The pinned `@playwright/test` in `lib/e2e/app` wants a browser build the container image doesn't carry (the image only installs builds for its own Playwright version). Run `just install-e2e-app` to fetch the matching build - expect this after bumping either Playwright version.

**Screenshots are blank or show wrong state**
Ensure the test-UI is fully ready before capturing. Add `page.wait_for_timeout(3000)` after navigation. Check that Vite has finished compiling (`daemon.log` shows "ready in" message).

**Session not starting**
The test workspace uses `backend=local` which spawns Claude as a subprocess. Check daemon logs for subprocess errors. Verify the Claude CLI is available in PATH.
