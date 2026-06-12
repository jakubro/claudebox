# Claudebox development tasks

set shell := ["bash", "-euo", "pipefail", "-c"]

# Detect if running inside a container or not
CONTAINER := `if [ -f /run/.containerenv ] || [ -f /.dockerenv ]; then echo 'true'; else echo 'false'; fi`
# Container-local venv path (avoids corrupting host .venv)
AGENT_VENV := "/tmp" / justfile_directory() / ".venv"
# UV env prefix: routes uv to container venv when in container; empty otherwise (uses .venv/ in cwd)
UV_ENV := if CONTAINER == "true" { f"UV_PROJECT_ENVIRONMENT='{{ AGENT_VENV }}' VIRTUAL_ENV=" } else { "VIRTUAL_ENV=" }
# UV runner: auto-selects container venv
UV_RUN := UV_ENV + " uv run"
# Python runner: auto-selects container venv
PYTHON := UV_RUN + " python -m"
# Test runner wrapper: bounds wall-clock time and virtual memory
RUN_BOUNDED := justfile_directory() / "scripts/run-bounded.sh"

# List available recipes
default:
    @just --list

# ─── Composite ──────────────────────────────────────────

# Install all dependencies
install: install-py install-shared-js install-fe install-e2e-app

# Production build
build: build-fe

# Full pre-commit check
check: lint test

# Run all tests
test: test-py test-fe test-e2e-cli test-e2e-app

# Run all tests with coverage
coverage: test-py-cov test-fe-cov test-e2e-app test-e2e-cov

# ─── Python ─────────────────────────────────────────────

# Install Python dependencies
[group('python')]
install-py:
    {{ UV_ENV }} uv sync --extra dev 2>&1 | tee /tmp/claudebox--install-py.log

# Run Python tests
[group('python')]
test-py *ARGS:
    {{ UV_ENV }} {{ RUN_BOUNDED }} 10m 4096 -- uv run python -m pytest tests/ {{ ARGS }} 2>&1 | tee /tmp/claudebox--test-py.log

# Run Python tests with coverage
[group('python')]
test-py-cov *ARGS:
    just test-py --cov=src --cov-report=term-missing {{ ARGS }}

# ─── JS ─────────────────────────────────────────────────

# Install JS lint tooling
[group('js')]
install-shared-js:
    npm ci 2>&1 | tee /tmp/claudebox--install-shared-js.log

# ─── Frontend ───────────────────────────────────────────

# Install frontend dependencies
[group('frontend')]
[working-directory('src/claudebox_frontend')]
install-fe:
    npm ci 2>&1 | tee /tmp/claudebox--install-fe.log

# Production frontend build
[group('frontend')]
[working-directory('src/claudebox_frontend')]
build-fe:
    npm run build 2>&1 | tee /tmp/claudebox--build-fe.log

# Run frontend unit tests
[group('frontend')]
[working-directory('src/claudebox_frontend')]
test-fe *ARGS:
    {{ RUN_BOUNDED }} 5m 32768 -- npx vitest run {{ ARGS }} 2>&1 | tee /tmp/claudebox--test-fe.log

# Run frontend unit tests with coverage
[group('frontend')]
[working-directory('src/claudebox_frontend')]
test-fe-cov:
    just test-fe --coverage

# ─── E2E ───────────────────────────────────────────────

# Install E2E dependencies
[group('e2e/app')]
[working-directory('e2e/app')]
install-e2e-app:
    rm -f /tmp/claudebox--install-e2e-app.log
    npm ci 2>&1 | tee -a /tmp/claudebox--install-e2e-app.log
    npx playwright install chromium 2>&1 | tee -a /tmp/claudebox--install-e2e-app.log

# Run frontend E2E tests
[group('e2e/app')]
[working-directory('e2e/app')]
test-e2e-app *ARGS:
    {{ RUN_BOUNDED }} 15m 131072 -- npx playwright test -- {{ ARGS }} 2>&1 | tee /tmp/claudebox--test-e2e-app.log

# Run CLI E2E tests
[group('e2e/cli')]
test-e2e-cli *ARGS:
    {{ UV_ENV }} {{ RUN_BOUNDED }} 10m 4096 -- uv run python -m pytest e2e/cli/ {{ ARGS }} 2>&1 | tee -a /tmp/claudebox--test-e2e-cli.log

# Run E2E spec coverage
[group('e2e')]
test-e2e-cov:
    node scripts/spec-coverage.js --verbose 2>&1 | tee /tmp/claudebox--test-e2e-cov.log

# Regenerate E2E visual regression snapshots
[group('e2e/app')]
[working-directory('e2e/app')]
update-e2e-app-snapshots:
    npx playwright test visual-regression --update-snapshots 2>&1 | tee /tmp/claudebox--update-e2e-app-snapshots.log

# ─── Test UI (In-Container) ────────────────────────────

# Start test UI environment
[group('test-ui')]
test-ui-start:
    ./scripts/test-ui/start.sh 2>&1 | tee /tmp/claudebox--test-ui-start.log

# Stop test UI environment
[group('test-ui')]
test-ui-stop:
    ./scripts/test-ui/start.sh stop 2>&1 | tee /tmp/claudebox--test-ui-stop.log

# Browse test UI (e.g.: just test-ui-browse screenshot "#sidebar")
[group('test-ui')]
test-ui-browse *ARGS:
    just test-ui-run ./scripts/test-ui/browse.py {{ ARGS }}

# Run a Playwright script against test UI (e.g.: just test-ui-run repro/focus.py)
[group('test-ui')]
test-ui-run SCRIPT *ARGS:
    UV_PROJECT_ENVIRONMENT="/tmp/claudebox-test/.venv" uv run --directory "{{ justfile_directory() }}" {{ SCRIPT }} {{ ARGS }} 2>&1 | tee /tmp/claudebox--test-ui-run.log

# ─── Lint ───────────────────────────────────────────────

# Lint all code
lint:
    rm -f /tmp/claudebox--lint.log
    {{ UV_RUN }} ruff format --check 2>&1 | tee -a /tmp/claudebox--lint.log
    {{ UV_RUN }} ruff check 2>&1 | tee -a /tmp/claudebox--lint.log
    PYTHONPATH= {{ UV_RUN }} ty check 2>&1 | tee -a /tmp/claudebox--lint.log
    {{ UV_RUN }} python scripts/python-guidelines-audit.py 2>&1 | tee -a /tmp/claudebox--lint.log
    npx biome check 2>&1 | tee -a /tmp/claudebox--lint.log
    (node scripts/frontend-guidelines-audit.js --verbose 2>&1 || true) | tee -a /tmp/claudebox--lint.log
    node scripts/spec-coverage.js --verbose 2>&1 | tee -a /tmp/claudebox--lint.log
    npx knip 2>&1 | tee -a /tmp/claudebox--lint.log
    npx jscpd --exitCode 1 --format python --min-tokens 100 2>&1 | tee -a /tmp/claudebox--lint.log
    npx jscpd --exitCode 1 --format javascript,jsx,typescript,tsx,css,scss,less 2>&1 | tee -a /tmp/claudebox--lint.log

# Auto-fix all code
fix:
    rm -f /tmp/claudebox--fix.log
    {{ UV_RUN }} ruff check --fix 2>&1 | tee -a /tmp/claudebox--fix.log
    {{ UV_RUN }} ruff format 2>&1 | tee -a /tmp/claudebox--fix.log
    PYTHONPATH= {{ UV_RUN }} ty check --fix 2>&1 | tee -a /tmp/claudebox--fix.log
    npx biome check --fix 2>&1 | tee -a /tmp/claudebox--fix.log
