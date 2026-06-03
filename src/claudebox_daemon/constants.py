"""Daemon-specific constants — health polling, shutdown, registry filenames."""

from datetime import timedelta

import httpx


# Registry filenames under each workspace's claudebox config dir.
DAEMON_STATE_FILE = "daemon-state.json"  # per-workspace container registry
UI_STATE_FILE = "ui-state.json"  # per-workspace UI state


# Container health — ongoing monitoring
CONTAINER_HEALTH_MONITOR_INTERVAL = timedelta(seconds=5)
CONTAINER_HEALTH_MONITOR_TIMEOUT = httpx.Timeout(10.0)
CONTAINER_HEALTH_MAX_FAILURES = 3  # consecutive failures → crashed

# Session mutation polling — detecting in-session content changes
SESSION_MUTATION_POLL_INTERVAL = timedelta(seconds=5)
SESSION_MUTATION_POLL_TIMEOUT = httpx.Timeout(10.0)

# Container health — startup
CONTAINER_HEALTH_STARTUP_MAX_RETRIES = 30  # max poll attempts
CONTAINER_HEALTH_STARTUP_INTERVAL = timedelta(seconds=1)
CONTAINER_HEALTH_STARTUP_TIMEOUT = timedelta(seconds=3)  # per-attempt HTTP timeout

# Container lifecycle
CONTAINER_PROXY_TIMEOUT = httpx.Timeout(connect=5.0, read=None, write=30.0, pool=30.0)
CONTAINER_SESSION_REQUEST_TIMEOUT = timedelta(seconds=10)  # create/resume SDK calls

# Server
SERVER_PROCESS_TERMINATION_TIMEOUT = timedelta(seconds=5)  # subprocess wait after SIGTERM

# Board watcher
BOARD_FILENAME = "board.yaml"
BOARD_WATCHER_POLL_INTERVAL = timedelta(seconds=5)
BOARD_WATCHER_DEBOUNCE_DELAY = timedelta(seconds=0.2)
