"""Shared container API constants."""

from datetime import timedelta


# How long cached directory trees and file indexes remain valid.
FILE_INDEX_CACHE_TTL = timedelta(minutes=1)

# Floor on the file-index TTL, as a multiple of the last walk's cost.
# Caps time spent walking at roughly 1/N when a walk outlasts FILE_INDEX_CACHE_TTL.
FILE_INDEX_WALK_TTL_FACTOR = 10

# Persisted file index, relative to the workspace config directory.
PATH_INDEX_FILE = "path-index.json"

# How long a saved index is worth loading at all, not how long its contents are trusted -
# the in-memory TTL above keeps governing rebuilds once a load succeeds.
PATH_INDEX_LOAD_MAX_AGE = timedelta(hours=24)


# Logging
CONTAINER_API_LOG_FILENAME = "container_api.log"  # one per container, never per session
