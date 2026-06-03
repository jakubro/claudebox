#!/bin/bash
# Claudebox Daemon wrapper
set -euo pipefail

SCRIPT_DIR=$(dirname "$(realpath "$0")")
ROOT_DIR=$(realpath "${SCRIPT_DIR}/..")

# Ensure uv uses its own environment
unset VIRTUAL_ENV

# Recursively kill a process and all its descendants
kill_tree() {
  local pid=$1
  local sig=${2:-TERM}

  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child" "$sig"
  done

  # Best-effort: an already-dead pid makes kill exit non-zero — || true keeps
  # the caller (cleanup, run under set -e) from aborting before it exits 0.
  kill -"$sig" "$pid" 2>/dev/null || true
}

# Set by cleanup() so the main path can distinguish an intentional
# (signal-initiated) stop from a crash, and exit 0 only for the former.
SHUTDOWN_REQUESTED=0

# On SIGTERM (from systemd stop/restart), kill the entire child tree.
# SIGTERM first for graceful shutdown, then SIGKILL survivors after 5s.
# Total budget: ~5s, well within TimeoutStopSec=15.
cleanup() {
  SHUTDOWN_REQUESTED=1
  trap '' SIGTERM SIGINT
  kill_tree "$CHILD_PID"
  sleep 5
  kill_tree "$CHILD_PID" KILL
  # A signal-killed child makes wait return 128+N — || true keeps set -e from
  # aborting cleanup here so the main path runs the exit-status logic.
  wait "$CHILD_PID" 2>/dev/null || true
}

trap cleanup SIGTERM SIGINT

uv run \
  --project "$ROOT_DIR" \
  "$ROOT_DIR"/src/host_daemon.py \
  "$@" &

CHILD_PID=$!

# Capture the child's exit status without tripping `set -e` (wait on the RHS of
# `||` is exempt). A signal-initiated stop exits 0; any other non-zero child
# exit is a crash that must propagate so systemd sees failure and Restart fires.
status=0
wait "$CHILD_PID" || status=$?

if [[ "$SHUTDOWN_REQUESTED" -eq 1 ]]; then
  exit 0
fi

exit "$status"
