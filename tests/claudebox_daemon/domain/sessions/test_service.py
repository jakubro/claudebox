"""Tests for claudebox_daemon.domain.sessions.service - session lifecycle."""

from __future__ import annotations

import asyncio
import contextlib
import json
import sqlite3
import threading
import time
from collections.abc import Callable, Generator
from datetime import timedelta
from pathlib import Path
from time import time_ns
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

import claudebox_daemon.domain.sessions.service as service_module
from claudebox import SessionNotFound as SharedSessionNotFound
from claudebox import (
    SessionRepository,
    Workspace,
    claude_projects_root,
    read_json,
    write_json,
)
from claudebox.agent_session.runtime_claude import ClaudeRuntime
from claudebox.constants import SESSION_METADATA_FILE
from claudebox.paths import InvalidSessionId
from claudebox.session.models import SessionMetadata
from claudebox_daemon.domain.containers.errors import (
    BundleNotDeclared,
    ContainerTimeout,
    NetworkModeUnsupported,
)
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.errors import ListingTimeout, ValidationError
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.errors import (
    SessionContainerCreateFailed,
    SessionContainerInvalidId,
    SessionContainerResumeFailed,
    SessionContainerUnavailable,
    SessionNotFound,
    SessionNotSpawned,
    SessionTranscriptMissing,
    SiblingNotOwned,
    SiblingStopHostsThread,
    SpawnerUnreachable,
)
from claudebox_daemon.domain.sessions.models import SessionInfo
from claudebox_daemon.domain.sessions.service import SessionService, deliver_prompt
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


def _make_metadata(session_id: str, **overrides) -> SessionMetadata:
    """Create a SessionMetadata with sensible defaults."""
    defaults = {"session_id": session_id, "fork_point_cost_usd": 0.0}
    defaults.update(overrides)

    return SessionMetadata(**defaults)  # ty: ignore[invalid-argument-type]


def _make_container(
    container_id: str = "ctr-1",
    port: int = 8080,
    session_id: str | None = None,
    status: ContainerStatus = ContainerStatus.RUNNING,
    members: list[str] | None = None,
    live_session_ids: list[str] | None = None,
) -> Container:
    """Create a Container with sensible defaults."""

    return Container(
        id=container_id,
        backend_id="backend-1",
        port=port,
        status=status,
        session_id=session_id,
        members=members or [],
        live_session_ids=live_session_ids or [],
    )


def _make_service(tmp_path: Path) -> tuple[SessionService, MagicMock, MagicMock]:
    """Create a mocked SessionService; returns (service, mock_repo, mock_containers)."""

    (tmp_path / ".workspace").touch()
    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    containers = MagicMock()
    events = AsyncMock()
    executor = ObservedPool(1, name="listing")

    svc = SessionService(ws, containers, events, agent="claude", executor=executor)
    # Replace the real repo with a mock to avoid disk I/O
    svc._repo = MagicMock()

    return svc, svc._repo, containers


def _live_parent_container(containers: MagicMock, parent_id: str) -> Container:
    existing = _make_container("ctr-existing", session_id=parent_id)
    containers.find_by_session = AsyncMock(return_value=existing)
    containers.update = AsyncMock()

    return existing


@contextlib.contextmanager
def _posting_client() -> Generator[AsyncMock]:
    response = MagicMock()
    response.raise_for_status = MagicMock()

    with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as client_cls:
        client_cls.return_value = _async_client(post=AsyncMock(return_value=response))
        yield client_cls.return_value


@contextlib.contextmanager
def _forking_into_new_container(svc: SessionService, containers: MagicMock) -> Generator[None]:
    new_container = _make_container("ctr-new", session_id="will-be-overwritten")
    containers.find_by_session = AsyncMock()
    containers.create = AsyncMock(return_value=new_container)
    containers.update = AsyncMock()
    containers.get.return_value = new_container
    response = MagicMock()
    response.raise_for_status = MagicMock()

    with (
        patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as client_cls,
        patch.object(svc, "_wait_for_health", new=AsyncMock()),
    ):
        client_cls.return_value = _async_client(
            get=AsyncMock(return_value=response),
            post=AsyncMock(return_value=response),
        )
        yield


def _async_client(**calls) -> AsyncMock:
    client = AsyncMock(**calls)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    return client


# --- list_all ---


def _listed(listing) -> list[dict]:
    """Decode the rendered listing body back into its session rows."""

    return json.loads(listing.body)["sessions"]


class TestListAll:
    """Test listing all sessions with container enrichment."""

    @pytest.mark.anyio
    async def test_returns_empty_list(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = []
        containers.list_all.return_value = []

        result = await svc.list_all()

        assert _listed(result) == []
        assert result.session_count == 0

    @pytest.mark.anyio
    async def test_enriches_with_container_id(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("sess-1", name="first")
        repo.list_all.return_value = [meta]
        containers.list_all.return_value = [_make_container("ctr-1", session_id="sess-1")]

        result = await svc.list_all()

        rows = _listed(result)
        assert len(rows) == 1
        assert rows[0]["session_id"] == "sess-1"
        assert rows[0]["name"] == "first"
        assert rows[0]["container_id"] == "ctr-1"

    @pytest.mark.anyio
    async def test_container_id_none_when_no_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [_make_metadata("sess-1")]
        containers.list_all.return_value = []

        result = await svc.list_all()

        assert _listed(result)[0]["container_id"] is None

    @pytest.mark.anyio
    async def test_runs_on_the_daemon_executor_not_the_default_pool(self, tmp_path):
        """The per-session-directory walk must never share the default pool with other daemon-side blocking work."""

        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = []
        containers.list_all.return_value = []

        await svc.list_all()

        assert asyncio.get_running_loop()._default_executor is None  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_multiple_sessions(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [
            _make_metadata("sess-1"),
            _make_metadata("sess-2"),
        ]
        containers.list_all.return_value = [_make_container("ctr-1", session_id="sess-1")]

        rows = _listed(await svc.list_all())

        assert [r["container_id"] for r in rows] == ["ctr-1", None]

    @pytest.mark.anyio
    async def test_a_stopped_container_resolves_no_container_id(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [_make_metadata("sess-1")]
        containers.list_all.return_value = [
            _make_container("ctr-1", session_id="sess-1", status=ContainerStatus.STOPPED),
        ]

        rows = _listed(await svc.list_all())

        assert rows[0]["container_id"] is None

    @pytest.mark.anyio
    async def test_the_owner_wins_over_a_container_listing_the_session_as_a_member(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [_make_metadata("sess-1")]
        containers.list_all.return_value = [
            _make_container(
                "ctr-host",
                session_id="other",
                members=["sess-1"],
                live_session_ids=["other", "sess-1"],
            ),
            _make_container("ctr-own", session_id="sess-1"),
        ]

        rows = _listed(await svc.list_all())

        assert rows[0]["container_id"] == "ctr-own"

    @pytest.mark.anyio
    async def test_member_container_id_none_once_it_drops_out_of_the_live_set(self, tmp_path):
        """A stopped side thread stays a member forever - its container_id must not.

        Membership is addressability, not liveness: only the owner or a live session resolves.
        """

        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("side-1", parent_session_id="parent-1", is_side_thread=True)
        repo.list_all.return_value = [meta]
        containers.list_all.return_value = [
            _make_container(
                "ctr-1",
                session_id="parent-1",
                members=["side-1"],
                live_session_ids=["parent-1"],
            ),
        ]

        rows = _listed(await svc.list_all())

        assert rows[0]["container_id"] is None

    @pytest.mark.anyio
    async def test_member_container_id_set_while_in_the_live_set(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("side-1", parent_session_id="parent-1", is_side_thread=True)
        repo.list_all.return_value = [meta]
        containers.list_all.return_value = [
            _make_container(
                "ctr-1",
                session_id="parent-1",
                members=["side-1"],
                live_session_ids=["parent-1", "side-1"],
            ),
        ]

        rows = _listed(await svc.list_all())

        assert rows[0]["container_id"] == "ctr-1"

    @pytest.mark.anyio
    async def test_owner_container_id_set_regardless_of_the_live_set(self, tmp_path):
        """The owner's indicator is unaffected by the live-set mechanism, unlike a member's."""

        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [_make_metadata("parent-1")]
        containers.list_all.return_value = [
            _make_container("ctr-1", session_id="parent-1", live_session_ids=[]),
        ]

        rows = _listed(await svc.list_all())

        assert rows[0]["container_id"] == "ctr-1"

    @pytest.mark.anyio
    async def test_a_running_container_without_a_record_is_listed(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [_make_metadata("on-disk")]
        containers.list_all.return_value = [
            _make_container("ctr-new", session_id="spawned", status=ContainerStatus.STARTING),
            _make_container("ctr-gone", session_id="stopped", status=ContainerStatus.STOPPED),
        ]

        result = await svc.list_all()

        rows = _listed(result)
        assert [r["session_id"] for r in rows] == ["on-disk", "spawned"]
        assert rows[1]["container_id"] == "ctr-new"
        assert rows[1]["model"] == ClaudeRuntime.get_default_model()
        assert result.session_count == 2

    @pytest.mark.anyio
    async def test_records_are_built_off_the_event_loop(self, tmp_path):
        """Work proportional to the session count must never run on the loop that serves every route."""

        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [_make_metadata(f"sess-{i}") for i in range(3)]
        containers.list_all.return_value = []
        loop_thread = threading.current_thread()
        build_threads = []
        real_fromdict = SessionInfo.fromdict.__func__

        def _spy(cls, data):
            build_threads.append(threading.current_thread())

            return real_fromdict(cls, data)

        with patch.object(SessionInfo, "fromdict", classmethod(_spy)):
            await svc.list_all()

        assert len(build_threads) == 3
        assert loop_thread not in build_threads

    @pytest.mark.anyio
    async def test_concurrent_callers_share_one_build_and_one_body(self, tmp_path):
        """N tabs refetching together cost one build and one render, and all read the same bytes."""

        svc, repo, containers = _make_service(tmp_path)
        containers.list_all.return_value = []

        def _slow_scan():
            time.sleep(0.05)

            return [_make_metadata(f"sess-{i}") for i in range(3)]

        repo.list_all.side_effect = _slow_scan
        real_fromdict = SessionInfo.fromdict.__func__
        builds = []

        def _spy(cls, data):
            builds.append(data["session_id"])

            return real_fromdict(cls, data)

        with patch.object(SessionInfo, "fromdict", classmethod(_spy)):
            results = await asyncio.gather(*[svc.list_all() for _ in range(5)])

        assert len(builds) == 3
        assert len({id(r.body) for r in results}) == 1

    @pytest.mark.anyio
    async def test_a_hung_repo_scan_raises_listing_timeout_instead_of_blocking_forever(
        self,
        tmp_path,
        monkeypatch,
    ):
        """Offloading to the executor doesn't fix a genuine hang - the scan must still time out, or a stuck worker starves the shared pool."""

        monkeypatch.setattr(service_module, "DISK_LISTING_TIMEOUT", timedelta(seconds=0.05))
        svc, repo, _containers = _make_service(tmp_path)
        repo.list_all.side_effect = lambda: time.sleep(0.3)

        with pytest.raises(ListingTimeout):
            await svc.list_all()

    @pytest.mark.anyio
    async def test_a_timeout_records_that_the_scan_did_run(self, tmp_path, monkeypatch):
        """A bound wrapping a dispatch covers queueing too - the log must name which one fired."""

        monkeypatch.setattr(service_module, "DISK_LISTING_TIMEOUT", timedelta(seconds=0.05))
        svc, repo, _containers = _make_service(tmp_path)
        repo.list_all.side_effect = lambda: time.sleep(0.3)

        with pytest.raises(ListingTimeout):
            await svc.list_all()

        assert svc._admission.started is True

    @pytest.mark.anyio
    async def test_a_timeout_records_a_scan_that_never_reached_a_worker(
        self,
        tmp_path,
        monkeypatch,
    ):
        """Admission failure and execution failure logged the same line; only this tells them apart."""

        monkeypatch.setattr(service_module, "DISK_LISTING_TIMEOUT", timedelta(seconds=0.05))
        svc, _repo, _containers = _make_service(tmp_path)
        release = threading.Event()
        # The service's pool has one worker; occupying it means the scan is only ever queued.
        svc._executor.submit(release.wait)

        try:
            with pytest.raises(ListingTimeout):
                await svc.list_all()

            assert svc._admission.started is False
            assert svc._admission.queued_seconds > 0
        finally:
            release.set()

    @pytest.mark.anyio
    async def test_concurrent_listings_share_one_scan(self, tmp_path):
        """Ten tabs refetching on one broadcast is one question - N walks would occupy N workers."""

        svc, repo, containers = _make_service(tmp_path)
        containers.list_all.return_value = []
        scans = []

        def _slow_scan():
            scans.append(1)
            time.sleep(0.05)

            return []

        repo.list_all.side_effect = _slow_scan

        results = await asyncio.gather(*[svc.list_all() for _ in range(10)])

        assert len(scans) == 1
        assert all(_listed(r) == [] for r in results)

    @pytest.mark.anyio
    async def test_a_later_listing_still_gets_a_fresh_scan(self, tmp_path):
        """Sharing is only for calls in flight together - a later caller must not be served a cached answer."""

        svc, repo, containers = _make_service(tmp_path)
        containers.list_all.return_value = []
        repo.list_all.return_value = []

        await svc.list_all()
        await svc.list_all()

        assert repo.list_all.call_count == 2

    @pytest.mark.anyio
    async def test_a_successful_scan_logs_queue_and_scan_seconds(self, tmp_path):
        """A slow-but-successful scan must still say where its time went."""

        svc, repo, containers = _make_service(tmp_path)
        containers.list_all.return_value = []
        repo.list_all.return_value = []
        logged = []
        svc._logger = MagicMock()
        svc._logger.info = lambda event, **kw: logged.append((event, kw))

        await svc.list_all()

        scanned = next(kw for event, kw in logged if event == "session_listing_scanned")
        assert scanned["queued_seconds"] >= 0
        assert scanned["scan_seconds"] >= 0
        assert "pool" in scanned
        assert scanned["workspace"]["id"] == "test-ws"

    def test_log_listing_completed_reports_the_handler_measured_fields(self, tmp_path):
        """The byte count and end-to-end duration only exist in the handler - this is where they land."""

        svc, _repo, _containers = _make_service(tmp_path)
        logged = []
        svc._logger = MagicMock()
        svc._logger.info = lambda event, **kw: logged.append((event, kw))

        svc.log_listing_completed(session_count=3, response_bytes=512, total_seconds=1.2345)

        event, kw = logged[0]
        assert event == "session_listing_completed"
        assert kw["session_count"] == 3
        assert kw["response_bytes"] == 512
        assert kw["total_seconds"] == pytest.approx(1.234)
        assert kw["workspace"]["id"] == "test-ws"


class TestListingPreviews:
    """The listing carries first and last messages as previews; session.json keeps them whole."""

    @staticmethod
    async def _rows(tmp_path, *metadata) -> list[dict]:
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = list(metadata)
        containers.list_all.return_value = []

        return _listed(await svc.list_all())

    @pytest.mark.anyio
    async def test_a_long_message_is_cut_to_300_characters_and_marked(self, tmp_path):
        (row,) = await self._rows(
            tmp_path,
            _make_metadata("s-1", first_message="short first", last_message="x" * 5000),
        )

        assert row["last_message"] == "x" * 300 + "..."
        assert row["first_message"] == "short first"

    @pytest.mark.anyio
    async def test_a_message_of_exactly_300_characters_is_untouched(self, tmp_path):
        (row,) = await self._rows(tmp_path, _make_metadata("s-1", first_message="y" * 300))

        assert row["first_message"] == "y" * 300

    @pytest.mark.anyio
    async def test_equal_messages_leave_no_last_message(self, tmp_path):
        (row,) = await self._rows(
            tmp_path,
            _make_metadata("s-1", first_message="z" * 900, last_message="z" * 900),
        )

        assert row["first_message"] == "z" * 300 + "..."
        assert row["last_message"] is None

    @pytest.mark.anyio
    async def test_messages_sharing_a_long_prefix_keep_both_rows(self, tmp_path):
        (row,) = await self._rows(
            tmp_path,
            _make_metadata(
                "s-1",
                first_message="p" * 300 + " first tail",
                last_message="p" * 300 + " last tail",
            ),
        )

        assert row["first_message"] == "p" * 300 + "..."
        assert row["last_message"] == "p" * 299 + "..."

    @pytest.mark.anyio
    async def test_a_slash_command_keeps_its_tags_and_the_start_of_its_arguments(self, tmp_path):
        command = (
            "<command-message>review</command-message>\n<command-name>/review</command-name>\n"
            f"<command-args>{'a' * 2000}</command-args>"
        )

        (row,) = await self._rows(tmp_path, _make_metadata("s-1", last_message=command))

        preview = row["last_message"]
        assert len(preview) == 303
        assert preview.startswith(
            "<command-message>review</command-message>\n<command-name>/review</command-name>\n"
            "<command-args>aaa",
        )
        assert preview.endswith("a...</command-args>")

    @pytest.mark.anyio
    async def test_a_command_with_long_text_around_its_tags_is_cut_as_plain_text(self, tmp_path):
        command = (
            "q" * 400 + "<command-name>/review</command-name>\n<command-args>args</command-args>"
        )

        (row,) = await self._rows(tmp_path, _make_metadata("s-1", last_message=command))

        assert row["last_message"] == "q" * 300 + "..."


class TestListingWarmup:
    """Starting the service reads the workspace's records once, so the first listing finds them cached."""

    @pytest.mark.anyio
    async def test_start_fills_the_record_cache_without_a_listing_request(
        self,
        tmp_path,
        monkeypatch,
    ):
        monkeypatch.setattr(
            "claudebox.core.file_cache.time_ns",
            lambda: time_ns() + 3600 * 10**9,
        )
        (tmp_path / ".workspace").touch()
        record = (
            tmp_path / ".claudebox" / "sessions" / "20260101-000000--s-1" / SESSION_METADATA_FILE
        )
        record.parent.mkdir(parents=True)
        write_json(record, {"session_id": "s-1", "fork_point_cost_usd": 0.0})
        containers = MagicMock()
        containers.list_all.return_value = []
        svc = SessionService(
            RegisteredWorkspace(id="test-ws", path=tmp_path),
            containers,
            AsyncMock(),
            agent="claude",
            executor=ObservedPool(1, name="listing"),
        )

        await svc.start()
        warmup = svc._warmup
        assert warmup is not None
        await warmup

        with patch("claudebox.session.repository.read_json", wraps=read_json) as reads:
            listing = await svc.list_all()

        assert reads.call_count == 0
        assert [r["session_id"] for r in json.loads(listing.body)["sessions"]] == ["s-1"]
        await svc.stop()

    @pytest.mark.anyio
    async def test_a_listing_during_warmup_joins_its_scan(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        containers.list_all.return_value = []

        def _slow_scan():
            time.sleep(0.05)

            return []

        repo.list_all.side_effect = _slow_scan

        await svc.start()
        await svc.list_all()

        assert repo.list_all.call_count == 1
        await svc.stop()

    @pytest.mark.anyio
    async def test_stop_during_warmup_cancels_it_quietly(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        containers.list_all.return_value = []
        release = threading.Event()
        repo.list_all.side_effect = lambda: release.wait(5) and []

        await svc.start()

        try:
            await svc.stop()
        finally:
            release.set()

        assert svc._warmup is None

    @pytest.mark.anyio
    async def test_a_failed_warmup_is_logged_and_leaves_listing_working(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        containers.list_all.return_value = []
        repo.list_all.side_effect = [OSError("disk gone"), []]
        svc._logger = MagicMock()

        await svc.start()
        warmup = svc._warmup
        assert warmup is not None
        await warmup

        svc._logger.exception.assert_called_once()
        assert json.loads((await svc.list_all()).body) == {"sessions": []}
        await svc.stop()


# --- list_schedules ---


def _write_schedule_log(tmp_path: Path, session_id: str, *, schedules: bool = True) -> Path:
    path = Workspace(tmp_path).ensure_session(session_id).path / "events.jsonl"
    records: list[dict] = [
        {"type": "user", "subtype": "text", "is_human": True, "turn_id": "t1", "ts": "a"},
    ]

    if schedules:
        records += [
            {
                "type": "assistant",
                "subtype": "tool_use",
                "content": "CronCreate",
                "tool_use_id": f"c-{session_id}",
                "tool_input": {"cron": "0 9 * * *", "prompt": session_id},
                "ts": "b",
            },
        ]

    path.write_text("".join(json.dumps(r) + "\n" for r in records))

    return path


def _scheduled(listing) -> list[str]:
    return sorted(s["session_id"] for s in json.loads(listing.body)["sessions"])


class TestListSchedules:
    """Every running session's schedule events, from its log, on the listing pool."""

    @pytest.mark.anyio
    async def test_lists_running_and_starting_owners_and_a_live_member(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        for sid in ("owner-run", "owner-start", "member-live"):
            _write_schedule_log(tmp_path, sid)

        containers.list_all.return_value = [
            _make_container(
                "c1",
                session_id="owner-run",
                members=["member-live"],
                live_session_ids=["owner-run", "member-live"],
            ),
            _make_container("c2", session_id="owner-start", status=ContainerStatus.STARTING),
        ]

        listing = await svc.list_schedules()

        assert _scheduled(listing) == ["member-live", "owner-run", "owner-start"]
        assert listing.session_count == 3

    @pytest.mark.anyio
    async def test_leaves_out_sessions_whose_schedules_cannot_fire(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        for sid in ("owner", "member-gone", "stopping", "stopped", "crashed", "no-container"):
            _write_schedule_log(tmp_path, sid)

        containers.list_all.return_value = [
            _make_container(
                "c1",
                session_id="owner",
                members=["member-gone"],
                live_session_ids=["owner"],
            ),
            _make_container("c2", session_id="stopping", status=ContainerStatus.STOPPING),
            _make_container("c3", session_id="stopped", status=ContainerStatus.STOPPED),
            _make_container("c4", session_id="crashed", status=ContainerStatus.CRASHED),
        ]

        assert _scheduled(await svc.list_schedules()) == ["owner"]

    @pytest.mark.anyio
    async def test_leaves_out_a_running_session_that_never_scheduled(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        _write_schedule_log(tmp_path, "quiet", schedules=False)
        containers.list_all.return_value = [_make_container("c1", session_id="quiet")]

        assert _scheduled(await svc.list_schedules()) == []

    @pytest.mark.anyio
    async def test_runs_on_the_listing_pool(self, tmp_path, monkeypatch):
        svc, _repo, containers = _make_service(tmp_path)
        _write_schedule_log(tmp_path, "owner")
        containers.list_all.return_value = [_make_container("c1", session_id="owner")]
        threads = []
        real_read = svc._schedule_index.read

        def _spy(path):
            threads.append(threading.current_thread().name)

            return real_read(path)

        monkeypatch.setattr(svc._schedule_index, "read", _spy)

        await svc.list_schedules()

        assert threads and all(name.startswith("daemon-listing") for name in threads)

    @pytest.mark.anyio
    async def test_concurrent_callers_share_one_job(self, tmp_path, monkeypatch):
        svc, _repo, containers = _make_service(tmp_path)
        _write_schedule_log(tmp_path, "owner")
        containers.list_all.return_value = [_make_container("c1", session_id="owner")]
        reads = []
        real_read = svc._schedule_index.read

        def _slow(path):
            reads.append(path)
            time.sleep(0.05)

            return real_read(path)

        monkeypatch.setattr(svc._schedule_index, "read", _slow)

        results = await asyncio.gather(*[svc.list_schedules() for _ in range(5)])

        assert len(reads) == 1
        assert len({id(r.body) for r in results}) == 1

    @pytest.mark.anyio
    async def test_a_hung_read_raises_listing_timeout(self, tmp_path, monkeypatch):
        monkeypatch.setattr(service_module, "DISK_LISTING_TIMEOUT", timedelta(seconds=0.05))
        svc, _repo, containers = _make_service(tmp_path)
        _write_schedule_log(tmp_path, "owner")
        containers.list_all.return_value = [_make_container("c1", session_id="owner")]
        monkeypatch.setattr(svc._schedule_index, "read", lambda path: time.sleep(0.3))

        with pytest.raises(ListingTimeout):
            await svc.list_schedules()

    @pytest.mark.anyio
    async def test_the_sessions_listing_opens_no_event_log(self, tmp_path, monkeypatch):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [_make_metadata("owner")]
        containers.list_all.return_value = [_make_container("c1", session_id="owner")]
        _write_schedule_log(tmp_path, "owner")
        opened = []
        real_open = open

        def _spy_open(file, *args, **kwargs):
            opened.append(str(file))

            return real_open(file, *args, **kwargs)

        monkeypatch.setattr("builtins.open", _spy_open)

        await svc.list_all()

        assert not [path for path in opened if path.endswith("events.jsonl")]


# --- get ---


class TestGet:
    """Test session lookup by ID."""

    @pytest.mark.anyio
    async def test_returns_session_info_with_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1", name="my session")
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-1", session_id="sess-1"),
        )

        result = await svc.get("sess-1")

        assert isinstance(result, SessionInfo)
        assert result.session_id == "sess-1"
        assert result.name == "my session"
        assert result.container_id == "ctr-1"

    @pytest.mark.anyio
    async def test_returns_session_info_without_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        containers.find_by_session = AsyncMock(return_value=None)

        result = await svc.get("sess-1")

        assert result.container_id is None

    @pytest.mark.anyio
    async def test_member_container_id_none_once_it_drops_out_of_the_live_set(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata(
            "side-1",
            parent_session_id="parent-1",
            is_side_thread=True,
        )
        containers.find_by_session = AsyncMock(
            return_value=_make_container(
                "ctr-1",
                session_id="parent-1",
                members=["side-1"],
                live_session_ids=["parent-1"],
            ),
        )

        result = await svc.get("side-1")

        assert result.container_id is None

    @pytest.mark.anyio
    async def test_raises_session_not_found(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = SharedSessionNotFound(
            "sess-missing",
        )

        with pytest.raises(SessionNotFound) as exc_info:
            await svc.get("sess-missing")

        assert exc_info.value.context["session_id"] == "sess-missing"

    @pytest.mark.anyio
    async def test_raises_validation_error_for_a_malformed_id(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = InvalidSessionId("sess/../evil")

        with pytest.raises(ValidationError) as exc_info:
            await svc.get("sess/../evil")

        assert exc_info.value.context["session_id"] == "sess/../evil"


# --- update ---


class TestUpdate:
    """Test session metadata updates."""

    @pytest.mark.anyio
    async def test_updates_and_returns_session(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        # After update, get is called which calls repo.get
        repo.get.return_value = _make_metadata("sess-1", name="updated")
        containers.find_by_session = AsyncMock(return_value=None)

        result = await svc.update("sess-1", name="updated")

        repo.update.assert_called_once_with(
            "sess-1",
            name="updated",
        )
        assert result.session_id == "sess-1"
        assert result.name == "updated"

    @pytest.mark.anyio
    async def test_raises_session_not_found(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.update.side_effect = SharedSessionNotFound(
            "sess-missing",
        )

        with pytest.raises(SessionNotFound) as exc_info:
            await svc.update("sess-missing", name="x")

        assert exc_info.value.context["session_id"] == "sess-missing"

    @pytest.mark.anyio
    async def test_raises_validation_error_for_a_malformed_id(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.update.side_effect = InvalidSessionId("sess/../evil")

        with pytest.raises(ValidationError) as exc_info:
            await svc.update("sess/../evil", name="x")

        assert exc_info.value.context["session_id"] == "sess/../evil"


# --- create ---


class TestCreate:
    """Test new session creation with container spawn and HTTP init."""

    @pytest.mark.anyio
    async def test_creates_session_and_container(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-new", port=9090)
        containers.create = AsyncMock(return_value=container)
        containers.update = AsyncMock()
        containers.get.return_value = container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"session_id": "sess-1"}

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create()

        assert isinstance(result, SessionInfo)
        assert result.container_id == "ctr-new"
        assert result.session_id  # UUID string
        # Footer-relevant fields populated for create-response echo
        assert result.workspace == str(tmp_path)
        assert result.session_dir is not None
        assert result.effort_level == "xhigh"
        assert result.model == "claude-opus-5-5"
        assert result.permission_mode == "default"
        assert result.num_turns == 0
        assert result.total_cost_usd == pytest.approx(0.0)
        containers.create.assert_awaited_once()
        mock_client.post.assert_awaited_once()
        post_url = mock_client.post.call_args[0][0]
        assert post_url.endswith("/api/sessions/new")
        # The spawn's claim is released once the session owns the container.
        containers.release_spawn.assert_called_once_with("ctr-new")

    @pytest.mark.anyio
    async def test_create_uses_container_session_id(self, tmp_path):
        """Session ID comes from the container's /api/sessions/new response."""

        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-1")
        containers.create = AsyncMock(return_value=container)
        containers.update = AsyncMock()
        containers.get.return_value = container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"session_id": "container-generated-id"}

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create()

        assert result.session_id == "container-generated-id"

    @pytest.mark.anyio
    async def test_refuses_a_malformed_container_minted_id_naming_the_container(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-bad")
        containers.create = AsyncMock(return_value=container)
        containers.get.return_value = container
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()
        mock_response.json.return_value = {"session_id": "../evil"}

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            with pytest.raises(SessionContainerInvalidId) as exc_info:
                await svc.create()

        assert exc_info.value.context["container_id"] == "ctr-bad"
        containers.update.assert_not_called()
        containers.stop_container.assert_awaited_once_with("ctr-bad")
        containers.remove.assert_awaited_once_with("ctr-bad")


class TestCreateCleansUpOnFailure:
    """A create that fails after spawning removes the container it spawned."""

    @pytest.mark.anyio
    async def test_health_timeout_removes_the_spawned_container(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-new")
        containers.create = AsyncMock(return_value=container)
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        with (
            patch.object(
                svc,
                "_wait_for_health",
                new=AsyncMock(side_effect=ContainerTimeout(container_id="ctr-new")),
            ),
            pytest.raises(ContainerTimeout),
        ):
            await svc.create()

        containers.stop_container.assert_awaited_once_with("ctr-new")
        containers.remove.assert_awaited_once_with("ctr-new")
        containers.release_spawn.assert_called_once_with("ctr-new")

    @pytest.mark.anyio
    async def test_container_error_response_removes_the_spawned_container(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-new")
        containers.create = AsyncMock(return_value=container)
        containers.get.return_value = container
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        healthy_response = MagicMock()
        healthy_response.raise_for_status = MagicMock()

        error_response = MagicMock()
        error_response.status_code = 500
        error_response.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                "boom",
                request=MagicMock(),
                response=error_response,
            ),
        )

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                get=AsyncMock(return_value=healthy_response),
                post=AsyncMock(return_value=error_response),
            )
            mock_client_cls.return_value = mock_client

            with pytest.raises(SessionContainerCreateFailed) as exc_info:
                await svc.create()

        assert exc_info.value.context["container_id"] == "ctr-new"
        containers.stop_container.assert_awaited_once_with("ctr-new")
        containers.remove.assert_awaited_once_with("ctr-new")

    @pytest.mark.anyio
    async def test_cancellation_still_cleans_up(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-new")
        containers.create = AsyncMock(return_value=container)
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        with (
            patch.object(
                svc,
                "_wait_for_health",
                new=AsyncMock(side_effect=asyncio.CancelledError()),
            ),
            pytest.raises(asyncio.CancelledError),
        ):
            await svc.create()

        containers.stop_container.assert_awaited_once_with("ctr-new")
        containers.remove.assert_awaited_once_with("ctr-new")

    @pytest.mark.anyio
    async def test_a_cleanup_failure_does_not_replace_the_original_error(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-new")
        containers.create = AsyncMock(return_value=container)
        containers.stop_container = AsyncMock(side_effect=RuntimeError("stop failed"))
        containers.remove = AsyncMock()

        with (
            patch.object(
                svc,
                "_wait_for_health",
                new=AsyncMock(side_effect=ContainerTimeout(container_id="ctr-new")),
            ),
            pytest.raises(ContainerTimeout),
        ):
            await svc.create()


# --- create_with_prompt ---


class TestCreateWithPrompt:
    """Test the spawn socket's create-then-inject sequence (shared with BoardService.assign)."""

    @staticmethod
    def _mocked_create(containers):
        """Patch the httpx client so create() succeeds, matching TestCreate's own pattern."""

        container = _make_container("ctr-spawn", port=9090)
        containers.create = AsyncMock(return_value=container)
        containers.update = AsyncMock()
        containers.get.return_value = container
        containers.send = AsyncMock(return_value={})

        return patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient")

    @pytest.mark.anyio
    async def test_creates_a_session_and_delivers_the_prompt(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        with self._mocked_create(containers) as mock_client_cls:
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"session_id": "sess-1"}
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompt("why this branch?")

        assert result.container_id == "ctr-spawn"
        containers.send.assert_awaited_once_with(
            container_id="ctr-spawn",
            method="POST",
            endpoint="api/send",
            payload={"prompt": "why this branch?"},
        )

    @pytest.mark.anyio
    async def test_records_claimed_lineage_on_disk_without_verifying_it(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        with self._mocked_create(containers) as mock_client_cls:
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"session_id": "sess-1"}
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompt(
                "why this branch?",
                spawned_from_session_id="claimed-spawner",
            )

        assert result.spawned_from_session_id == "claimed-spawner"
        path = Workspace(tmp_path).ensure_session(result.session_id).path / SESSION_METADATA_FILE
        on_disk = read_json(path, default={})
        assert on_disk["spawned_from_session_id"] == "claimed-spawner"

    @pytest.mark.anyio
    async def test_no_lineage_field_written_when_not_spawned(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        with self._mocked_create(containers) as mock_client_cls:
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"session_id": "sess-1"}
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompt("hello")

        assert result.spawned_from_session_id is None
        path = Workspace(tmp_path).ensure_session(result.session_id).path / SESSION_METADATA_FILE
        assert not path.exists()

    @pytest.mark.anyio
    async def test_a_failed_prompt_delivery_does_not_strand_the_created_session(self, tmp_path):
        """The session must still come back usable - see deliver_prompt's own swallow behavior."""

        svc, _repo, containers = _make_service(tmp_path)

        with self._mocked_create(containers) as mock_client_cls:
            containers.send = AsyncMock(side_effect=RuntimeError("boom"))
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"session_id": "sess-1"}
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompt("hello")

        assert result.container_id == "ctr-spawn"


# --- create_with_prompts ---


class TestCreateWithPrompts:
    """Test creating a session and delivering several prompts to it, in order."""

    @pytest.mark.anyio
    async def test_delivers_every_prompt_in_order(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        with TestCreateWithPrompt._mocked_create(containers) as mock_client_cls:
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"session_id": "sess-1"}
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompts(["first", "second"])

        assert result.container_id == "ctr-spawn"
        assert [call.kwargs["payload"] for call in containers.send.await_args_list] == [
            {"prompt": "first"},
            {"prompt": "second"},
        ]
        assert result.failed_prompts is None

    @pytest.mark.anyio
    async def test_reports_which_prompts_did_not_arrive(self, tmp_path):
        """A multi-prompt create must name which ones failed, not just that something did."""

        svc, _repo, containers = _make_service(tmp_path)

        with TestCreateWithPrompt._mocked_create(containers) as mock_client_cls:
            containers.send = AsyncMock(
                side_effect=[{}, RuntimeError("boom"), {}],
            )
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"session_id": "sess-1"}
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompts(["first", "second", "third"])

        assert result.container_id == "ctr-spawn"
        assert result.failed_prompts == ["second"]

    @pytest.mark.anyio
    async def test_success_path_reports_no_failed_prompts(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        with TestCreateWithPrompt._mocked_create(containers) as mock_client_cls:
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_response.json.return_value = {"session_id": "sess-1"}
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompts(["first", "second"])

        assert result.failed_prompts is None


# --- deliver_prompt ---


class TestDeliverPrompt:
    """Test the shared prompt-injection helper directly."""

    @pytest.mark.anyio
    async def test_sends_the_prompt_payload(self):
        containers = MagicMock()
        containers.send = AsyncMock(return_value={})
        logger = MagicMock()

        delivered = await deliver_prompt(logger, containers, "ctr-1", "hello", session_id="sess-1")

        assert delivered is True
        containers.send.assert_awaited_once_with(
            container_id="ctr-1",
            method="POST",
            endpoint="api/send",
            payload={"prompt": "hello"},
        )
        logger.warning.assert_not_called()

    @pytest.mark.anyio
    async def test_a_send_failure_is_logged_swallowed_and_reported(self):
        containers = MagicMock()
        containers.send = AsyncMock(side_effect=RuntimeError("boom"))
        logger = MagicMock()

        delivered = await deliver_prompt(logger, containers, "ctr-1", "hello", session_id="sess-1")

        assert delivered is False
        logger.warning.assert_called_once()
        kwargs = logger.warning.call_args.kwargs
        assert kwargs["prompt"] == "hello"
        assert kwargs["container_id"] == "ctr-1"
        assert kwargs["session_id"] == "sess-1"


# --- compute_spawn_depth ---


class TestComputeSpawnDepth:
    """Test the spawn-ancestry walk the socket's depth cap relies on."""

    def test_a_root_session_has_depth_zero(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("root")

        assert svc.compute_spawn_depth("root") == 0

    def test_one_spawn_hop_is_depth_one(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = [
            _make_metadata("child", spawned_from_session_id="root"),
            _make_metadata("root"),
        ]

        assert svc.compute_spawn_depth("child") == 1

    def test_a_fork_hop_does_not_count(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = [
            _make_metadata("forked", parent_session_id="root"),
            _make_metadata("root"),
        ]

        assert svc.compute_spawn_depth("forked") == 0

    def test_a_fork_of_a_spawned_session_inherits_its_spawners_depth(self, tmp_path):
        """root -> spawn -> child(depth 1) -> fork -> forkedChild; forkedChild sits at depth 1
        too, and spawning from it would be the spawner's next hop, not a fresh chain."""

        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = [
            _make_metadata("forkedChild", parent_session_id="child"),
            _make_metadata("child", spawned_from_session_id="root"),
            _make_metadata("root"),
        ]

        assert svc.compute_spawn_depth("forkedChild") == 1

    def test_returns_none_when_the_callers_own_record_is_unreadable(self, tmp_path):
        """Fail closed: an unreadable caller record is exactly what a laundering attempt
        produces, so it refuses rather than defaulting to depth zero."""

        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = SharedSessionNotFound(session_id="caller")

        assert svc.compute_spawn_depth("caller") is None

    def test_returns_none_when_the_callers_own_id_is_malformed(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = InvalidSessionId("caller")

        assert svc.compute_spawn_depth("caller") is None

    def test_a_missing_ancestor_mid_walk_ends_the_walk_instead_of_failing(self, tmp_path):
        """A deleted ancestor must not jam an otherwise legitimate chain."""

        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = [
            _make_metadata("child", spawned_from_session_id="deleted-root"),
            SharedSessionNotFound(session_id="deleted-root"),
        ]

        assert svc.compute_spawn_depth("child") == 1

    def test_a_malformed_claimed_ancestor_mid_walk_ends_the_walk_instead_of_failing(self, tmp_path):
        """A laundered spawned_from_session_id must end the walk like a missing ancestor,
        not crash the depth cap it exists to enforce."""

        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = [
            _make_metadata("child", spawned_from_session_id="../evil"),
            InvalidSessionId("../evil"),
        ]

        assert svc.compute_spawn_depth("child") == 1

    def test_a_three_hop_spawn_chain_reaches_the_default_cap(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = [
            _make_metadata("great-grandchild", spawned_from_session_id="grandchild"),
            _make_metadata("grandchild", spawned_from_session_id="child"),
            _make_metadata("child", spawned_from_session_id="root"),
            _make_metadata("root"),
        ]

        assert svc.compute_spawn_depth("great-grandchild") == 3


# --- resume ---


class TestResume:
    """Test session resume - reuses existing container or spawns new."""

    @pytest.mark.anyio
    async def test_returns_existing_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        existing = _make_container("ctr-existing", session_id="sess-1")
        containers.find_by_session = AsyncMock(return_value=existing)
        repo.get.return_value = _make_metadata("sess-1")

        with _reporting(svc, primary="sess-1"):
            result = await svc.resume("sess-1")

        assert isinstance(result, SessionInfo)
        assert result.session_id == "sess-1"
        assert result.container_id == "ctr-existing"
        assert result.workspace == str(tmp_path)
        assert result.effort_level == "xhigh"
        containers.create.assert_not_called()

    @pytest.mark.anyio
    async def test_raises_validation_error_for_a_malformed_id(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = InvalidSessionId("sess/../evil")

        with pytest.raises(ValidationError) as exc_info:
            await svc.resume("sess/../evil")

        assert exc_info.value.context["session_id"] == "sess/../evil"

    @pytest.mark.anyio
    async def test_spawns_new_container_when_none_exists(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        containers.find_by_session = AsyncMock(return_value=None)
        new_container = _make_container("ctr-new", port=9090)
        containers.create = AsyncMock(return_value=new_container)
        containers.get.return_value = new_container
        repo.get.return_value = _make_metadata("sess-1")

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.resume("sess-1")

        assert isinstance(result, SessionInfo)
        assert result.session_id == "sess-1"
        assert result.container_id == "ctr-new"
        assert result.workspace == str(tmp_path)
        assert result.effort_level == "xhigh"
        containers.create.assert_awaited_once_with(
            session_id="sess-1",
            bundle=None,
        )
        mock_client.post.assert_awaited_once()
        post_url = mock_client.post.call_args[0][0]
        assert "/api/sessions/sess-1/resume" in post_url

    @pytest.mark.anyio
    async def test_side_thread_joins_parents_container_as_member(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata(
            "thread-1",
            parent_session_id="parent-1",
            is_side_thread=True,
        )
        parent_container = _make_container("ctr-parent", session_id="parent-1")
        containers.find_by_session = AsyncMock(return_value=parent_container)
        containers.update = AsyncMock()

        with _posting_client() as mock_client:
            result = await svc.resume("thread-1")

        assert result.container_id == "ctr-parent"
        containers.find_by_session.assert_awaited_once_with("parent-1", sync=True)
        containers.update.assert_awaited_once_with(parent_container, members=["thread-1"])
        mock_client.post.assert_awaited_once()
        post_args, post_kwargs = mock_client.post.call_args
        assert "/api/sessions/thread-1/resume" in post_args[0]
        assert post_kwargs["params"] == {"primary": "false"}

    @pytest.mark.anyio
    async def test_side_thread_already_a_member_does_not_re_append(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata(
            "thread-1",
            parent_session_id="parent-1",
            is_side_thread=True,
        )
        parent_container = _make_container(
            "ctr-parent",
            session_id="parent-1",
            members=["thread-1"],
        )
        containers.find_by_session = AsyncMock(return_value=parent_container)
        containers.update = AsyncMock()

        with _posting_client():
            await svc.resume("thread-1")

        containers.update.assert_not_called()

    @pytest.mark.anyio
    async def test_side_thread_with_no_parent_container_raises_and_creates_nothing(self, tmp_path):
        """A reply to a side thread whose parent has stopped fails clean - it must never reach
        create() and become an owner in its own right."""

        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata(
            "thread-1",
            parent_session_id="parent-1",
            is_side_thread=True,
        )
        containers.find_by_session = AsyncMock(return_value=None)
        containers.create = AsyncMock()

        with pytest.raises(SessionContainerUnavailable):
            await svc.resume("thread-1")

        containers.create.assert_not_called()


def _reporting(svc: SessionService, *, primary: str | None, live: list[str] | None = None):
    """Stub the health wait with a container report naming `primary` and `live`."""

    report = {"session_id": primary, "live_session_ids": live if live is not None else []}

    return patch.object(svc, "_wait_for_health", new=AsyncMock(return_value=report))


def _answer(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "http://localhost:8080/api"))


class TestResumeAdoption:
    """A found container is adopted only once it confirms the session, never on the registry's word."""

    @pytest.mark.anyio
    async def test_a_container_running_the_session_is_adopted_without_a_start(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-existing", session_id="sess-1"),
        )
        containers.create = AsyncMock()
        patcher, client = _patched_container_http()

        with patcher as client_cls, _reporting(svc, primary="sess-1", live=["sess-1"]):
            client_cls.return_value = client
            result = await svc.resume("sess-1")

        assert result.container_id == "ctr-existing"
        client.post.assert_not_called()
        containers.create.assert_not_called()

    @pytest.mark.anyio
    async def test_an_unstarted_owner_is_started_in_its_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-existing", session_id="sess-1"),
        )
        containers.create = AsyncMock()
        patcher, client = _patched_container_http()

        with patcher as client_cls, _reporting(svc, primary=None):
            client_cls.return_value = client
            result = await svc.resume("sess-1")

        assert result.container_id == "ctr-existing"
        client.post.assert_awaited_once_with(
            "http://localhost:8080/api/sessions/sess-1/resume",
            params={"primary": "true"},
        )
        containers.create.assert_not_called()

    @pytest.mark.anyio
    async def test_a_container_running_another_session_is_handed_back(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("fork-1")
        stale = _make_container("ctr-existing", session_id="fork-1")
        containers.find_by_session = AsyncMock(return_value=stale)
        containers.update = AsyncMock()
        containers.create = AsyncMock(return_value=_make_container("ctr-new", port=9090))
        reports = [{"session_id": "src-1", "live_session_ids": ["src-1"]}, {}]
        patcher, client = _patched_container_http()

        with (
            patcher as client_cls,
            patch.object(svc, "_wait_for_health", new=AsyncMock(side_effect=reports)),
        ):
            client_cls.return_value = client
            result = await svc.resume("fork-1")

        containers.update.assert_awaited_once_with(
            stale,
            session_id="src-1",
            live_session_ids=["src-1"],
        )
        containers.create.assert_awaited_once_with(session_id="fork-1", bundle=None)
        assert result.container_id == "ctr-new"

    @pytest.mark.anyio
    async def test_a_booting_container_is_waited_for_then_started(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        booting = _make_container("ctr-existing", session_id="sess-1")
        containers.find_by_session = AsyncMock(return_value=booting)
        containers.get.return_value = booting
        containers.create = AsyncMock()
        unstarted = MagicMock()
        unstarted.json.return_value = {"session_id": None, "live_session_ids": []}
        patcher, client = _patched_container_http()
        client.get = AsyncMock(
            side_effect=[httpx.ConnectError("refused"), httpx.ConnectError("refused"), unstarted],
        )

        with (
            patcher as client_cls,
            patch.object(service_module, "CONTAINER_HEALTH_STARTUP_INTERVAL", timedelta(0)),
        ):
            client_cls.return_value = client
            result = await svc.resume("sess-1")

        assert result.container_id == "ctr-existing"
        assert client.get.await_count == 3
        client.post.assert_awaited_once()
        containers.create.assert_not_called()

    @pytest.mark.anyio
    async def test_a_container_that_never_answers_times_out_and_is_kept(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        silent = _make_container("ctr-existing", session_id="sess-1")
        silent.created_at -= timedelta(hours=1)
        containers.find_by_session = AsyncMock(return_value=silent)
        containers.get.return_value = silent
        containers.create = AsyncMock()
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()
        patcher, client = _patched_container_http()
        client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

        with patcher as client_cls:
            client_cls.return_value = client

            with pytest.raises(ContainerTimeout):
                await svc.resume("sess-1")

        assert client.get.await_count == 1
        containers.create.assert_not_called()
        containers.stop_container.assert_not_called()
        containers.remove.assert_not_called()

    @pytest.mark.anyio
    async def test_a_refused_start_in_an_adopted_container_fails_and_keeps_it(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-existing", session_id="sess-1"),
        )
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()
        patcher, client = _patched_container_http()
        client.post = AsyncMock(return_value=_answer(500))

        with patcher as client_cls, _reporting(svc, primary=None):
            client_cls.return_value = client

            with pytest.raises(SessionContainerResumeFailed) as exc_info:
                await svc.resume("sess-1")

        assert exc_info.value.context["status"] == "500"
        containers.stop_container.assert_not_called()
        containers.remove.assert_not_called()


class TestResumeCleansUpOnFailure:
    """A resume that spawns a new container removes it on failure; adoption never removes."""

    @pytest.mark.anyio
    async def test_health_timeout_removes_the_spawned_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        containers.find_by_session = AsyncMock(return_value=None)
        new_container = _make_container("ctr-new")
        containers.create = AsyncMock(return_value=new_container)
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        with (
            patch.object(
                svc,
                "_wait_for_health",
                new=AsyncMock(side_effect=ContainerTimeout(container_id="ctr-new")),
            ),
            pytest.raises(ContainerTimeout),
        ):
            await svc.resume("sess-1")

        containers.stop_container.assert_awaited_once_with("ctr-new")
        containers.remove.assert_awaited_once_with("ctr-new")

    @pytest.mark.anyio
    async def test_adopted_container_is_never_removed(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        existing = _make_container("ctr-existing", session_id="sess-1")
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        with _reporting(svc, primary="sess-1"):
            result = await svc.resume("sess-1")

        assert result.container_id == "ctr-existing"
        containers.stop_container.assert_not_called()
        containers.remove.assert_not_called()

    @pytest.mark.anyio
    async def test_a_refused_start_removes_the_spawned_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        containers.find_by_session = AsyncMock(return_value=None)
        containers.create = AsyncMock(return_value=_make_container("ctr-new"))
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()
        patcher, client = _patched_container_http()
        client.post = AsyncMock(return_value=_answer(503))

        with (
            patcher as client_cls,
            patch.object(svc, "_wait_for_health", new=AsyncMock(return_value={})),
        ):
            client_cls.return_value = client

            with pytest.raises(SessionContainerResumeFailed):
                await svc.resume("sess-1")

        containers.stop_container.assert_awaited_once_with("ctr-new")
        containers.remove.assert_awaited_once_with("ctr-new")


class _RacingContainers:
    """Container service stand-in whose spawn waits on `spawn_open`; records calls in order."""

    def __init__(self, calls: list) -> None:
        self.calls = calls
        self.spawn_open = asyncio.Event()
        self.removed = asyncio.Event()
        self.by_session: dict[str, Container] = {}
        self._spawned = 0

    async def find_by_session(self, session_id: str, sync: bool = False) -> Container | None:
        return self.by_session.get(session_id)

    async def create(self, *, session_id: str, bundle: str | None = None) -> Container:
        self.calls.append(("create", session_id))
        await self.spawn_open.wait()
        self._spawned += 1
        container = _make_container(f"ctr-new-{self._spawned}", session_id=session_id)
        self.by_session[session_id] = container

        return container

    async def update(self, container: Container, **fields) -> None:
        self.calls.append(("update", fields))

        if "session_id" in fields:
            self.by_session = {k: c for k, c in self.by_session.items() if c is not container}
            container.session_id = fields["session_id"]
            self.by_session[fields["session_id"]] = container

        if "members" in fields:
            container.members = fields["members"]

    async def stop_container(self, container_id: str) -> None:
        self.calls.append(("stop", container_id))

    async def remove(self, container_id: str) -> None:
        self.calls.append(("remove", container_id))
        self.removed.set()


class _ResumeRace:
    """A SessionService whose spawn, health wait and container resume post each wait on a gate."""

    def __init__(self, tmp_path: Path, metadata: dict[str, SessionMetadata]) -> None:
        self.calls: list = []
        self.svc, repo, _ = _make_service(tmp_path)
        repo.get.side_effect = lambda session_id: metadata[session_id]
        self.containers = _RacingContainers(self.calls)
        self.svc._containers = self.containers  # ty: ignore[invalid-assignment]
        self.health_open = asyncio.Event()
        self.post_open = asyncio.Event()
        self.health_error: Exception | None = None

    @contextlib.contextmanager
    def gated(self):
        async def health(container_id: str) -> None:
            self.calls.append(("health", container_id))
            await self.health_open.wait()

            if self.health_error:
                raise self.health_error

        async def post(url: str, params: dict | None = None) -> MagicMock:
            session_id = url.split("/api/sessions/")[1].split("/", maxsplit=1)[0]
            self.calls.append(("resume", session_id, (params or {}).get("primary", "true")))
            await self.post_open.wait()

            return MagicMock()

        real_lock = getattr(self.svc, "_session_lock", None)

        def lock(session_id: str):
            self.calls.append(("lock", session_id))

            return real_lock(session_id)  # ty: ignore[call-non-callable]

        client = AsyncMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.post = post

        with (
            patch.object(self.svc, "_wait_for_health", health),
            patch.object(self.svc, "_session_lock", lock, create=True),
            patch(
                "claudebox_daemon.domain.sessions.service.httpx.AsyncClient",
                return_value=client,
            ),
        ):
            yield

    def open_all(self) -> None:
        self.containers.spawn_open.set()
        self.health_open.set()
        self.post_open.set()

    def count(self, call: tuple) -> int:
        return self.calls.count(call)

    def without_locks(self) -> list:
        return [c for c in self.calls if c[0] != "lock"]


async def _until(condition: Callable[[], bool]) -> None:
    """Yield to the loop until `condition()` holds; fail after a second."""

    async with asyncio.timeout(1):
        while not condition():
            await asyncio.sleep(0.001)


class TestConcurrentResumes:
    """Resumes of one session share one in-flight operation; fork and side threads wait on it."""

    @pytest.mark.anyio
    async def test_two_concurrent_resumes_share_one_spawn(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})

        with race.gated():
            first = asyncio.create_task(race.svc.resume("sess-1"))
            second = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(lambda: race.count(("create", "sess-1")) >= 1)
            await asyncio.sleep(0.01)
            race.open_all()
            results = await asyncio.gather(first, second)

        assert [r.container_id for r in results] == ["ctr-new-1", "ctr-new-1"]
        assert race.count(("create", "sess-1")) == 1
        assert race.count(("resume", "sess-1", "true")) == 1

    @pytest.mark.anyio
    async def test_a_late_joiner_returns_only_once_the_session_has_started(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        race.containers.spawn_open.set()
        race.health_open.set()

        with race.gated():
            first = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(lambda: race.count(("resume", "sess-1", "true")) == 1)
            late = asyncio.create_task(race.svc.resume("sess-1"))
            await asyncio.sleep(0.01)

            assert not late.done()

            race.post_open.set()
            results = await asyncio.gather(first, late)

        assert [r.container_id for r in results] == ["ctr-new-1", "ctr-new-1"]

    @pytest.mark.anyio
    async def test_the_first_caller_leaving_keeps_the_joined_result(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        race.containers.spawn_open.set()

        with race.gated():
            first = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(lambda: race.count(("health", "ctr-new-1")) == 1)
            second = asyncio.create_task(race.svc.resume("sess-1"))
            await asyncio.sleep(0.01)
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)
            race.open_all()
            result = await second

        assert result.container_id == "ctr-new-1"
        assert race.count(("remove", "ctr-new-1")) == 0

    @pytest.mark.anyio
    async def test_a_sole_caller_leaving_still_removes_its_spawn(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        race.containers.spawn_open.set()

        with race.gated():
            only = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(lambda: race.count(("health", "ctr-new-1")) == 1)
            only.cancel()
            await asyncio.gather(only, return_exceptions=True)
            await asyncio.wait_for(race.containers.removed.wait(), 1)

        assert race.count(("stop", "ctr-new-1")) == 1
        assert race.count(("remove", "ctr-new-1")) == 1

    @pytest.mark.anyio
    async def test_a_failure_reaches_every_caller_and_cleans_up_once(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        race.health_error = ContainerTimeout(container_id="ctr-new-1")

        with race.gated():
            callers = [asyncio.create_task(race.svc.resume("sess-1")) for _ in range(2)]
            await _until(lambda: race.count(("create", "sess-1")) >= 1)
            await asyncio.sleep(0.01)
            race.open_all()
            results = await asyncio.gather(*callers, return_exceptions=True)

        assert [type(r) for r in results] == [ContainerTimeout, ContainerTimeout]
        assert race.count(("remove", "ctr-new-1")) == 1

    @pytest.mark.anyio
    async def test_a_rewind_waits_for_an_in_flight_resume_of_its_source(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        _plant_transcript(tmp_path, "sess-1")

        with race.gated():
            resume = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(lambda: race.count(("create", "sess-1")) == 1)
            fork = asyncio.create_task(race.svc.fork("sess-1", reuse_container=True))
            await _until(lambda: fork.done() or race.count(("lock", "sess-1")) == 2)
            race.open_all()
            _, forked = await asyncio.gather(resume, fork)

        assert race.without_locks() == [
            ("create", "sess-1"),
            ("health", "ctr-new-1"),
            ("resume", "sess-1", "true"),
            ("update", {"session_id": forked.session_id}),
            ("resume", forked.session_id, "true"),
        ]
        assert list(race.containers.by_session) == [forked.session_id]

    @pytest.mark.anyio
    async def test_a_side_thread_fork_waits_for_an_in_flight_resume_of_its_source(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        _plant_transcript(tmp_path, "sess-1")

        with race.gated():
            resume = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(lambda: race.count(("create", "sess-1")) == 1)
            fork = asyncio.create_task(race.svc.fork("sess-1", share_container=True))
            await _until(lambda: fork.done() or race.count(("lock", "sess-1")) == 2)
            race.open_all()
            _, forked = await asyncio.gather(resume, fork)

        assert race.without_locks() == [
            ("create", "sess-1"),
            ("health", "ctr-new-1"),
            ("resume", "sess-1", "true"),
            ("update", {"members": [forked.session_id]}),
            ("resume", forked.session_id, "false"),
        ]

    @pytest.mark.anyio
    async def test_a_resume_waits_for_an_in_flight_fork_of_its_source(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        race.containers.by_session["sess-1"] = _make_container("ctr-source", session_id="sess-1")
        race.containers.spawn_open.set()
        race.health_open.set()
        _plant_transcript(tmp_path, "sess-1")

        with race.gated():
            fork = asyncio.create_task(race.svc.fork("sess-1", reuse_container=True))
            await _until(lambda: any(c[0] == "resume" for c in race.calls))
            resume = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(
                lambda: (
                    race.count(("create", "sess-1")) == 1 or race.count(("lock", "sess-1")) == 2
                ),
            )

            assert race.count(("create", "sess-1")) == 0

            race.post_open.set()
            forked, resumed = await asyncio.gather(fork, resume)

        assert race.without_locks() == [
            ("update", {"session_id": forked.session_id}),
            ("resume", forked.session_id, "true"),
            ("create", "sess-1"),
            ("health", "ctr-new-1"),
            ("resume", "sess-1", "true"),
        ]
        assert resumed.container_id == "ctr-new-1"

    @pytest.mark.anyio
    async def test_a_side_threads_resume_waits_for_its_parents_resume(self, tmp_path):
        thread = _make_metadata("thread-1", parent_session_id="sess-1", is_side_thread=True)
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1"), "thread-1": thread})

        with race.gated():
            parent = asyncio.create_task(race.svc.resume("sess-1"))
            await _until(lambda: race.count(("create", "sess-1")) == 1)
            side = asyncio.create_task(race.svc.resume("thread-1"))
            await _until(lambda: side.done() or race.count(("lock", "sess-1")) == 2)
            race.open_all()
            _, joined = await asyncio.gather(parent, side)

        assert joined.container_id == "ctr-new-1"
        assert race.without_locks()[-2:] == [
            ("update", {"members": ["thread-1"]}),
            ("resume", "thread-1", "false"),
        ]

    @pytest.mark.anyio
    async def test_resumes_of_different_sessions_run_in_parallel(self, tmp_path):
        race = _ResumeRace(
            tmp_path,
            {"sess-a": _make_metadata("sess-a"), "sess-b": _make_metadata("sess-b")},
        )

        with race.gated():
            callers = [asyncio.create_task(race.svc.resume(s)) for s in ("sess-a", "sess-b")]
            await _until(
                lambda: race.count(("create", "sess-a")) + race.count(("create", "sess-b")) == 2,
            )
            race.open_all()
            results = await asyncio.gather(*callers)

        assert {r.container_id for r in results} == {"ctr-new-1", "ctr-new-2"}

    @pytest.mark.anyio
    async def test_a_resume_after_the_last_settled_is_fresh(self, tmp_path):
        race = _ResumeRace(tmp_path, {"sess-1": _make_metadata("sess-1")})
        race.open_all()

        with race.gated():
            first = await race.svc.resume("sess-1")
            del race.containers.by_session["sess-1"]
            second = await race.svc.resume("sess-1")

        assert (first.container_id, second.container_id) == ("ctr-new-1", "ctr-new-2")


# --- _wait_for_health ---


@patch(
    "claudebox_daemon.domain.sessions.service.CONTAINER_HEALTH_STARTUP_INTERVAL",
    timedelta(0),
)
@patch(
    "claudebox_daemon.domain.sessions.service.CONTAINER_HEALTH_STARTUP_MAX_RETRIES",
    3,
)
class TestWaitForHealth:
    """Test health-check polling with retries."""

    @pytest.mark.anyio
    async def test_succeeds_on_first_try(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-1", port=9090)
        containers.get.return_value = container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(get=AsyncMock(return_value=mock_response))
            mock_client_cls.return_value = mock_client

            await svc._wait_for_health("ctr-1")

        mock_client.get.assert_awaited_once()

    @pytest.mark.anyio
    async def test_retries_then_succeeds(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-1", port=9090)
        containers.get.return_value = container

        ok_response = MagicMock()
        ok_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            # Fail twice, succeed on third
            mock_client = _async_client(
                get=AsyncMock(
                    side_effect=[ConnectionError("down"), ConnectionError("down"), ok_response],
                ),
            )
            mock_client_cls.return_value = mock_client

            await svc._wait_for_health("ctr-1")

        assert mock_client.get.await_count == 3

    @pytest.mark.anyio
    async def test_exhausts_retries_raises_timeout(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-1", port=9090)
        containers.get.return_value = container

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(get=AsyncMock(side_effect=ConnectionError("down")))
            mock_client_cls.return_value = mock_client

            with pytest.raises(ContainerTimeout):
                await svc._wait_for_health("ctr-1")

        assert mock_client.get.await_count == 3


# --- Fork helpers ---


class TestCopySdkSessionDir:
    """Test _copy_sdk_session_dir with resilience for unreadable files."""

    def _make_ws(self, tmp_path):
        return tmp_path

    def test_copies_when_present(self, tmp_path):
        ws = self._make_ws(tmp_path)
        src = tmp_path / "source"
        src.mkdir()
        (src / "file.txt").write_text("content")

        SessionService._copy_sdk_session_dir(MagicMock(), ws, "source", "dest")

        assert (tmp_path / "dest" / "file.txt").read_text() == "content"

    def test_skips_when_absent(self, tmp_path):
        ws = self._make_ws(tmp_path)

        SessionService._copy_sdk_session_dir(MagicMock(), ws, "nonexistent", "dest")

        assert not (tmp_path / "dest").exists()

    def test_skips_dangling_symlinks(self, tmp_path):
        ws = self._make_ws(tmp_path)
        src = tmp_path / "source"
        src.mkdir()
        (src / "good.txt").write_text("ok")
        (src / "broken").symlink_to("/nonexistent/target")

        SessionService._copy_sdk_session_dir(MagicMock(), ws, "source", "dest")

        dst = tmp_path / "dest"
        assert (dst / "good.txt").read_text() == "ok"
        assert not (dst / "broken").exists()

    def test_skips_unreadable_files_and_logs_warning(self, tmp_path):
        import os

        if os.getuid() == 0:
            pytest.skip("Root ignores file permissions")

        ws = self._make_ws(tmp_path)
        src = tmp_path / "source"
        sub = src / "tmp"
        sub.mkdir(parents=True)
        (src / "good.txt").write_text("ok")
        bad = sub / "secret"
        bad.write_text("hidden")
        os.chmod(str(bad), 0o000)

        try:
            SessionService._copy_sdk_session_dir(MagicMock(), ws, "source", "dest")
        finally:
            os.chmod(str(bad), 0o644)

        dst = tmp_path / "dest"
        assert (dst / "good.txt").read_text() == "ok"
        assert not (dst / "tmp" / "secret").exists()


class TestCopyClaudeboxSession:
    """Test _copy_claudebox_session with resilience for unreadable files."""

    def _make_ws(self, tmp_path):
        ws = MagicMock()
        src_session = MagicMock()
        src_session.path = tmp_path / "src-session"
        dst_session = MagicMock()
        dst_session.path = tmp_path / "dst-session"
        dst_session.path.mkdir(parents=True, exist_ok=True)
        ws.ensure_session = MagicMock(
            side_effect=lambda sid: {
                "source": src_session,
                "dest": dst_session,
            }[sid],
        )

        return ws, src_session, dst_session

    def test_copies_excluding_session_json(self, tmp_path):
        ws, src_session, dst_session = self._make_ws(tmp_path)
        src_session.path.mkdir(parents=True, exist_ok=True)
        (src_session.path / "events.jsonl").write_text('{"type":"user"}\n')
        (src_session.path / "session.json").write_text("{}")

        SessionService._copy_claudebox_session(MagicMock(), ws, "source", "dest")

        assert (dst_session.path / "events.jsonl").exists()
        assert not (dst_session.path / "session.json").exists()

    def test_skips_dangling_symlinks(self, tmp_path):
        ws, src_session, dst_session = self._make_ws(tmp_path)
        src_session.path.mkdir(parents=True, exist_ok=True)
        (src_session.path / "good.txt").write_text("ok")
        (src_session.path / "broken").symlink_to("/nonexistent/target")

        SessionService._copy_claudebox_session(MagicMock(), ws, "source", "dest")

        assert (dst_session.path / "good.txt").read_text() == "ok"
        assert not (dst_session.path / "broken").exists()

    def test_skips_unreadable_files_and_logs_warning(self, tmp_path):
        import os

        if os.getuid() == 0:
            pytest.skip("Root ignores file permissions")

        ws, src_session, dst_session = self._make_ws(tmp_path)
        src_session.path.mkdir(parents=True, exist_ok=True)
        sub = src_session.path / "tmp"
        sub.mkdir()
        (src_session.path / "good.txt").write_text("ok")
        bad = sub / "secret"
        bad.write_text("hidden")
        os.chmod(str(bad), 0o000)

        try:
            SessionService._copy_claudebox_session(MagicMock(), ws, "source", "dest")
        finally:
            os.chmod(str(bad), 0o644)

        assert (dst_session.path / "good.txt").read_text() == "ok"
        assert not (dst_session.path / "tmp" / "secret").exists()


class TestCopySdkTranscript:
    """Test _copy_sdk_transcript existence guard."""

    def _make_ws(self, tmp_path):
        return tmp_path

    def test_copies_when_present(self, tmp_path):
        ws = self._make_ws(tmp_path)
        (tmp_path / "source.jsonl").write_text('{"type":"user"}\n')

        SessionService._copy_sdk_transcript(ws, "source", "dest")

        assert (tmp_path / "dest.jsonl").exists()
        assert (tmp_path / "dest.jsonl").read_text() == '{"type":"user"}\n'

    def test_skips_when_absent(self, tmp_path):
        ws = self._make_ws(tmp_path)

        SessionService._copy_sdk_transcript(ws, "nonexistent", "dest")

        assert not (tmp_path / "dest.jsonl").exists()


class TestTruncateSdkTranscript:
    """Test _truncate_sdk_transcript existence guard."""

    def _make_ws(self, tmp_path):
        return tmp_path

    def test_truncates_at_turn(self, tmp_path):
        ws = self._make_ws(tmp_path)
        svc, _repo, _containers = _make_service(tmp_path)
        lines = [
            json.dumps({"type": "assistant", "uuid": "t1"}) + "\n",
            json.dumps({"type": "user", "uuid": "t2"}) + "\n",
            json.dumps({"type": "assistant", "uuid": "t2"}) + "\n",
        ]
        (tmp_path / "sess.jsonl").write_text("".join(lines))

        svc._truncate_sdk_transcript(ws, "sess", "t2")

        result = (tmp_path / "sess.jsonl").read_text().splitlines()
        assert len(result) == 1

    def test_skips_when_absent(self, tmp_path):
        ws = self._make_ws(tmp_path)
        svc, _repo, _containers = _make_service(tmp_path)

        svc._truncate_sdk_transcript(ws, "nonexistent", "t1")


# --- transcripts carrying raw line separators ---


# U+2028 is legal in a JSON string but splits on str.splitlines(); escaped to keep source ASCII.
SEPARATOR = "\u2028"


def _record(**fields) -> str:
    """Serialize one JSONL record, leaving any separator character raw as Node writes it."""

    return json.dumps(fields, ensure_ascii=False) + "\n"


class TestTranscriptLineSeparators:
    """Test that a record carrying a raw separator survives truncation intact."""

    @staticmethod
    def _make_ws(tmp_path):
        return tmp_path

    def test_sdk_truncation_keeps_a_record_carrying_a_separator(self, tmp_path):
        ws = self._make_ws(tmp_path)
        svc, _repo, _containers = _make_service(tmp_path)
        lines = [
            _record(type="assistant", uuid="t1", text=f"wrapped{SEPARATOR}line"),
            _record(type="assistant", uuid="t1", text="plain"),
            _record(type="user", uuid="t2"),
            _record(type="assistant", uuid="t2"),
        ]
        (tmp_path / "sess.jsonl").write_text("".join(lines), encoding="utf-8")

        svc._truncate_sdk_transcript(ws, "sess", "t2")

        kept = (tmp_path / "sess.jsonl").read_text(encoding="utf-8")
        assert kept == "".join(lines[:2])
        # The separator stayed inside its record rather than splitting it.
        assert json.loads(kept.split("\n")[0])["text"] == f"wrapped{SEPARATOR}line"

    def test_truncation_preserves_the_trailing_newline(self, tmp_path):
        ws = self._make_ws(tmp_path)
        svc, _repo, _containers = _make_service(tmp_path)
        lines = [
            _record(type="assistant", uuid="t1"),
            _record(type="user", uuid="t2"),
        ]
        (tmp_path / "sess.jsonl").write_text("".join(lines), encoding="utf-8")

        svc._truncate_sdk_transcript(ws, "sess", "t2")

        # Without it the runtime's next append lands on the end of the last record.
        assert (tmp_path / "sess.jsonl").read_text(encoding="utf-8").endswith("\n")

    def test_events_truncation_keeps_a_record_carrying_a_separator(self, tmp_path):
        svc, _repo, _containers = _make_service(tmp_path)
        session = Workspace(tmp_path).ensure_session("sess")
        lines = [
            _record(turn_id="t1", content=f"wrapped{SEPARATOR}line", is_human=True),
            _record(turn_id="t2", content="dropped", is_human=True),
        ]
        (session.path / "events.jsonl").write_text("".join(lines), encoding="utf-8")

        svc._truncate_events(Workspace(tmp_path), "sess", "t2")

        kept = (session.path / "events.jsonl").read_text(encoding="utf-8")
        assert kept == lines[0]

    def test_derived_fields_survive_a_separator(self, tmp_path):
        svc, _repo, _containers = _make_service(tmp_path)
        events = tmp_path / "events.jsonl"
        events.write_text(
            _record(type="user", is_human=True, content=f"a{SEPARATOR}b")
            + _record(type="result", cost_usd=0.25, duration_ms=100),
            encoding="utf-8",
        )

        result = svc._compute_derived_fields(events)

        assert result["total_cost_usd"] == pytest.approx(0.25)
        assert result["num_turns"] == 1
        assert result["last_message"] == f"a{SEPARATOR}b"


class TestUnparseableTranscriptLine:
    """A line claudebox genuinely cannot parse is reported, not fatal."""

    @staticmethod
    def _make_ws(tmp_path):
        return tmp_path

    def test_sdk_truncation_skips_a_damaged_line(self, tmp_path):
        ws = self._make_ws(tmp_path)
        svc, _repo, _containers = _make_service(tmp_path)
        lines = [
            _record(type="assistant", uuid="t1"),
            "{ this is not json\n",
            _record(type="user", uuid="t2"),
            _record(type="assistant", uuid="t2"),
        ]
        (tmp_path / "sess.jsonl").write_text("".join(lines), encoding="utf-8")

        svc._truncate_sdk_transcript(ws, "sess", "t2")

        # Truncation lands on the boundary; the damaged line rides as content, not aborting fork.
        assert (tmp_path / "sess.jsonl").read_text(encoding="utf-8") == "".join(lines[:2])

    def test_derived_fields_skip_a_damaged_line(self, tmp_path):
        svc, _repo, _containers = _make_service(tmp_path)
        events = tmp_path / "events.jsonl"
        events.write_text(
            _record(type="result", cost_usd=0.10)
            + "{ broken\n"
            + _record(type="result", cost_usd=0.20),
            encoding="utf-8",
        )

        result = svc._compute_derived_fields(events, "LangGraph")

        assert result["total_cost_usd"] == pytest.approx(0.30)


class TestTruncateEventsMissingFile:
    """A session that never persisted an event is still forkable at a turn."""

    def test_absent_events_file_is_not_fatal(self, tmp_path):
        svc, _repo, _containers = _make_service(tmp_path)
        Workspace(tmp_path).ensure_session("sess")

        svc._truncate_events(Workspace(tmp_path), "sess", "t1")


# --- fork ---


class TestForkValidatesSourceId:
    """Fork's own copy helpers join source_session_id straight into a path, bypassing paths.py's
    resolver - reachable from a request path, so fork validates the id upfront instead."""

    @pytest.mark.anyio
    async def test_refuses_a_malformed_source_id_before_touching_disk(self, tmp_path):
        svc, _repo, _containers = _make_service(tmp_path)
        sessions_root = Workspace(tmp_path).sessions_root
        before = set(sessions_root.rglob("*"))

        with pytest.raises(ValidationError) as exc_info:
            await svc.fork("../evil")

        assert exc_info.value.context["session_id"] == "../evil"
        assert set(sessions_root.rglob("*")) == before


class TestForkOwnershipTransfer:
    """Test fork(reuse_container=True) transfers Container.session_id to the new session."""

    @pytest.mark.anyio
    async def test_reuse_container_transfers_session_id(self, tmp_path):
        """When forking with reuse_container=True, container.session_id moves to the child."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # Real metadata avoids MagicMock auto-vivifying fields and OOMing the JSONEncoder.
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        existing = _live_parent_container(containers, parent_id)

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        # The transfer call: container.session_id moves to the new (child) session.
        containers.update.assert_awaited_once()
        update_call = containers.update.await_args
        assert update_call.args[0] is existing
        assert update_call.kwargs.get("session_id") == result.session_id
        assert result.container_id == "ctr-existing"
        # Sanity: the new session_id is a fresh uuid, not the parent.
        assert result.session_id != parent_id

    @pytest.mark.anyio
    async def test_reuse_container_no_running_container_raises(self, tmp_path):
        """When source has no running container, fork(reuse_container=True) raises."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        containers.find_by_session = AsyncMock(return_value=None)
        containers.update = AsyncMock()

        _plant_transcript(tmp_path, parent_id)

        with pytest.raises(SessionContainerUnavailable):
            await svc.fork(parent_id, reuse_container=True)

        containers.update.assert_not_called()

    @pytest.mark.anyio
    async def test_no_reuse_does_not_transfer_ownership(self, tmp_path):
        """fork(reuse_container=False) spawns a new container; no session_id transfer."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        with _forking_into_new_container(svc, containers):
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=False)

        # Fresh container spawned with the new session_id from the start.
        containers.create.assert_awaited_once()
        create_call = containers.create.await_args
        assert create_call.kwargs.get("session_id") == result.session_id
        # No transfer call: the fresh-container path never touches containers.update.
        containers.update.assert_not_called()


class TestForkCleansUpOnFailure:
    """Fork into a fresh container removes it on failure; a reused container is never touched."""

    @pytest.mark.anyio
    async def test_health_timeout_removes_the_spawned_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        new_container = _make_container("ctr-new")
        containers.find_by_session = AsyncMock()
        containers.create = AsyncMock(return_value=new_container)
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        with patch.object(
            svc,
            "_wait_for_health",
            new=AsyncMock(side_effect=ContainerTimeout(container_id="ctr-new")),
        ):
            _plant_transcript(tmp_path, parent_id)

            with pytest.raises(ContainerTimeout):
                await svc.fork(parent_id, reuse_container=False)

        containers.stop_container.assert_awaited_once_with("ctr-new")
        containers.remove.assert_awaited_once_with("ctr-new")

    @pytest.mark.anyio
    async def test_reused_container_is_never_removed_when_the_resume_call_fails(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        _live_parent_container(containers, parent_id)
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                post=AsyncMock(side_effect=RuntimeError("resume-post failed")),
            )
            mock_client_cls.return_value = mock_client

            _plant_transcript(tmp_path, parent_id)

            with pytest.raises(RuntimeError):
                await svc.fork(parent_id, reuse_container=True)

        containers.stop_container.assert_not_called()
        containers.remove.assert_not_called()

    @pytest.mark.anyio
    async def test_a_refused_start_removes_the_spawned_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-parent", name="Parent")
        containers.create = AsyncMock(return_value=_make_container("ctr-new"))
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()
        patcher, client = _patched_container_http()
        client.post = AsyncMock(return_value=_answer(503))
        _plant_transcript(tmp_path, "sess-parent")

        with (
            patcher as client_cls,
            patch.object(svc, "_wait_for_health", new=AsyncMock(return_value={})),
        ):
            client_cls.return_value = client

            with pytest.raises(SessionContainerResumeFailed):
                await svc.fork("sess-parent")

        containers.stop_container.assert_awaited_once_with("ctr-new")
        containers.remove.assert_awaited_once_with("ctr-new")


class TestForkParentOverride:
    """Test fork()'s parent_session_id override - promotion re-parents onto a drawable ancestor."""

    @pytest.mark.anyio
    async def test_defaults_parent_to_source_session(self, tmp_path):
        """No override: the seed's parent_session_id is the fork source."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        with _forking_into_new_container(svc, containers):
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id)

        assert result.parent_session_id == parent_id

    @pytest.mark.anyio
    async def test_override_re_parents_the_child(self, tmp_path):
        """A promoted side thread's child is re-parented to the given ancestor, not its literal
        source - the source's own hidden node is never listed and would strand the child."""

        svc, repo, containers = _make_service(tmp_path)
        side_id = "sess-side"
        main_id = "sess-main"
        repo.get.return_value = _make_metadata(side_id, name="Side")

        with _forking_into_new_container(svc, containers):
            _plant_transcript(tmp_path, side_id)
            result = await svc.fork(side_id, parent_session_id=main_id)

        assert result.parent_session_id == main_id
        assert result.session_id != side_id

    @pytest.mark.anyio
    async def test_promoted_child_is_never_marked_a_side_thread(self, tmp_path):
        """Promotion omits share_container - the promoted session is an ordinary top-level
        session in its own container, listed like any other, not hidden like its source."""

        svc, repo, containers = _make_service(tmp_path)
        side_id = "sess-side"
        repo.get.return_value = _make_metadata(side_id, name="Side")

        with _forking_into_new_container(svc, containers):
            _plant_transcript(tmp_path, side_id)
            result = await svc.fork(side_id, parent_session_id="sess-main")

        assert result.is_side_thread is False


class TestForkSharesContainer:
    """Test fork(share_container=True) - the third disposition, no ownership transfer."""

    @pytest.mark.anyio
    async def test_joins_as_member_without_transferring_ownership(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        existing = _live_parent_container(containers, parent_id)

        with _posting_client() as mock_client:
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, share_container=True)

        # Never the owner-transfer form: session_id keyword is absent, members is a fresh list.
        containers.update.assert_awaited_once()
        update_call = containers.update.await_args
        assert update_call.args[0] is existing
        assert "session_id" not in update_call.kwargs
        assert update_call.kwargs.get("members") == [result.session_id]
        assert result.container_id == "ctr-existing"

        # Joins non-primary: the resume POST carries primary=false.
        mock_client.post.assert_awaited_once()
        post_args, post_kwargs = mock_client.post.call_args
        assert f"/api/sessions/{result.session_id}/resume" in post_args[0]
        assert post_kwargs["params"] == {"primary": "false"}

    @pytest.mark.anyio
    async def test_builds_a_fresh_members_list_not_a_mutation(self, tmp_path):
        """update() compares old vs new by value - an in-place-mutated list looks unchanged and
        is silently never persisted. The member list passed to update() must be a new object."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        existing = _make_container("ctr-existing", session_id=parent_id, members=["prior-member"])
        original_members = existing.members
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, share_container=True)

        update_call = containers.update.await_args
        new_members = update_call.kwargs["members"]  # ty: ignore[unresolved-attribute]
        assert new_members is not original_members
        assert new_members == ["prior-member", result.session_id]

    @pytest.mark.anyio
    async def test_no_running_container_raises(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        containers.find_by_session = AsyncMock(return_value=None)
        containers.update = AsyncMock()

        _plant_transcript(tmp_path, parent_id)

        with pytest.raises(SessionContainerUnavailable):
            await svc.fork(parent_id, share_container=True)

        containers.update.assert_not_called()

    @pytest.mark.anyio
    async def test_reuse_and_share_together_is_rejected(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-parent", name="Parent")

        with pytest.raises(ValidationError):
            await svc.fork("sess-parent", reuse_container=True, share_container=True)

    @pytest.mark.anyio
    async def test_seeds_is_side_thread_marker(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        _live_parent_container(containers, parent_id)

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, share_container=True)

        assert result.is_side_thread is True

    @pytest.mark.anyio
    async def test_ordinary_fork_does_not_set_is_side_thread(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        new_container = _make_container("ctr-new")
        containers.find_by_session = AsyncMock()
        containers.create = AsyncMock(return_value=new_container)
        containers.get.return_value = new_container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                get=AsyncMock(return_value=mock_response),
                post=AsyncMock(return_value=mock_response),
            )
            mock_client_cls.return_value = mock_client

            with patch.object(svc, "_wait_for_health", new=AsyncMock()):
                _plant_transcript(tmp_path, parent_id)
                result = await svc.fork(parent_id)

        assert result.is_side_thread is False


class TestCopyClaudeboxSessionExcludesTmpWhenSharing:
    """A shared-container fork excludes tmp/ and attachments/ - dead bytes, since it never
    remaps /tmp and therefore never reads either back."""

    def _make_ws(self, tmp_path):
        ws = MagicMock()
        src_session = MagicMock()
        src_session.path = tmp_path / "src-session"
        dst_session = MagicMock()
        dst_session.path = tmp_path / "dst-session"
        dst_session.path.mkdir(parents=True, exist_ok=True)
        ws.ensure_session = MagicMock(
            side_effect=lambda sid: {"source": src_session, "dest": dst_session}[sid],
        )

        return ws, src_session, dst_session

    def test_share_container_excludes_tmp_and_attachments(self, tmp_path):
        ws, src_session, dst_session = self._make_ws(tmp_path)
        src_session.path.mkdir(parents=True, exist_ok=True)
        (src_session.path / "events.jsonl").write_text('{"type":"user"}\n')
        (src_session.path / "tmp").mkdir()
        (src_session.path / "tmp" / "scratch.txt").write_text("dead bytes")
        (src_session.path / "attachments").mkdir()
        (src_session.path / "attachments" / "photo.png").write_bytes(b"fake")

        SessionService._copy_claudebox_session(
            MagicMock(),
            ws,
            "source",
            "dest",
            share_container=True,
        )

        assert (dst_session.path / "events.jsonl").exists()
        assert not (dst_session.path / "tmp").exists()
        assert not (dst_session.path / "attachments").exists()

    def test_ordinary_fork_still_copies_tmp_and_attachments(self, tmp_path):
        ws, src_session, dst_session = self._make_ws(tmp_path)
        src_session.path.mkdir(parents=True, exist_ok=True)
        (src_session.path / "tmp").mkdir()
        (src_session.path / "tmp" / "scratch.txt").write_text("kept")
        (src_session.path / "attachments").mkdir()
        (src_session.path / "attachments" / "photo.png").write_bytes(b"fake")

        SessionService._copy_claudebox_session(MagicMock(), ws, "source", "dest")

        assert (dst_session.path / "tmp" / "scratch.txt").read_text() == "kept"
        assert (dst_session.path / "attachments" / "photo.png").exists()


# --- fork inheritance ---


def _seed_parent_session_json(tmp_path: Path, parent_id: str, payload: dict) -> Path:
    """Write a session.json for the parent session; returns its session directory."""

    workspace = Workspace(tmp_path)
    parent_session = workspace.ensure_session(parent_id)
    write_json(parent_session.path / SESSION_METADATA_FILE, payload)

    return parent_session.path


def _read_fork_session_json(tmp_path: Path, fork_id: str) -> dict:
    """Read the new session's session.json from disk after fork()."""
    workspace = Workspace(tmp_path)
    fork_session = workspace.ensure_session(fork_id)

    return json.loads((fork_session.path / SESSION_METADATA_FILE).read_text())


class TestForkIsTransactional:
    """Test that a fork failing part-way leaves no orphan session directory behind."""

    @staticmethod
    def _parent_with_events(tmp_path, svc, containers, parent_id="sess-parent"):
        svc._repo.get.side_effect = SharedSessionNotFound(parent_id)
        parent = Workspace(tmp_path).ensure_session(parent_id)
        (parent.path / "events.jsonl").write_text(
            _record(turn_id="t1", is_human=True, content="hi"),
            encoding="utf-8",
        )
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr", session_id=parent_id),
        )
        containers.update = AsyncMock()

        return parent

    @pytest.mark.anyio
    async def test_failure_before_the_seed_leaves_no_orphan_session(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        parent = self._parent_with_events(tmp_path, svc, containers)
        sessions_root = parent.path.parent
        before = {entry.name for entry in sessions_root.iterdir()}

        with patch.object(svc, "_compute_derived_fields", side_effect=OSError("disk full")):
            _plant_transcript(tmp_path, "sess-parent")

            with pytest.raises(OSError):
                await svc.fork("sess-parent", reuse_container=True)

        assert {entry.name for entry in sessions_root.iterdir()} == before

    @pytest.mark.anyio
    async def test_the_original_error_is_what_propagates(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        self._parent_with_events(tmp_path, svc, containers)

        with patch.object(svc, "_compute_derived_fields", side_effect=OSError("disk full")):
            _plant_transcript(tmp_path, "sess-parent")

            with pytest.raises(OSError, match="disk full"):
                await svc.fork("sess-parent", reuse_container=True)

    @pytest.mark.anyio
    async def test_cancellation_mid_fork_leaves_no_orphan(self, tmp_path):
        """CancelledError is a BaseException, so `except Exception` alone would miss it."""

        svc, _repo, containers = _make_service(tmp_path)
        parent = self._parent_with_events(tmp_path, svc, containers)
        sessions_root = parent.path.parent
        before = {entry.name for entry in sessions_root.iterdir()}

        with patch.object(svc, "_compute_derived_fields", side_effect=asyncio.CancelledError):
            _plant_transcript(tmp_path, "sess-parent")

            with pytest.raises(asyncio.CancelledError):
                await svc.fork("sess-parent", reuse_container=True)

        assert {entry.name for entry in sessions_root.iterdir()} == before

    @pytest.mark.anyio
    async def test_a_successful_fork_keeps_its_session_dir(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        parent = self._parent_with_events(tmp_path, svc, containers)
        sessions_root = parent.path.parent
        before = {entry.name for entry in sessions_root.iterdir()}

        with _posting_client():
            _plant_transcript(tmp_path, "sess-parent")
            await svc.fork("sess-parent", reuse_container=True)

        # Rollback must not be so eager that it also discards successful forks.
        created = {entry.name for entry in sessions_root.iterdir()} - before
        assert len(created) == 1
        assert (sessions_root / created.pop() / SESSION_METADATA_FILE).exists()


class TestForkInheritsUserSettings:
    """Forking carries user-controlled settings (permission mode, effort, prompt, name) from the parent."""

    @pytest.mark.anyio
    async def test_inherits_permission_mode_effort_session_prompt_name_model(self, tmp_path):
        """The fork's session.json mirrors the parent's user settings verbatim."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # repo.get must raise: a Mock return value auto-vivifies fields and OOMs the JSONEncoder.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id,
        )
        _seed_parent_session_json(
            tmp_path,
            parent_id,
            {
                "session_id": parent_id,
                "name": "Parent",
                "auto_name": "Tuning the parser",
                "model": "claude-sonnet-5",
                "runtime": "LangGraph",
                "provider": "ollama",
                "permission_mode": "bypassPermissions",
                "effort_level": "max",
                "session_prompt": "Stay terse.",
                "num_turns": 7,
                "total_cost_usd": 0.42,
                "first_message": "Initial",
                "last_message": "Latest",
                "needs_user": "Decide: where retry state lives",
                "needs_user_replies": ["Go", "Hold"],
            },
        )

        _live_parent_container(containers, parent_id)

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # User settings inherited verbatim.
        assert fork_data["permission_mode"] == "bypassPermissions"
        assert fork_data["effort_level"] == "max"
        assert fork_data["session_prompt"] == "Stay terse."
        assert fork_data["name"] == "Parent"
        assert fork_data["auto_name"] == "Tuning the parser"
        assert fork_data["model"] == "claude-sonnet-5"
        assert fork_data["runtime"] == "LangGraph"
        assert fork_data["provider"] == "ollama"
        # first_message is identity-stable across rewinds (truncation keeps the session prefix).
        assert fork_data["first_message"] == "Initial"
        # Derived counters/snapshots come from the empty child events.jsonl, hence zero/None.
        assert fork_data["num_turns"] == 0
        assert fork_data["total_cost_usd"] == pytest.approx(0.0)
        assert fork_data["total_duration_ms"] == 0
        assert fork_data["last_message"] is None
        assert fork_data["last_context_tokens"] == 0
        assert fork_data["todos"] is None
        # Fork-point snapshot equals derived total at fork moment (zero here).
        assert fork_data["fork_point_cost_usd"] == pytest.approx(0.0)
        # A fork starts without needing the user, whatever the parent was waiting on.
        assert "needs_user" not in fork_data
        assert "needs_user_replies" not in fork_data
        assert result.needs_user is None
        assert result.needs_user_replies is None
        # SessionInfo omits session_prompt; it lives only in session.json for the frontend to read.
        assert result.permission_mode == "bypassPermissions"
        assert result.effort_level == "max"
        assert result.name == "Parent"
        assert result.fork_point_cost_usd == pytest.approx(0.0)

    @pytest.mark.anyio
    async def test_overrides_identity_fields(self, tmp_path):
        """session_id, parent_session_id, session_dir, workspace, started_at, updated_at always overridden."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # repo.get must raise: a Mock return value auto-vivifies fields and OOMs the JSONEncoder.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id,
        )
        _seed_parent_session_json(
            tmp_path,
            parent_id,
            {
                "session_id": parent_id,
                "parent_session_id": "grandparent",
                "session_dir": "/old/path",
                "workspace": "/old/workspace",
                "started_at": "2020-01-01T00:00:00+00:00",
                "updated_at": "2020-01-01T00:00:00+00:00",
                "permission_mode": "plan",
            },
        )

        _live_parent_container(containers, parent_id)

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # Identity overridden.
        assert fork_data["session_id"] == result.session_id
        assert fork_data["session_id"] != parent_id
        assert fork_data["parent_session_id"] == parent_id  # not "grandparent"
        assert fork_data["session_dir"] != "/old/path"
        assert fork_data["workspace"] == str(tmp_path)
        assert fork_data["started_at"] != "2020-01-01T00:00:00+00:00"
        assert fork_data["updated_at"] != "2020-01-01T00:00:00+00:00"
        # User setting still inherited.
        assert fork_data["permission_mode"] == "plan"

    @pytest.mark.anyio
    async def test_missing_parent_session_json_falls_back_to_defaults(self, tmp_path):
        """When the parent has no session.json, fork seeds with identity only and does not crash."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # repo.get must raise: a Mock return value auto-vivifies fields and OOMs the JSONEncoder.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id,
        )
        # Parent dir created (so ensure_session resolves) but no session.json written.
        Workspace(tmp_path).ensure_session(parent_id)

        _live_parent_container(containers, parent_id)

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # Identity present; no inherited user-settings keys (parent had none).
        assert fork_data["session_id"] == result.session_id
        assert fork_data["parent_session_id"] == parent_id
        assert fork_data["workspace"] == str(tmp_path)
        # No KeyError when user-settings keys are absent - they are simply missing.
        assert "permission_mode" not in fork_data
        assert "effort_level" not in fork_data
        assert "session_prompt" not in fork_data

    @pytest.mark.anyio
    async def test_corrupt_parent_session_json_falls_back_to_defaults(self, tmp_path):
        """Unparseable parent session.json - fork seeds with identity only and logs."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # repo.get must raise: a Mock return value auto-vivifies fields and OOMs the JSONEncoder.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id,
        )
        parent_session = Workspace(tmp_path).ensure_session(parent_id)
        (parent_session.path / SESSION_METADATA_FILE).write_text("{not valid json")

        _live_parent_container(containers, parent_id)

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        assert fork_data["session_id"] == result.session_id
        assert fork_data["parent_session_id"] == parent_id
        # Inherited fields are absent - corrupt source means safe-default fallback.
        assert "permission_mode" not in fork_data
        assert "effort_level" not in fork_data


# --- _compute_derived_fields ---


class TestComputeDerivedFields:
    """Unit tests for the JSONL -> counters/snapshots helper used by fork()."""

    @staticmethod
    def _derive(tmp_path: Path, events_path: Path) -> dict:
        """Run the helper on a real service - it delegates to a sibling parse method."""

        svc, _repo, _containers = _make_service(tmp_path)

        return svc._compute_derived_fields(events_path)

    def test_missing_file_yields_zeros(self, tmp_path):
        result = self._derive(tmp_path, tmp_path / "absent.jsonl")
        assert result == {
            "total_cost_usd": 0.0,
            "total_duration_ms": 0,
            "num_turns": 0,
            "last_message": None,
            "last_context_tokens": 0,
            "todos": None,
        }

    def test_empty_file_yields_zeros(self, tmp_path):
        events = tmp_path / "events.jsonl"
        events.write_text("")
        result = self._derive(tmp_path, events)
        assert result["total_cost_usd"] == pytest.approx(0.0)
        assert result["num_turns"] == 0

    def test_sums_langgraph_cost_and_duration_across_result_events(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = [
            {"type": "user", "is_human": True, "content": "hi"},
            {"type": "result", "cost_usd": 0.10, "duration_ms": 1000},
            {"type": "user", "is_human": True, "content": "more"},
            {"type": "result", "cost_usd": 0.25, "duration_ms": 2500},
        ]
        events.write_text("".join(json.dumps(line) + "\n" for line in lines))

        svc, _repo, _containers = _make_service(tmp_path)
        result = svc._compute_derived_fields(events, "LangGraph")

        assert result["total_cost_usd"] == pytest.approx(0.35)
        assert result["total_duration_ms"] == 3500
        assert result["num_turns"] == 2

    def test_a_subagents_prompt_is_neither_a_turn_nor_the_last_message(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = [
            {"type": "user", "is_human": True, "content": "review the diff"},
            {
                "type": "user",
                "is_human": True,
                "content": "Check every hunk.",
                "parent_tool_use_id": "tu_agent",
            },
            {"type": "user", "is_human": True, "content": "now commit"},
            {
                "type": "user",
                "is_human": True,
                "content": "Run the tests.",
                "parent_tool_use_id": "tu_agent2",
            },
        ]
        events.write_text("".join(json.dumps(line) + "\n" for line in lines))

        result = self._derive(tmp_path, events)

        assert (result["num_turns"], result["last_message"]) == (2, "now commit")

    def test_fork_seed_cost_counts_each_turn_once(self, tmp_path):
        events = tmp_path / "events.jsonl"
        totals = (0.68, 4.18, 4.37, 0.50, 0.90)
        events.write_text("".join(_record(type="result", cost_usd=t) for t in totals))

        assert self._derive(tmp_path, events)["total_cost_usd"] == pytest.approx(5.27)

    @pytest.mark.parametrize(
        ("init", "record_runtime", "spent"),
        [
            ({"runtime_name": "LangGraph"}, "Claude", 1.40),
            ({"runtime_name": "Claude"}, "LangGraph", 1.00),
            ({"message_data": {"claude_code_version": "2.1.205"}}, "LangGraph", 1.00),
            ({"message_data": {"claude_code_version": None}}, "LangGraph", 1.40),
            (None, "LangGraph", 1.40),
            (None, None, 1.00),
        ],
        ids=[
            "langgraph-init",
            "claude-init",
            "init-before-runtime-name",
            "versionless-init-falls-to-record",
            "no-init-falls-to-record",
            "no-init-no-record-is-claude",
        ],
    )
    def test_a_figure_follows_the_runtime_of_its_init(
        self,
        tmp_path,
        init,
        record_runtime,
        spent,
    ):
        events = tmp_path / "events.jsonl"
        head = [_record(type="system", subtype="init", **init)] if init is not None else []
        tail = [_record(type="result", cost_usd=0.40), _record(type="result", cost_usd=1.00)]
        events.write_text("".join(head + tail))

        svc, _repo, _containers = _make_service(tmp_path)
        result = svc._compute_derived_fields(events, record_runtime)

        assert result["total_cost_usd"] == pytest.approx(spent)

    def test_a_session_migrated_to_langgraph_reads_each_runtime_on_its_side(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = [
            _record(type="system", subtype="init", runtime_name="Claude"),
            _record(type="result", cost_usd=0.40),
            _record(type="result", cost_usd=1.00),
            _record(type="system", subtype="init", runtime_name="LangGraph"),
            _record(type="result", cost_usd=0.02),
            _record(type="result", cost_usd=0.03),
        ]
        events.write_text("".join(lines))

        svc, _repo, _containers = _make_service(tmp_path)
        result = svc._compute_derived_fields(events, "LangGraph")

        assert result["total_cost_usd"] == pytest.approx(1.05)

    def test_last_message_is_last_human_content(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = [
            {"type": "user", "is_human": True, "content": "first"},
            {"type": "assistant", "is_human": False, "content": "reply"},
            {"type": "user", "is_human": True, "content": "last"},
        ]
        events.write_text("".join(json.dumps(line) + "\n" for line in lines))

        result = self._derive(tmp_path, events)

        assert result["last_message"] == "last"

    def test_last_context_tokens_is_last_seen_value(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = [
            {"type": "result", "context_tokens": 5000},
            {"type": "result", "context_tokens": 12000},
            {"type": "user", "is_human": True, "content": "no tokens here"},
        ]
        events.write_text("".join(json.dumps(line) + "\n" for line in lines))

        result = self._derive(tmp_path, events)

        assert result["last_context_tokens"] == 12000

    def test_todos_from_last_todowrite_tool_input(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = [
            {
                "type": "assistant",
                "tool_name": "TodoWrite",
                "tool_input": {"todos": [{"content": "step 1", "status": "pending"}]},
            },
            {
                "type": "assistant",
                "tool_name": "TodoWrite",
                "tool_input": {"todos": [{"content": "step 2", "status": "in_progress"}]},
            },
        ]
        events.write_text("".join(json.dumps(line) + "\n" for line in lines))

        result = self._derive(tmp_path, events)

        assert result["todos"] == [{"content": "step 2", "status": "in_progress"}]

    def test_skips_blank_lines(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = ["", json.dumps({"type": "result", "cost_usd": 0.5}), "", ""]
        events.write_text("\n".join(lines))

        result = self._derive(tmp_path, events)

        assert result["total_cost_usd"] == pytest.approx(0.5)


# --- fork derives counters from events ---


class TestForkDerivesCounters:
    """Fork counters derive from child events, not parent_data, avoiding parent tail attribution."""

    @staticmethod
    def _write_parent_events(tmp_path: Path, parent_id: str, lines: list[dict]) -> Path:
        parent = Workspace(tmp_path).ensure_session(parent_id)
        (parent.path / "events.jsonl").write_text(
            "".join(json.dumps(line) + "\n" for line in lines),
        )

        return parent.path

    @pytest.mark.anyio
    async def test_fork_without_truncation_carries_full_parent_cost(self, tmp_path):
        """turn_id=None -> child events.jsonl is a full copy; derived totals match parent's."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        _seed_parent_session_json(
            tmp_path,
            parent_id,
            {
                "session_id": parent_id,
                # Parent_data has inflated counters that must not leak via the seed spread.
                "num_turns": 99,
                "total_cost_usd": 99.99,
                "permission_mode": "default",
            },
        )
        self._write_parent_events(
            tmp_path,
            parent_id,
            [
                {"type": "user", "is_human": True, "content": "hi", "turn_id": "t1"},
                {"type": "result", "cost_usd": 0.10, "duration_ms": 500, "turn_id": "t1"},
                {"type": "user", "is_human": True, "content": "more", "turn_id": "t2"},
                {"type": "result", "cost_usd": 0.30, "duration_ms": 1500, "turn_id": "t2"},
            ],
        )

        existing = _make_container("ctr", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # Derived from the events, NOT from parent_data's inflated counters.
        assert fork_data["total_cost_usd"] == pytest.approx(0.30)
        assert fork_data["total_duration_ms"] == 2000
        assert fork_data["num_turns"] == 2
        assert fork_data["last_message"] == "more"
        # fork_point = total_cost_usd at fork time; aggregation attributes zero new spend to it.
        assert fork_data["fork_point_cost_usd"] == pytest.approx(0.30)

    @pytest.mark.anyio
    async def test_a_langgraph_parent_seeds_the_sum_of_its_turns(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        _seed_parent_session_json(
            tmp_path,
            parent_id,
            {"session_id": parent_id, "runtime": "LangGraph", "total_cost_usd": 99.99},
        )
        self._write_parent_events(
            tmp_path,
            parent_id,
            [
                {"type": "result", "cost_usd": 0.10, "turn_id": "t1"},
                {"type": "result", "cost_usd": 0.30, "turn_id": "t2"},
            ],
        )
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr", session_id=parent_id),
        )
        containers.update = AsyncMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = _async_client(
                post=AsyncMock(return_value=MagicMock(raise_for_status=MagicMock())),
            )
            mock_client_cls.return_value = mock_client

            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        assert fork_data["total_cost_usd"] == pytest.approx(0.40)
        assert fork_data["fork_point_cost_usd"] == pytest.approx(0.40)

    @pytest.mark.anyio
    async def test_fork_with_truncation_reflects_truncated_event_set(self, tmp_path):
        """turn_id=t2 -> child keeps events before t2; counters reflect that prefix."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        _seed_parent_session_json(
            tmp_path,
            parent_id,
            {
                "session_id": parent_id,
                "num_turns": 99,
                "total_cost_usd": 99.99,
            },
        )
        self._write_parent_events(
            tmp_path,
            parent_id,
            [
                {"type": "user", "is_human": True, "content": "pre1", "turn_id": "t1"},
                {"type": "result", "cost_usd": 0.10, "duration_ms": 500, "turn_id": "t1"},
                # Truncation cuts here - everything from t2 onward is dropped.
                {"type": "user", "is_human": True, "content": "pre2", "turn_id": "t2"},
                {"type": "result", "cost_usd": 5.00, "duration_ms": 9999, "turn_id": "t2"},
            ],
        )

        existing = _make_container("ctr", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, turn_id="t2", reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # Only the pre-t2 events count toward the child.
        assert fork_data["total_cost_usd"] == pytest.approx(0.10)
        assert fork_data["total_duration_ms"] == 500
        assert fork_data["num_turns"] == 1
        assert fork_data["last_message"] == "pre1"
        # fork_point tracks the truncated total, so aggregation attributes only post-fork spend.
        assert fork_data["fork_point_cost_usd"] == pytest.approx(0.10)

    @pytest.mark.anyio
    async def test_inflated_parent_counters_do_not_leak(self, tmp_path):
        """Even when parent_data has accumulated counters set, the seed ignores them."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        _seed_parent_session_json(
            tmp_path,
            parent_id,
            {
                "session_id": parent_id,
                # Every leakable field set to a sentinel the child should NOT see.
                "num_turns": 9999,
                "total_cost_usd": 9999.99,
                "total_duration_ms": 9999999,
                "last_message": "PARENT-TAIL",
                "last_context_tokens": 999999,
                "todos": [{"content": "PARENT-TODO", "status": "in_progress"}],
            },
        )
        # No events on disk -> derived returns zeros/None.

        existing = _make_container("ctr", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # None of the parent's accumulated-counter sentinels leak into the child.
        assert fork_data["num_turns"] == 0
        assert fork_data["total_cost_usd"] == pytest.approx(0.0)
        assert fork_data["total_duration_ms"] == 0
        assert fork_data["last_message"] is None
        assert fork_data["last_context_tokens"] == 0
        assert fork_data["todos"] is None
        assert fork_data["fork_point_cost_usd"] == pytest.approx(0.0)


class TestForkRekeysLangGraphCheckpoint:
    """Fork re-keys a copied checkpoints.sqlite onto the fork's own thread_id."""

    @staticmethod
    def _seed_checkpoint(tmp_path: Path, parent_id: str) -> Path:
        """Write a checkpoints.sqlite for the parent, matching AsyncSqliteSaver's own schema."""

        parent = Workspace(tmp_path).ensure_session(parent_id)
        db_path = parent.path / "checkpoints.sqlite"
        conn = sqlite3.connect(db_path)
        conn.executescript(
            """
            CREATE TABLE checkpoints (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                parent_checkpoint_id TEXT,
                type TEXT,
                checkpoint BLOB,
                metadata BLOB,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            );
            CREATE TABLE writes (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                channel TEXT NOT NULL,
                type TEXT,
                value BLOB,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
            );
            """,
        )
        conn.execute(
            "INSERT INTO checkpoints VALUES (?, '', 'chk-1', NULL, 'msgpack', X'00', X'01')",
            (parent_id,),
        )
        conn.execute(
            "INSERT INTO writes VALUES (?, '', 'chk-1', 'task-1', 0, 'messages', 'msgpack', X'02')",
            (parent_id,),
        )
        conn.commit()
        conn.close()

        return db_path

    @pytest.mark.anyio
    async def test_copied_checkpoint_rekeyed_to_child_thread_id(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        self._seed_checkpoint(tmp_path, parent_id)

        existing = _make_container("ctr", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        child_db = Workspace(tmp_path).ensure_session(result.session_id).path / "checkpoints.sqlite"
        conn = sqlite3.connect(child_db)

        try:
            checkpoint_thread_ids = [
                row[0] for row in conn.execute("SELECT thread_id FROM checkpoints")
            ]
            write_thread_ids = [row[0] for row in conn.execute("SELECT thread_id FROM writes")]
        finally:
            conn.close()

        # Re-keyed onto the child, not left pointing at the parent.
        assert checkpoint_thread_ids == [result.session_id]
        assert write_thread_ids == [result.session_id]
        assert parent_id not in checkpoint_thread_ids
        assert parent_id not in write_thread_ids

    @pytest.mark.anyio
    async def test_no_checkpoint_file_is_a_silent_noop(self, tmp_path):
        """A Claude-runtime session has no checkpoints.sqlite - fork must not fail on it."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        # No checkpoint file seeded.

        existing = _make_container("ctr", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        with _posting_client():
            _plant_transcript(tmp_path, parent_id)
            result = await svc.fork(parent_id, reuse_container=True)

        child_db = Workspace(tmp_path).ensure_session(result.session_id).path / "checkpoints.sqlite"
        assert not child_db.exists()


class TestForkTruncatesLangGraphCheckpoint:
    """Fork truncates the copied checkpoint at the journal's boundary to match its transcript."""

    @staticmethod
    def _seed_checkpoint_chain(tmp_path: Path, parent_id: str, checkpoint_ids: list[str]) -> Path:
        """Write a checkpoints.sqlite with one row per id, matching AsyncSqliteSaver's schema."""

        parent = Workspace(tmp_path).ensure_session(parent_id)
        db_path = parent.path / "checkpoints.sqlite"
        conn = sqlite3.connect(db_path)
        conn.executescript(
            """
            CREATE TABLE checkpoints (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                parent_checkpoint_id TEXT,
                type TEXT,
                checkpoint BLOB,
                metadata BLOB,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            );
            CREATE TABLE writes (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                channel TEXT NOT NULL,
                type TEXT,
                value BLOB,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
            );
            """,
        )

        for i, checkpoint_id in enumerate(checkpoint_ids):
            conn.execute(
                "INSERT INTO checkpoints VALUES (?, '', ?, NULL, 'msgpack', X'00', X'01')",
                (parent_id, checkpoint_id),
            )
            conn.execute(
                "INSERT INTO writes VALUES (?, '', ?, ?, 0, 'messages', 'msgpack', X'02')",
                (parent_id, checkpoint_id, f"task-{i}"),
            )

        conn.commit()
        conn.close()

        return db_path

    @staticmethod
    def _fork_checkpoint_ids(tmp_path: Path, new_session_id: str) -> list[str]:
        db_path = Workspace(tmp_path).ensure_session(new_session_id).path / "checkpoints.sqlite"
        conn = sqlite3.connect(db_path)

        try:
            return [
                row[0]
                for row in conn.execute(
                    "SELECT checkpoint_id FROM checkpoints ORDER BY checkpoint_id",
                )
            ]
        finally:
            conn.close()

    @staticmethod
    async def _fork_at_turn(svc, containers, parent_id: str, turn_id: str):
        existing = _make_container("ctr", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        with _posting_client():
            _plant_transcript(svc._workspace.path, parent_id)

            return await svc.fork(parent_id, turn_id=turn_id, reuse_container=True)

    @pytest.mark.anyio
    async def test_truncation_deletes_checkpoints_at_and_after_boundary(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        self._seed_checkpoint_chain(tmp_path, parent_id, ["chk-1", "chk-2", "chk-3", "chk-4"])
        write_json(
            Workspace(tmp_path).ensure_session(parent_id).path / "checkpoint_turns.json",
            {"turn-rewind": "chk-2"},
        )

        result = await self._fork_at_turn(svc, containers, parent_id, "turn-rewind")

        # Boundary survives (state right before the rewound-away turn); everything after it is gone.
        assert self._fork_checkpoint_ids(tmp_path, result.session_id) == ["chk-1", "chk-2"]

    @pytest.mark.anyio
    async def test_first_turn_boundary_deletes_the_whole_chain(self, tmp_path):
        """A None boundary: the rewound-away turn was the thread's first, nothing precedes it."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        self._seed_checkpoint_chain(tmp_path, parent_id, ["chk-1", "chk-2"])
        write_json(
            Workspace(tmp_path).ensure_session(parent_id).path / "checkpoint_turns.json",
            {"turn-first": None},
        )

        result = await self._fork_at_turn(svc, containers, parent_id, "turn-first")

        assert self._fork_checkpoint_ids(tmp_path, result.session_id) == []

    @pytest.mark.anyio
    async def test_missing_journal_entry_is_a_noop(self, tmp_path):
        """No journal entry for the turn - keep the full checkpoint rather than bound blindly."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        _repo.get.side_effect = SharedSessionNotFound(parent_id)
        self._seed_checkpoint_chain(tmp_path, parent_id, ["chk-1", "chk-2", "chk-3"])
        # No checkpoint_turns.json written at all.

        result = await self._fork_at_turn(svc, containers, parent_id, "turn-unknown")

        assert self._fork_checkpoint_ids(tmp_path, result.session_id) == ["chk-1", "chk-2", "chk-3"]


def _patched_container_http(session_id: str = "sess-new"):
    """Patch httpx so every container call answers 200 with `session_id`; returns (patcher, client)."""

    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json.return_value = {"session_id": session_id}
    client = _async_client(
        get=AsyncMock(return_value=response),
        post=AsyncMock(return_value=response),
    )
    patcher = patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient")

    return patcher, client


class TestSessionBundle:
    """A session is created under a bundle, stamped with its name, and re-resolved by name."""

    @pytest.mark.anyio
    async def test_create_stamps_the_bundle_readable_through_the_repository(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-new", port=9090)
        containers.create = AsyncMock(return_value=container)
        containers.update = AsyncMock()
        containers.get.return_value = container
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create(bundle="research")

        containers.create.assert_awaited_once_with(bundle="research")
        assert result.bundle == "research"
        assert SessionRepository(Workspace(tmp_path)).get("sess-new").bundle == "research"

    @pytest.mark.anyio
    async def test_create_without_a_bundle_writes_no_record(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        container = _make_container("ctr-new", port=9090)
        containers.create = AsyncMock(return_value=container)
        containers.update = AsyncMock()
        containers.get.return_value = container
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create()

        containers.create.assert_awaited_once_with(bundle=None)
        assert result.bundle is None
        path = Workspace(tmp_path).ensure_session("sess-new").path / SESSION_METADATA_FILE
        assert not path.exists()

    @pytest.mark.anyio
    async def test_resume_spawns_under_the_recorded_bundle(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1", bundle="research")
        container = _make_container("ctr-new", port=9090)
        containers.find_by_session = AsyncMock(return_value=None)
        containers.create = AsyncMock(return_value=container)
        containers.get.return_value = container
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            await svc.resume("sess-1")

        containers.create.assert_awaited_once_with(session_id="sess-1", bundle="research")

    @pytest.mark.anyio
    async def test_resume_under_a_deleted_bundle_fails_naming_both(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1", bundle="gone")
        containers.find_by_session = AsyncMock(return_value=None)
        containers.create = AsyncMock(
            side_effect=BundleNotDeclared(bundle="gone", session_id="sess-1"),
        )
        containers.stop_container = AsyncMock()
        containers.remove = AsyncMock()

        with pytest.raises(BundleNotDeclared) as excinfo:
            await svc.resume("sess-1")

        assert excinfo.value.context == {"bundle": "gone", "session_id": "sess-1"}
        containers.remove.assert_not_awaited()

    @pytest.mark.anyio
    async def test_resume_under_a_refused_mode_starts_nothing(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1")
        containers.find_by_session = AsyncMock(return_value=None)
        containers.create = AsyncMock(
            side_effect=NetworkModeUnsupported(
                mode="host",
                source="workspace",
                session_id="sess-1",
            ),
        )
        containers.remove = AsyncMock()

        with pytest.raises(NetworkModeUnsupported):
            await svc.resume("sess-1")

        containers.remove.assert_not_awaited()

    @pytest.mark.anyio
    async def test_fork_into_its_own_container_inherits_and_applies_the_bundle(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.side_effect = SharedSessionNotFound("sess-parent")
        _seed_parent_session_json(
            tmp_path,
            "sess-parent",
            {"session_id": "sess-parent", "bundle": "research"},
        )
        container = _make_container("ctr-fork", port=9090)
        containers.create = AsyncMock(return_value=container)
        svc._wait_for_health = AsyncMock()
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            _plant_transcript(tmp_path, "sess-parent")
            result = await svc.fork("sess-parent")

        containers.create.assert_awaited_once_with(session_id=result.session_id, bundle="research")
        assert _read_fork_session_json(tmp_path, result.session_id)["bundle"] == "research"
        assert result.bundle == "research"

    @pytest.mark.anyio
    async def test_an_unbundled_fork_seed_carries_no_bundle_key(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.side_effect = SharedSessionNotFound("sess-parent")
        _seed_parent_session_json(tmp_path, "sess-parent", {"session_id": "sess-parent"})
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-existing", session_id="sess-parent"),
        )
        containers.update = AsyncMock()
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            _plant_transcript(tmp_path, "sess-parent")
            result = await svc.fork("sess-parent", reuse_container=True)

        assert "bundle" not in _read_fork_session_json(tmp_path, result.session_id)

    @pytest.mark.anyio
    async def test_a_side_thread_reports_its_parents_bundle_and_spawns_nothing(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.side_effect = SharedSessionNotFound("sess-parent")
        _seed_parent_session_json(
            tmp_path,
            "sess-parent",
            {"session_id": "sess-parent", "bundle": "research"},
        )
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-existing", session_id="sess-parent"),
        )
        containers.update = AsyncMock()
        containers.create = AsyncMock()
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            _plant_transcript(tmp_path, "sess-parent")
            result = await svc.fork("sess-parent", share_container=True)

        containers.create.assert_not_awaited()
        assert result.bundle == "research"
        assert _read_fork_session_json(tmp_path, result.session_id)["bundle"] == "research"


def _write_bundle_settings(tmp_path: Path, body: str) -> None:
    settings = tmp_path / ".claudebox" / "settings.toml"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(f"root = true\n{body}")


def _creating_service(tmp_path: Path, *, agent: str = "claude"):
    """A service whose container spawns, answers and records every proxied send."""

    svc, _repo, containers = _make_service(tmp_path)
    svc._agent = agent
    container = _make_container("ctr-new", port=9090)
    containers.create = AsyncMock(return_value=container)
    containers.update = AsyncMock()
    containers.get.return_value = container
    containers.send = AsyncMock(return_value={})

    return svc, containers


def _sends(containers) -> list[tuple[str, str, dict]]:
    return [
        (call.kwargs["method"], call.kwargs["endpoint"], call.kwargs["payload"])
        for call in containers.send.await_args_list
    ]


class TestBundleSeeding:
    """A bundle's starting values are applied on creation, before its opening messages."""

    @pytest.mark.anyio
    async def test_declared_values_are_applied_in_drain_order(self, tmp_path):
        _write_bundle_settings(
            tmp_path,
            "[bundles.research]\n"
            'session_prompt = "Cite file:line."\n'
            'effort_level = "max"\n'
            'permission_mode = "plan"\n'
            'model = "claude-opus-5-5"\n',
        )
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create(bundle="research")

        assert _sends(containers) == [
            ("POST", "api/model?session_id=sess-new", {"model": "claude-opus-5-5"}),
            ("POST", "api/permission-mode?session_id=sess-new", {"permission_mode": "plan"}),
            ("POST", "api/effort-level?session_id=sess-new", {"effort_level": "max"}),
        ]
        assert result.failed_seeds is None
        assert (result.model, result.permission_mode, result.effort_level) == (
            "claude-opus-5-5",
            "plan",
            "max",
        )
        record = SessionRepository(Workspace(tmp_path)).get("sess-new")
        assert record.bundle == "research"
        assert (
            read_json(
                Workspace(tmp_path).ensure_session("sess-new").path / SESSION_METADATA_FILE,
            )["session_prompt"]
            == "Cite file:line."
        )

    @pytest.mark.anyio
    async def test_a_partial_bundle_seeds_only_what_it_declares(self, tmp_path):
        _write_bundle_settings(tmp_path, '[bundles.fast]\nmodel = "claude-sonnet-5"\n')
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            await svc.create(bundle="fast")

        assert _sends(containers) == [
            ("POST", "api/model?session_id=sess-new", {"model": "claude-sonnet-5"}),
        ]

    @pytest.mark.anyio
    async def test_seeding_precedes_the_prompts_it_delivers(self, tmp_path):
        _write_bundle_settings(tmp_path, '[bundles.fast]\nmodel = "claude-sonnet-5"\n')
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            await svc.create_with_prompts(["first", "second"], bundle="fast")

        assert [endpoint for _, endpoint, _ in _sends(containers)] == [
            "api/model?session_id=sess-new",
            "api/send",
            "api/send",
        ]

    @pytest.mark.anyio
    async def test_a_failed_seed_is_reported_and_creation_still_succeeds(self, tmp_path):
        _write_bundle_settings(
            tmp_path,
            '[bundles.research]\nmodel = "claude-opus-5-5"\neffort_level = "max"\n',
        )
        svc, containers = _creating_service(tmp_path)

        async def refuse_the_model(**kwargs):
            if kwargs["endpoint"].startswith("api/model"):
                raise ContainerTimeout(container_id="ctr-new")

            return {}

        containers.send = AsyncMock(side_effect=refuse_the_model)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create(bundle="research")

        assert result.session_id == "sess-new"
        assert result.failed_seeds == ["model"]
        assert result.model == ClaudeRuntime.DEFAULT_MODEL
        assert result.effort_level == "max"
        assert "api/effort-level?session_id=sess-new" in [e for _, e, _ in _sends(containers)]

    @pytest.mark.anyio
    async def test_a_runtime_that_cannot_change_them_skips_the_three_pickers(self, tmp_path):
        _write_bundle_settings(
            tmp_path,
            "[bundles.research]\n"
            'model = "m"\npermission_mode = "plan"\neffort_level = "max"\n'
            'session_prompt = "Be brief."\n',
        )
        svc, containers = _creating_service(tmp_path, agent="langgraph")
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create(bundle="research")

        containers.send.assert_not_awaited()
        assert result.failed_seeds is None
        assert (
            read_json(
                Workspace(tmp_path).ensure_session("sess-new").path / SESSION_METADATA_FILE,
            )["session_prompt"]
            == "Be brief."
        )

    @pytest.mark.anyio
    async def test_resume_seeds_nothing(self, tmp_path):
        _write_bundle_settings(tmp_path, '[bundles.fast]\nmodel = "claude-sonnet-5"\n')
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1", bundle="fast")
        container = _make_container("ctr-new", port=9090)
        containers.find_by_session = AsyncMock(return_value=None)
        containers.create = AsyncMock(return_value=container)
        containers.get.return_value = container
        containers.send = AsyncMock(return_value={})
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            await svc.resume("sess-1")

        containers.send.assert_not_awaited()

    @pytest.mark.anyio
    async def test_an_unbundled_session_seeds_nothing(self, tmp_path):
        _write_bundle_settings(tmp_path, '[bundles.fast]\nmodel = "claude-sonnet-5"\n')
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create()

        containers.send.assert_not_awaited()
        assert result.failed_seeds is None


class TestSpawnSeeding:
    """A spawn's explicit model and effort overlay the bundle's, and land before any message."""

    @pytest.mark.anyio
    async def test_explicit_values_win_over_the_bundles(self, tmp_path):
        _write_bundle_settings(
            tmp_path,
            '[bundles.research]\nmodel = "claude-opus-5-5"\neffort_level = "max"\n',
        )
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create(bundle="research", model="haiku", effort_level="low")

        assert _sends(containers) == [
            ("POST", "api/model?session_id=sess-new", {"model": "haiku"}),
            ("POST", "api/effort-level?session_id=sess-new", {"effort_level": "low"}),
        ]
        assert (result.model, result.effort_level) == ("haiku", "low")

    @pytest.mark.anyio
    async def test_an_explicit_effort_alone_is_seeded_without_a_bundle(self, tmp_path):
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create(effort_level="medium")

        assert _sends(containers) == [
            ("POST", "api/effort-level?session_id=sess-new", {"effort_level": "medium"}),
        ]
        assert result.failed_seeds is None

    @pytest.mark.anyio
    async def test_an_explicit_value_the_runtime_cannot_set_is_reported_failed(self, tmp_path):
        _write_bundle_settings(tmp_path, '[bundles.research]\npermission_mode = "plan"\n')
        svc, containers = _creating_service(tmp_path, agent="langgraph")
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create(bundle="research", model="m", effort_level="low")

        containers.send.assert_not_awaited()
        assert result.failed_seeds == ["model", "effort_level"]

    @pytest.mark.anyio
    async def test_the_settings_precede_the_prompt(self, tmp_path):
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")

        with patcher as client_cls:
            client_cls.return_value = client
            await svc.create_with_prompt("go", model="haiku")

        assert [endpoint for _, endpoint, _ in _sends(containers)] == [
            "api/model?session_id=sess-new",
            "api/send",
        ]

    @pytest.mark.anyio
    async def test_name_and_lineage_are_on_disk_before_the_listing_is_told(self, tmp_path):
        svc, containers = _creating_service(tmp_path)
        patcher, client = _patched_container_http("sess-new")
        path = Workspace(tmp_path).ensure_session("sess-new").path / SESSION_METADATA_FILE
        seen_at_broadcast: list[dict] = []

        async def capture(_event):
            seen_at_broadcast.append(read_json(path, default={}) or {})

        svc._events.broadcast = AsyncMock(side_effect=capture)

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.create_with_prompt(
                "go",
                spawned_from_session_id="parent-1",
                name="lint-fix",
            )

        changed = [
            seen
            for seen, call in zip(
                seen_at_broadcast,
                svc._events.broadcast.await_args_list,
                strict=True,
            )
            if call.args[0].type == "sessions_changed"
        ]
        assert changed[0]["spawned_from_session_id"] == "parent-1"
        assert changed[0]["name"] == "lint-fix"
        assert (result.name, result.spawned_from_session_id) == ("lint-fix", "parent-1")
        containers.create.assert_awaited_once_with(bundle=None)


def _sibling_info(session_id: str, **overrides) -> SessionInfo:
    return SessionInfo(session_id=session_id, fork_point_cost_usd=0.0, **overrides)


class TestSpawnedSiblings:
    """A caller resumes, lists and stops only the sessions whose recorded spawner it is."""

    @staticmethod
    def _service(tmp_path, records: dict[str, SessionMetadata]):
        svc, repo, containers = _make_service(tmp_path)

        def get(session_id):
            if session_id not in records:
                raise SharedSessionNotFound(session_id=session_id)

            return records[session_id]

        repo.get.side_effect = get

        return svc, containers

    @pytest.mark.anyio
    @pytest.mark.parametrize("target", ["stranger", "missing"])
    async def test_a_session_the_caller_did_not_spawn_is_refused(self, tmp_path, target):
        records = {"stranger": _make_metadata("stranger", spawned_from_session_id="someone-else")}
        svc, containers = self._service(tmp_path, records)
        containers.stop_container = AsyncMock()

        with pytest.raises(SiblingNotOwned):
            await svc.stop_spawned("parent-1", target)

        with pytest.raises(SiblingNotOwned):
            await svc.resume_spawned("parent-1", target)

        containers.stop_container.assert_not_awaited()

    @pytest.mark.anyio
    async def test_resume_reports_a_new_container_as_resumed(self, tmp_path):
        records = {"sib": _make_metadata("sib", spawned_from_session_id="parent-1")}
        svc, containers = self._service(tmp_path, records)
        containers.find_by_session = AsyncMock(return_value=None)

        with patch.object(
            svc,
            "resume",
            new=AsyncMock(return_value=_sibling_info("sib", container_id="ctr-new")),
        ):
            info, resumed = await svc.resume_spawned("parent-1", "sib")

        assert (info.container_id, resumed) == ("ctr-new", True)

    @pytest.mark.anyio
    async def test_resume_adopts_a_running_sibling_in_place(self, tmp_path):
        records = {"sib": _make_metadata("sib", spawned_from_session_id="parent-1")}
        svc, containers = self._service(tmp_path, records)
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-1", session_id="sib"),
        )

        with patch.object(
            svc,
            "resume",
            new=AsyncMock(return_value=_sibling_info("sib", container_id="ctr-1")),
        ):
            _, resumed = await svc.resume_spawned("parent-1", "sib")

        assert resumed is False

    @pytest.mark.anyio
    async def test_list_names_own_siblings_oldest_first_with_their_state(self, tmp_path):
        from datetime import UTC, datetime

        svc, containers = self._service(tmp_path, {})
        containers.list_all = MagicMock(
            return_value=[
                _make_container("ctr-a", session_id="a"),
                _make_container("ctr-c", session_id="c", status=ContainerStatus.STARTING),
            ],
        )
        sessions = (
            _sibling_info(
                "c",
                spawned_from_session_id="p",
                container_id="ctr-c",
                started_at=datetime(2026, 1, 3, tzinfo=UTC),
            ),
            _sibling_info(
                "a",
                spawned_from_session_id="p",
                container_id="ctr-a",
                name="hand",
                auto_name="auto",
                activity="working",
                started_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
            _sibling_info(
                "b",
                spawned_from_session_id="p",
                auto_name="auto-b",
                started_at=datetime(2026, 1, 2, tzinfo=UTC),
            ),
            _sibling_info(
                "x",
                spawned_from_session_id="other",
                started_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
            _sibling_info(
                "d",
                spawned_from_session_id="p",
                container_id="ctr-a",
                started_at=datetime(2026, 1, 4, tzinfo=UTC),
            ),
        )

        with patch.object(
            svc,
            "list_all",
            new=AsyncMock(return_value=MagicMock(sessions=sessions)),
        ):
            siblings = await svc.list_spawned("p")

        assert [(s.session_id, s.name, s.state) for s in siblings] == [
            ("a", "hand", "working"),
            ("b", "auto-b", "stopped"),
            ("c", None, "working"),
            ("d", None, "idle"),
        ]

    @pytest.mark.anyio
    async def test_a_stop_reaches_the_whole_tree_deepest_first(self, tmp_path):
        records = {"child": _make_metadata("child", spawned_from_session_id="parent-1")}
        svc, containers = self._service(tmp_path, records)
        sessions = (
            _sibling_info("child", spawned_from_session_id="parent-1"),
            _sibling_info("grand", spawned_from_session_id="child"),
            _sibling_info("great", spawned_from_session_id="grand"),
            _sibling_info("unrelated", spawned_from_session_id="parent-1"),
        )
        running = {
            sid: _make_container(f"ctr-{sid}", session_id=sid)
            for sid in ("child", "grand", "great", "unrelated")
        }
        containers.find_by_session = AsyncMock(side_effect=lambda sid, **_: running.get(sid))
        stopped: list[str] = []
        containers.stop_container = AsyncMock(side_effect=stopped.append)
        containers.remove = AsyncMock()

        with patch.object(
            svc,
            "list_all",
            new=AsyncMock(return_value=MagicMock(sessions=sessions)),
        ):
            await svc.stop_spawned("parent-1", "child")

        assert stopped == ["ctr-great", "ctr-grand", "ctr-child"]
        assert [call.args[0] for call in containers.remove.await_args_list] == stopped

    @pytest.mark.anyio
    async def test_a_live_reply_thread_in_the_tree_refuses_the_whole_stop(self, tmp_path):
        records = {"child": _make_metadata("child", spawned_from_session_id="parent-1")}
        svc, containers = self._service(tmp_path, records)
        sessions = (
            _sibling_info("child", spawned_from_session_id="parent-1"),
            _sibling_info("grand", spawned_from_session_id="child"),
        )
        running = {
            "child": _make_container("ctr-child", session_id="child"),
            "grand": _make_container(
                "ctr-grand",
                session_id="grand",
                members=["thread-1", "thread-old"],
                live_session_ids=["grand", "thread-1"],
            ),
        }
        containers.find_by_session = AsyncMock(side_effect=lambda sid, **_: running.get(sid))
        containers.stop_container = AsyncMock()

        with (
            patch.object(svc, "list_all", new=AsyncMock(return_value=MagicMock(sessions=sessions))),
            pytest.raises(SiblingStopHostsThread) as refused,
        ):
            await svc.stop_spawned("parent-1", "child")

        assert refused.value.context["session_id"] == "thread-1"
        containers.stop_container.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_stopped_sibling_stops_as_a_no_op(self, tmp_path):
        records = {"child": _make_metadata("child", spawned_from_session_id="parent-1")}
        svc, containers = self._service(tmp_path, records)
        containers.find_by_session = AsyncMock(return_value=None)
        containers.stop_container = AsyncMock()

        with patch.object(
            svc,
            "list_all",
            new=AsyncMock(
                return_value=MagicMock(
                    sessions=(_sibling_info("child", spawned_from_session_id="parent-1"),),
                ),
            ),
        ):
            await svc.stop_spawned("parent-1", "child")

        containers.stop_container.assert_not_awaited()


class TestDeliverTurnEnd:
    """A spawned session's turn end reaches its spawner's current container, or waits on disk."""

    @staticmethod
    def _service(tmp_path, *, parent_container: str | None):
        svc, repo, containers = _make_service(tmp_path)
        records = {
            "sib": _make_metadata("sib", spawned_from_session_id="parent-1", auto_name="lint-fix"),
            "parent-1": _make_metadata("parent-1"),
            "root": _make_metadata("root"),
        }

        def get(session_id):
            if session_id not in records:
                raise SharedSessionNotFound(session_id=session_id)

            return records[session_id]

        repo.get.side_effect = get
        container = (
            _make_container(parent_container, session_id="parent-1") if parent_container else None
        )
        containers.find_by_session = AsyncMock(return_value=container)
        containers.send = AsyncMock(return_value={})

        return svc, containers

    @pytest.mark.anyio
    async def test_a_running_spawner_gets_it_in_its_current_container(self, tmp_path):
        svc, containers = self._service(tmp_path, parent_container="ctr-now")

        outcome = await svc.deliver_turn_end("sib", delivery_id="d1", outcome="ended", text="Done.")

        assert outcome == "delivered"
        containers.send.assert_awaited_once_with(
            payload={
                "from_session_id": "sib",
                "from_name": "lint-fix",
                "delivery_id": "d1",
                "outcome": "ended",
                "text": "Done.",
            },
            container_id="ctr-now",
            endpoint="api/sibling-message?session_id=parent-1",
            method="POST",
        )

    @pytest.mark.anyio
    async def test_a_stopped_spawner_has_it_held_in_order(self, tmp_path):
        svc, containers = self._service(tmp_path, parent_container=None)

        first = await svc.deliver_turn_end("sib", delivery_id="d1", outcome="ended", text="one")
        await svc.deliver_turn_end("sib", delivery_id="d2", outcome="failed", text="two")

        held = (
            Workspace(tmp_path).ensure_session("parent-1").path / "sibling-messages.pending.jsonl"
        )
        assert first == "held"
        assert [json.loads(line)["delivery_id"] for line in held.read_text().splitlines()] == [
            "d1",
            "d2",
        ]
        containers.send.assert_not_awaited()

    @pytest.mark.anyio
    @pytest.mark.parametrize("caller", ["root", "ghost"])
    async def test_a_session_nobody_spawned_is_refused(self, tmp_path, caller):
        svc, _ = self._service(tmp_path, parent_container="ctr-now")

        with pytest.raises(SessionNotSpawned):
            await svc.deliver_turn_end(caller, delivery_id="d1", outcome="ended", text="x")

    @pytest.mark.anyio
    async def test_a_send_that_fails_is_reported_unreachable(self, tmp_path):
        svc, containers = self._service(tmp_path, parent_container="ctr-now")
        containers.send = AsyncMock(side_effect=ContainerTimeout(container_id="ctr-now"))

        with pytest.raises(SpawnerUnreachable):
            await svc.deliver_turn_end("sib", delivery_id="d1", outcome="ended", text="x")

    @pytest.mark.anyio
    async def test_a_turn_its_spawners_stop_cut_short_is_dropped(self, tmp_path):
        svc, containers = self._service(tmp_path, parent_container="ctr-now")
        svc._stopped_by_spawner.add("sib")

        outcome = await svc.deliver_turn_end(
            "sib",
            delivery_id="d1",
            outcome="interrupted",
            text="x",
        )

        assert outcome == "dropped"
        containers.send.assert_not_awaited()


def _plant_transcript(workspace_path: Path, session_id: str) -> Path:
    """Write a transcript where the CLI would, in a project folder named as it names them."""

    folder = Workspace(workspace_path).sdk_projects_root / "-home-dev-my-app"
    folder.mkdir(parents=True, exist_ok=True)
    transcript = folder / f"{session_id}.jsonl"

    if not transcript.exists():
        transcript.write_text('{"type":"user","uuid":"t1"}\n')

    return transcript


class TestForkFindsTheTranscriptById:
    """A fork continues the source's transcript wherever the CLI filed it, or is refused."""

    @staticmethod
    def _reusing_service(tmp_path, parent_id="sess-parent", **service_kwargs):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.side_effect = SharedSessionNotFound(parent_id)
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-existing", session_id=parent_id),
        )
        containers.update = AsyncMock()
        containers.create = AsyncMock()

        return svc, containers

    @pytest.mark.anyio
    async def test_whole_and_turn_bounded_forks_write_beside_the_source(self, tmp_path):
        svc, _containers = self._reusing_service(tmp_path)
        _seed_parent_session_json(tmp_path, "sess-parent", {"session_id": "sess-parent"})
        transcript = _plant_transcript(tmp_path, "sess-parent")
        transcript.write_text(
            '{"type":"user","uuid":"t1"}\n{"type":"assistant","uuid":"a1"}\n'
            '{"type":"user","uuid":"t2"}\n{"type":"assistant","uuid":"a2"}\n',
        )
        (transcript.parent / "sess-parent" / "tool-results").mkdir(parents=True)
        (transcript.parent / "sess-parent" / "tool-results" / "toolu_1.txt").write_text("out")
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            whole = await svc.fork("sess-parent", reuse_container=True)
            bounded = await svc.fork("sess-parent", turn_id="t2", reuse_container=True)

        folder = transcript.parent
        assert (folder / f"{whole.session_id}.jsonl").read_text() == transcript.read_text()
        assert (folder / f"{bounded.session_id}.jsonl").read_text() == (
            '{"type":"user","uuid":"t1"}\n{"type":"assistant","uuid":"a1"}\n'
        )
        assert (folder / whole.session_id / "tool-results" / "toolu_1.txt").read_text() == "out"

    @pytest.mark.anyio
    async def test_a_claude_fork_without_a_transcript_is_refused_before_anything_moves(
        self,
        tmp_path,
    ):
        svc, containers = self._reusing_service(tmp_path)
        _seed_parent_session_json(
            tmp_path,
            "sess-parent",
            {"session_id": "sess-parent", "runtime": "Claude"},
        )
        sessions_before = sorted(p.name for p in Workspace(tmp_path).sessions_root.iterdir())
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client

            with pytest.raises(SessionTranscriptMissing) as excinfo:
                await svc.fork("sess-parent", reuse_container=True)

        assert excinfo.value.status_code == 409
        assert (
            sorted(p.name for p in Workspace(tmp_path).sessions_root.iterdir()) == sessions_before
        )
        containers.update.assert_not_awaited()
        containers.create.assert_not_awaited()
        client.post.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_langgraph_fork_needs_no_transcript(self, tmp_path):
        svc, containers = self._reusing_service(tmp_path)
        _seed_parent_session_json(
            tmp_path,
            "sess-parent",
            {"session_id": "sess-parent", "runtime": "LangGraph"},
        )
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.fork("sess-parent", reuse_container=True)

        assert result.parent_session_id == "sess-parent"
        containers.update.assert_awaited_once()

    @pytest.mark.anyio
    async def test_the_local_backend_root_is_searched_when_given(self, tmp_path, monkeypatch):
        monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path / "host-claude"))
        (tmp_path / ".workspace").touch()
        svc = SessionService(
            RegisteredWorkspace(id="test-ws", path=tmp_path),
            MagicMock(),
            AsyncMock(),
            agent="claude",
            executor=ObservedPool(1, name="listing"),
            projects_root=claude_projects_root(),
        )
        svc._repo = MagicMock()
        svc._repo.get.side_effect = SharedSessionNotFound("sess-parent")
        svc._containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-existing", session_id="sess-parent"),
        )
        svc._containers.update = AsyncMock()
        _seed_parent_session_json(tmp_path, "sess-parent", {"session_id": "sess-parent"})
        folder = tmp_path / "host-claude" / "projects" / "-root-bh-my-app"
        folder.mkdir(parents=True)
        (folder / "sess-parent.jsonl").write_text('{"type":"user","uuid":"t1"}\n')
        patcher, client = _patched_container_http()

        with patcher as client_cls:
            client_cls.return_value = client
            result = await svc.fork("sess-parent", reuse_container=True)

        assert (folder / f"{result.session_id}.jsonl").exists()


class TestForkCopiesNeverFollowSymlinks:
    """A fork copies the session's own bytes; a link the agent planted never reads a host file."""

    @staticmethod
    def _sessions(tmp_path):
        ws, src, dst = TestCopyClaudeboxSession()._make_ws(tmp_path)
        (src.path / "tmp").mkdir(parents=True)
        host_file = tmp_path / "host" / "id_rsa"
        host_file.parent.mkdir()
        host_file.write_text("HOST PRIVATE KEY")

        return ws, src.path, dst.path, host_file

    @staticmethod
    def _contents(root):
        return [p.read_text() for p in root.rglob("*") if p.is_file() and not p.is_symlink()]

    def test_an_absolute_link_is_dropped_and_its_target_never_copied(self, tmp_path):
        ws, src, dst, host_file = self._sessions(tmp_path)
        (src / "tmp" / "x").symlink_to(host_file)

        SessionService._copy_claudebox_session(MagicMock(), ws, "source", "dest")

        assert not (dst / "tmp" / "x").is_symlink()
        assert not (dst / "tmp" / "x").exists()
        assert "HOST PRIVATE KEY" not in self._contents(dst)

    def test_a_relative_link_climbing_out_is_dropped(self, tmp_path):
        ws, src, dst, _host_file = self._sessions(tmp_path)
        (src / "tmp" / "a").mkdir()
        (src / "tmp" / "up").symlink_to("a/../../../host/id_rsa")

        SessionService._copy_claudebox_session(MagicMock(), ws, "source", "dest")

        assert not (dst / "tmp" / "up").is_symlink()
        assert "HOST PRIVATE KEY" not in self._contents(dst)

    def test_a_link_to_the_session_itself_does_not_recurse(self, tmp_path):
        ws, src, dst, _host_file = self._sessions(tmp_path)
        (src / "events.jsonl").write_text("{}\n")
        (src / "tmp" / "repo").symlink_to(src)

        worker = threading.Thread(
            target=SessionService._copy_claudebox_session,
            args=(MagicMock(), ws, "source", "dest"),
            daemon=True,
        )
        worker.start()
        worker.join(timeout=10)

        assert not worker.is_alive()
        assert sorted(p.relative_to(dst).as_posix() for p in dst.rglob("*")) == [
            "events.jsonl",
            "tmp",
        ]

    def test_a_link_inside_the_session_is_recreated_as_a_link(self, tmp_path):
        ws, src, dst, _host_file = self._sessions(tmp_path)
        (src / "tmp" / "a").write_text("sibling")
        (src / "tmp" / "b").symlink_to("a")

        SessionService._copy_claudebox_session(MagicMock(), ws, "source", "dest")

        assert (dst / "tmp" / "b").is_symlink()
        assert (dst / "tmp" / "b").resolve() == (dst / "tmp" / "a").resolve()
        assert (dst / "tmp" / "b").read_text() == "sibling"

    def test_the_sdk_session_folder_drops_an_escaping_link(self, tmp_path):
        host_file = tmp_path / "host" / "secret"
        host_file.parent.mkdir()
        host_file.write_text("HOST SECRET")
        (tmp_path / "source" / "tool-results").mkdir(parents=True)
        (tmp_path / "source" / "tool-results" / "leak.txt").symlink_to(host_file)

        SessionService._copy_sdk_session_dir(MagicMock(), tmp_path, "source", "dest")

        assert not (tmp_path / "dest" / "tool-results" / "leak.txt").exists()
        assert (tmp_path / "dest" / "tool-results").is_dir()

    def test_a_transcript_linking_to_a_host_file_is_not_copied(self, tmp_path):
        host_file = tmp_path / "host" / "secret"
        host_file.parent.mkdir()
        host_file.write_text("HOST SECRET")
        project = tmp_path / "project"
        project.mkdir()
        (project / "source.jsonl").symlink_to(host_file)

        SessionService._copy_sdk_transcript(project, "source", "dest")

        assert not (project / "dest.jsonl").exists()
