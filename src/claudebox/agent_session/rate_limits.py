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
        """Live entries, with reset ones pruned.

        Each is `{status, resets_at, rate_limit_type, utilization, session_id}`.
        """

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
        session_id: str | None = None,
    ) -> None:
        """Upsert one window's entry, stamped with the session that wrote it."""

        try:
            with self._locked():
                entries = self._load_live()
                entries[rate_limit_type] = {
                    "status": status,
                    "resets_at": resets_at,
                    "utilization": utilization,
                    "session_id": session_id,
                }
                self._save(entries)
        except Timeout:
            logger.warning("Rate-limit store lock timed out on write", path=str(self._path))

    def remove(self, rate_limit_type: str, *, session_id: str | None = None) -> None:
        """Drop one window's entry; no-op if absent, or if owned by a different session_id.

        `session_id=None` removes unconditionally - an "allowed" signal is account-wide.
        """

        try:
            with self._locked():
                entries = self._load_live()
                entry = entries.get(rate_limit_type)

                if entry is None:
                    return

                if session_id is not None and entry.get("session_id") != session_id:
                    return

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
