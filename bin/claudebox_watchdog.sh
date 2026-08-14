#!/bin/bash
# Claudebox daemon watchdog
set -euo pipefail

DAEMON_HEALTH_URL="${CLAUDEBOX_DAEMON_URL:-https://localhost:41820}/api/daemon/health"
DAEMON_UNIT="claudebox-daemon.service"
CHECK_ATTEMPTS=3
CHECK_DELAY_SECONDS=2

LAST_BODY=""

# One HTTP GET against the health endpoint - self-signed cert, short timeout.
is_healthy() {
  LAST_BODY="$(curl -sk --max-time 5 "$DAEMON_HEALTH_URL" 2>/dev/null)"
  grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' <<<"$LAST_BODY"
}

for ((attempt = 1; attempt <= CHECK_ATTEMPTS; attempt++)); do
  if is_healthy; then
    exit 0
  fi

  if ((attempt < CHECK_ATTEMPTS)); then
    sleep "$CHECK_DELAY_SECONDS"
  fi
done

echo "claudebox daemon unhealthy after ${CHECK_ATTEMPTS} checks - restarting ${DAEMON_UNIT}" >&2
echo "last health response: ${LAST_BODY:-<no response>}" >&2
systemctl --user restart "$DAEMON_UNIT"
