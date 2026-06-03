"""Shared container API constants."""

from datetime import timedelta


# How long cached directory trees and file indexes remain valid.
FILE_INDEX_CACHE_TTL = timedelta(minutes=1)


# Logging
LOG_REPLAY_BUFFER_SIZE = 1000
CONTAINER_API_LOG_FILENAME = "container_api.log"  # per-session container API log
