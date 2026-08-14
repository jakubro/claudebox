"""Daemon-specific constants - health polling, shutdown, registry filenames."""

from datetime import timedelta

import httpx


# Registry filenames under each workspace's claudebox config dir.
DAEMON_STATE_FILE = "daemon-state.json"  # per-workspace container registry
UI_STATE_FILE = "ui-state.json"  # per-workspace UI state


# Container health - ongoing monitoring
CONTAINER_HEALTH_MONITOR_INTERVAL = timedelta(seconds=5)
CONTAINER_HEALTH_MAX_FAILURES = 3  # consecutive failures -> crashed

# Session mutation polling - detecting in-session content changes
SESSION_MUTATION_POLL_INTERVAL = timedelta(seconds=5)

# Container health - startup
CONTAINER_HEALTH_STARTUP_MAX_RETRIES = 30  # max poll attempts
CONTAINER_HEALTH_STARTUP_INTERVAL = timedelta(seconds=1)
CONTAINER_HEALTH_STARTUP_TIMEOUT = timedelta(seconds=3)  # per-attempt HTTP timeout

# Container lifecycle
# read exceeds the 1s SSE keepalive ping so healthy streams never trip it
CONTAINER_PROXY_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=30.0, pool=30.0)
CONTAINER_PROXY_LIMITS = httpx.Limits(max_connections=100, max_keepalive_connections=20)
CONTAINER_SESSION_REQUEST_TIMEOUT = timedelta(seconds=10)  # create/resume SDK calls

# Server
SERVER_PROCESS_TERMINATION_TIMEOUT = timedelta(seconds=5)  # subprocess wait after SIGTERM

# Watchdog - event-loop lag feeding systemd's WatchdogSec (see the unit file).
# 3x the interval tolerates one slow tick (GC pause, load) without a false unhealthy.
WATCHDOG_HEARTBEAT_INTERVAL = timedelta(seconds=5)
WATCHDOG_LAG_THRESHOLD = timedelta(seconds=15)

# Serving probe timeout sits above DISK_LISTING_TIMEOUT so a full-length listing isn't mistaken for a dead pool.
# Consecutive-failure requirement avoids restarting a daemon that's merely busy from one transient spike.
SERVING_PROBE_INTERVAL = timedelta(seconds=5)
SERVING_PROBE_TIMEOUT = timedelta(seconds=20)
SERVING_PROBE_MAX_FAILURES = 3

# Board watcher
BOARD_FILENAME = "board.yaml"
BOARD_WATCHER_POLL_INTERVAL = timedelta(seconds=5)
BOARD_WATCHER_DEBOUNCE_DELAY = timedelta(seconds=0.2)

# Disk listing - bounds board/session scans against a filesystem call that could hang (e.g. dead network mount).
DISK_LISTING_TIMEOUT = timedelta(seconds=15)
