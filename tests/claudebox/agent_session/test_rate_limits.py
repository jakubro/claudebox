"""Tests for claudebox.agent_session.rate_limits - per-workspace plan-limit store."""

import time
from pathlib import Path
from unittest.mock import patch

from filelock import FileLock

from claudebox.agent_session.rate_limits import RateLimitStore
from claudebox.core.io import write_json


def _make_store(tmp_path: Path) -> RateLimitStore:
    """Create a RateLimitStore rooted at a temp workspace."""

    (tmp_path / ".claudebox").mkdir(parents=True, exist_ok=True)

    return RateLimitStore(tmp_path)


class TestGetSetRemove:
    """Roundtrip through the file."""

    def test_get_empty(self, tmp_path):
        store = _make_store(tmp_path)

        assert store.get() == []

    def test_set_then_get(self, tmp_path):
        store = _make_store(tmp_path)
        store.set("five_hour", status="allowed_warning", resets_at=None, utilization=0.86)

        assert store.get() == [
            {
                "rate_limit_type": "five_hour",
                "status": "allowed_warning",
                "resets_at": None,
                "utilization": 0.86,
                "session_id": None,
            },
        ]

    def test_set_stamps_the_writing_session(self, tmp_path):
        store = _make_store(tmp_path)
        store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.5,
            session_id="session-a",
        )

        assert store.get()[0]["session_id"] == "session-a"

    def test_set_upserts_existing_window(self, tmp_path):
        store = _make_store(tmp_path)
        store.set("five_hour", status="allowed_warning", resets_at=None, utilization=0.5)
        store.set("five_hour", status="allowed_warning", resets_at=None, utilization=0.9)

        entries = store.get()
        assert len(entries) == 1
        assert entries[0]["utilization"] == 0.9

    def test_set_two_windows_independently(self, tmp_path):
        store = _make_store(tmp_path)
        store.set("five_hour", status="allowed_warning", resets_at=None, utilization=0.8)
        store.set("seven_day", status="allowed_warning", resets_at=None, utilization=0.9)

        types = {e["rate_limit_type"] for e in store.get()}
        assert types == {"five_hour", "seven_day"}

    def test_remove_drops_window(self, tmp_path):
        store = _make_store(tmp_path)
        store.set("five_hour", status="allowed_warning", resets_at=None, utilization=0.8)
        store.remove("five_hour")

        assert store.get() == []

    def test_remove_missing_window_noop(self, tmp_path):
        store = _make_store(tmp_path)
        store.remove("five_hour")  # never set - must not raise

        assert store.get() == []


class TestRemoveOwnership:
    """A session may only remove entries it wrote - the multi-session store-sharing guard."""

    def test_owner_session_id_removes_its_own_entry(self, tmp_path):
        store = _make_store(tmp_path)
        store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.8,
            session_id="session-a",
        )

        store.remove("five_hour", session_id="session-a")

        assert store.get() == []

    def test_other_session_id_leaves_the_entry_alone(self, tmp_path):
        store = _make_store(tmp_path)
        store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.8,
            session_id="session-a",
        )

        store.remove("five_hour", session_id="session-b")

        assert len(store.get()) == 1
        assert store.get()[0]["session_id"] == "session-a"

    def test_unconditional_remove_ignores_ownership(self, tmp_path):
        """The `session_id=None` form - an authoritative "allowed" signal - clears any owner."""

        store = _make_store(tmp_path)
        store.set(
            "five_hour",
            status="allowed_warning",
            resets_at=None,
            utilization=0.8,
            session_id="session-a",
        )

        store.remove("five_hour")

        assert store.get() == []

    def test_persists_across_instances(self, tmp_path):
        store = _make_store(tmp_path)
        store.set("seven_day", status="allowed_warning", resets_at=None, utilization=0.7)

        store2 = RateLimitStore(tmp_path)
        assert store2.get()[0]["rate_limit_type"] == "seven_day"


class TestExpiryAndVersion:
    """Pruning of reset windows and version-mismatch discard."""

    def test_prunes_entry_past_its_reset_time(self, tmp_path):
        store = _make_store(tmp_path)
        past = int(time.time()) - 10
        store.set("five_hour", status="allowed_warning", resets_at=past, utilization=0.9)

        assert store.get() == []

    def test_keeps_entry_before_its_reset_time(self, tmp_path):
        store = _make_store(tmp_path)
        future = int(time.time()) + 3600
        store.set("five_hour", status="allowed_warning", resets_at=future, utilization=0.9)

        assert len(store.get()) == 1

    def test_null_reset_never_expires(self, tmp_path):
        store = _make_store(tmp_path)
        store.set("five_hour", status="rejected", resets_at=None, utilization=None)

        assert len(store.get()) == 1

    def test_version_mismatch_discards_stored_windows(self, tmp_path):
        store = _make_store(tmp_path)
        write_json(
            store._path,
            {"version": 0, "windows": {"five_hour": {"status": "allowed_warning"}}},
        )

        assert store.get() == []


class TestLockContention:
    """A held lock degrades to best-effort rather than raising into the caller."""

    def test_get_returns_empty_when_lock_contended(self, tmp_path):
        store = _make_store(tmp_path)
        holder = FileLock(str(store._path) + ".lock")
        holder.acquire()

        try:
            with patch("claudebox.agent_session.rate_limits.FILE_LOCK_TIMEOUT_SECONDS", 0.2):
                started = time.monotonic()
                result = store.get()
                elapsed = time.monotonic() - started
        finally:
            holder.release()

        assert result == []
        assert elapsed < 5.0

    def test_set_is_a_noop_when_lock_contended(self, tmp_path):
        store = _make_store(tmp_path)
        holder = FileLock(str(store._path) + ".lock")
        holder.acquire()

        try:
            with patch("claudebox.agent_session.rate_limits.FILE_LOCK_TIMEOUT_SECONDS", 0.2):
                store.set("five_hour", status="allowed_warning", resets_at=None, utilization=0.9)
        finally:
            holder.release()

        assert store.get() == []
