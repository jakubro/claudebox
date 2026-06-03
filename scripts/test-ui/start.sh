#!/bin/bash
# Start in-container test UI environment — daemon with local backend in dev mode
set -euo pipefail

SCRIPT_DIR=$(dirname "$(realpath "$0")")
LIB_DIR=$(realpath "${SCRIPT_DIR}/../..")

# Use /tmp so test artifacts persist across container restarts
TEST_DIR="/tmp/claudebox-test"
WORKSPACE_DIR="${TEST_DIR}/ws"
VENV_DIR="${TEST_DIR}/.venv"
PID_FILE="${TEST_DIR}/pids"
LOG_DIR="${TEST_DIR}"

# Port 41930 → Vite on 41930, uvicorn on 41931 (avoids host daemon on 41920/41921)
DAEMON_PORT=41930

# Stop running test environment (kill entire process group)
stop() {
    if [[ -f "$PID_FILE" ]]; then
        while read -r pid; do
            # Kill the process group to catch child processes (Vite, uvicorn reloader)
            kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
        done < "$PID_FILE"
        rm -f "$PID_FILE"
        echo "Test UI stopped."
    else
        echo "No running test UI found."
    fi
}

if [[ "${1:-}" == "stop" ]]; then
    stop
    exit 0
fi

# Ensure clean state
stop

mkdir -p "$LOG_DIR"
mkdir -p "$WORKSPACE_DIR/.claudebox"
touch "$WORKSPACE_DIR/.workspace"

# Configure test workspace to use local backend
cat > "${WORKSPACE_DIR}/.claudebox/settings.toml" <<'TOML'
backend = "local"
TOML

# Sync dependencies into test venv
echo "Syncing dependencies..."
UV_PROJECT_ENVIRONMENT="$VENV_DIR" uv sync --directory "$LIB_DIR" --extra dev 2>&1 | tail -3
uv pip install --python "${VENV_DIR}/bin/python" playwright 2>&1 | tail -3

# Write a clean daemon config with only the test workspace
"${VENV_DIR}/bin/python" -c "
from claudebox_daemon.domain.config import DaemonConfig
config = DaemonConfig.load()
# Remove all existing workspaces, register only the test workspace
for ws in list(config.workspaces):
    config.deregister_workspace(ws.id)
config.register_workspace('${WORKSPACE_DIR}')
"

# Verify port is free
if curl -s "http://localhost:${DAEMON_PORT}" > /dev/null 2>&1; then
    echo "ERROR: Port ${DAEMON_PORT} already in use" >&2
    exit 1
fi

# Unset container API args from host daemon
unset CLAUDEBOX_CONTAINER_API_ARGS 2>/dev/null || true

# Start daemon in dev mode (launches Vite on DAEMON_PORT, uvicorn on DAEMON_PORT+1)
echo "Starting daemon on port ${DAEMON_PORT}..."
setsid env \
    CLAUDEBOX_PWD="$WORKSPACE_DIR" \
    CLAUDEBOX_NO_RELOAD=1 \
    CLAUDEBOX_NO_TMP_REMAP=1 \
    "${VENV_DIR}/bin/python" "${LIB_DIR}/src/host_daemon.py" \
    --port "$DAEMON_PORT" --dev \
    > "${LOG_DIR}/daemon.log" 2>&1 &
DAEMON_PID=$!
echo "$DAEMON_PID" > "$PID_FILE"

# Cleanup on exit
cleanup() {
    stop
}
trap cleanup EXIT INT TERM

# Wait for readiness
echo "Waiting for daemon..."
for i in $(seq 1 30); do
    if curl -s "http://localhost:${DAEMON_PORT}" > /dev/null 2>&1; then
        echo "  Daemon ready on port ${DAEMON_PORT}"
        break
    fi
    if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
        echo "ERROR: Daemon process died" >&2
        cat "${LOG_DIR}/daemon.log" >&2
        exit 1
    fi
    if [[ $i -eq 30 ]]; then
        echo "ERROR: Daemon not ready after 30s" >&2
        tail -20 "${LOG_DIR}/daemon.log" >&2
        exit 1
    fi
    sleep 1
done

echo ""
echo "Test UI ready:"
echo "  UI:   http://localhost:${DAEMON_PORT}"
echo "  API:  http://localhost:$((DAEMON_PORT + 1))"
echo "  Logs: ${LOG_DIR}/daemon.log"
echo ""
echo "Press Ctrl-C to stop."

wait
