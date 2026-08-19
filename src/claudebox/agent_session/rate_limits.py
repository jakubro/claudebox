"""Per-workspace plan-limit state - written by the container, read by both container and daemon."""

import contextlib
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from filelock import FileLock, Timeout

from ..constants import CONFIG_DIR_NAME, FILE_LOCK_TIMEOUT_SECONDS, RATE_LIMITS_FILE
from ..core.io import read_json, write_json
from ..core.logging import get_logger


logger = get_logger(__name__)


class RateLimitStore:
    """Read/upsert per-workspace rate-limit entries, keyed by SDK `rate_limit_type`.

    Self-contained locking (no daemon dependency) since the container-side writer and the
    daemon-side reader both need it and `claudebox` core must not import `claudebox_daemon`.
    """

    VERSION = 1

    def __init__(self, workspace_path: Path) -> None:
        self._path = workspace_path / CONFIG_DIR_NAME / RATE_LIMITS_FILE

    def get(self) -> list[dict]:
        """Live entries as `{status, resets_at, rate_limit_type, utilization}`, reset ones pruned."""

        try:
            with self._locked():
                entries = self._load_live()
        except Timeout:
            logger.warning("Rate-limit store lock timed out on read", path=str(self._path))

            return []

        return [{**entry, "rate_limit_type": rtype} for rtype, entry in entries.items()]

    def set(
        self,
        rate_limit_type: str,
        *,
        status: str | None,
        resets_at: int | None,
        utilization: float | None,
    ) -> None:
        """Upsert one window's entry."""

        try:
            with self._locked():
                entries = self._load_live()
                entries[rate_limit_type] = {
                    "status": status,
                    "resets_at": resets_at,
                    "utilization": utilization,
                }
                self._save(entries)
        except Timeout:
            logger.warning("Rate-limit store lock timed out on write", path=str(self._path))

    def remove(self, rate_limit_type: str) -> None:
        """Drop one window's entry; no-op if absent."""

        try:
            with self._locked():
                entries = self._load_live()

                if rate_limit_type in entries:
                    del entries[rate_limit_type]
                    self._save(entries)
        except Timeout:
            logger.warning("Rate-limit store lock timed out on remove", path=str(self._path))

    # Internal
    # ----------------------------------------------------------------------------------------------

    def _load_live(self) -> dict[str, dict]:
        """Stored windows, keyed by rate_limit_type, minus anything past its own reset time."""

        raw = read_json(self._path, default={})

        if raw.get("version") != self.VERSION:
            return {}

        now = datetime.now(UTC).timestamp()

        return {
            rtype: entry
            for rtype, entry in raw.get("windows", {}).items()
            if entry.get("resets_at") is None or entry["resets_at"] > now
        }

    def _save(self, entries: dict[str, dict]) -> None:
        write_json(self._path, {"version": self.VERSION, "windows": entries})

    @contextlib.contextmanager
    def _locked(self) -> Iterator[None]:
        lock = FileLock(str(self._path) + ".lock", timeout=FILE_LOCK_TIMEOUT_SECONDS)

        with lock:
            yield
