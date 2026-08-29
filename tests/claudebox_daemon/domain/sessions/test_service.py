"""Tests for claudebox_daemon.domain.sessions.service - session lifecycle."""

import asyncio
import json
import sqlite3
import threading
import time
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import claudebox_daemon.domain.sessions.service as service_module
from claudebox import SessionNotFound as SharedSessionNotFound
from claudebox import Workspace, read_json, write_json
from claudebox.constants import SESSION_METADATA_FILE
from claudebox.session.models import SessionMetadata
from claudebox_daemon.domain.containers.errors import ContainerTimeout
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.errors import ListingTimeout, ValidationError
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.errors import SessionContainerUnavailable, SessionNotFound
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


# --- list_all ---


class TestListAll:
    """Test listing all sessions with container enrichment."""

    @pytest.mark.anyio
    async def test_returns_empty_list(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.list_all.return_value = []

        result = await svc.list_all()

        assert result == []

    @pytest.mark.anyio
    async def test_enriches_with_container_id(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("sess-1", name="first")
        repo.list_all.return_value = [meta]
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-1", session_id="sess-1"),
        )

        result = await svc.list_all()

        assert len(result) == 1
        assert isinstance(result[0], SessionInfo)
        assert result[0].session_id == "sess-1"
        assert result[0].container_id == "ctr-1"

    @pytest.mark.anyio
    async def test_container_id_none_when_no_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("sess-1")
        repo.list_all.return_value = [meta]
        containers.find_by_session = AsyncMock(return_value=None)

        result = await svc.list_all()

        assert len(result) == 1
        assert result[0].container_id is None

    @pytest.mark.anyio
    async def test_runs_on_the_daemon_executor_not_the_default_pool(self, tmp_path):
        """The per-session-directory walk must never share the default pool with other daemon-side blocking work."""

        svc, repo, _containers = _make_service(tmp_path)
        repo.list_all.return_value = []

        await svc.list_all()

        assert asyncio.get_running_loop()._default_executor is None  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_multiple_sessions(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [
            _make_metadata("sess-1"),
            _make_metadata("sess-2"),
        ]
        containers.find_by_session = AsyncMock(
            side_effect=[
                _make_container("ctr-1", session_id="sess-1"),
                None,
            ],
        )

        result = await svc.list_all()

        assert len(result) == 2
        assert result[0].container_id == "ctr-1"
        assert result[1].container_id is None

    @pytest.mark.anyio
    async def test_member_container_id_none_once_it_drops_out_of_the_live_set(self, tmp_path):
        """A stopped side thread stays a member forever - its container_id must not.

        Membership is addressability, not liveness: only the owner or a live session resolves.
        """

        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("side-1", parent_session_id="parent-1", is_side_thread=True)
        repo.list_all.return_value = [meta]
        containers.find_by_session = AsyncMock(
            return_value=_make_container(
                "ctr-1",
                session_id="parent-1",
                members=["side-1"],
                live_session_ids=["parent-1"],
            ),
        )

        result = await svc.list_all()

        assert result[0].container_id is None

    @pytest.mark.anyio
    async def test_member_container_id_set_while_in_the_live_set(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("side-1", parent_session_id="parent-1", is_side_thread=True)
        repo.list_all.return_value = [meta]
        containers.find_by_session = AsyncMock(
            return_value=_make_container(
                "ctr-1",
                session_id="parent-1",
                members=["side-1"],
                live_session_ids=["parent-1", "side-1"],
            ),
        )

        result = await svc.list_all()

        assert result[0].container_id == "ctr-1"

    @pytest.mark.anyio
    async def test_owner_container_id_set_regardless_of_the_live_set(self, tmp_path):
        """The owner's indicator is unaffected by the live-set mechanism, unlike a member's."""

        svc, repo, containers = _make_service(tmp_path)
        meta = _make_metadata("parent-1")
        repo.list_all.return_value = [meta]
        containers.find_by_session = AsyncMock(
            return_value=_make_container("ctr-1", session_id="parent-1", live_session_ids=[]),
        )

        result = await svc.list_all()

        assert result[0].container_id == "ctr-1"

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
            assert svc._admission.queued_seconds >= 0.05
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
        assert all(r == [] for r in results)

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
        assert kw["total_seconds"] == 1.234
        assert kw["workspace"]["id"] == "test-ws"


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

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.create()

        assert isinstance(result, SessionInfo)
        assert result.container_id == "ctr-new"
        assert result.session_id  # UUID string
        # Footer-relevant fields populated for create-response echo
        assert result.workspace == str(tmp_path)
        assert result.session_dir is not None
        assert result.effort_level == "xhigh"
        assert result.model == "claude-opus-5"
        assert result.permission_mode == "default"
        assert result.num_turns == 0
        assert result.total_cost_usd == 0.0
        containers.create.assert_awaited_once()
        mock_client.post.assert_awaited_once()
        post_url = mock_client.post.call_args[0][0]
        assert post_url.endswith("/api/sessions/new")

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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.create()

        assert result.session_id == "container-generated-id"


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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompt("hello")

        assert result.container_id == "ctr-spawn"


# --- create_with_prompts ---


class TestCreateWithPrompts:
    """Test the list-taking multi-message case the link-session handler drives."""

    @pytest.mark.anyio
    async def test_delivers_every_prompt_in_order(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)

        with TestCreateWithPrompt._mocked_create(containers) as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_response = MagicMock()
            mock_response.raise_for_status = MagicMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.create_with_prompts(["first", "second"])

        assert result.container_id == "ctr-spawn"
        assert [call.kwargs["payload"] for call in containers.send.await_args_list] == [
            {"prompt": "first"},
            {"prompt": "second"},
        ]


# --- deliver_prompt ---


class TestDeliverPrompt:
    """Test the shared prompt-injection helper directly."""

    @pytest.mark.anyio
    async def test_sends_the_prompt_payload(self):
        containers = MagicMock()
        containers.send = AsyncMock(return_value={})
        logger = MagicMock()

        await deliver_prompt(logger, containers, "ctr-1", "hello", session_id="sess-1")

        containers.send.assert_awaited_once_with(
            container_id="ctr-1",
            method="POST",
            endpoint="api/send",
            payload={"prompt": "hello"},
        )
        logger.warning.assert_not_called()

    @pytest.mark.anyio
    async def test_a_send_failure_is_logged_and_swallowed(self):
        containers = MagicMock()
        containers.send = AsyncMock(side_effect=RuntimeError("boom"))
        logger = MagicMock()

        await deliver_prompt(logger, containers, "ctr-1", "hello", session_id="sess-1")

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

    def test_a_missing_ancestor_mid_walk_ends_the_walk_instead_of_failing(self, tmp_path):
        """A deleted ancestor must not jam an otherwise legitimate chain."""

        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = [
            _make_metadata("child", spawned_from_session_id="deleted-root"),
            SharedSessionNotFound(session_id="deleted-root"),
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

        result = await svc.resume("sess-1")

        assert isinstance(result, SessionInfo)
        assert result.session_id == "sess-1"
        assert result.container_id == "ctr-existing"
        assert result.workspace == str(tmp_path)
        assert result.effort_level == "xhigh"
        containers.create.assert_not_called()

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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.resume("sess-1")

        assert isinstance(result, SessionInfo)
        assert result.session_id == "sess-1"
        assert result.container_id == "ctr-new"
        assert result.workspace == str(tmp_path)
        assert result.effort_level == "xhigh"
        containers.create.assert_awaited_once_with(
            session_id="sess-1",
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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            # Fail twice, succeed on third
            mock_client.get = AsyncMock(
                side_effect=[ConnectionError("down"), ConnectionError("down"), ok_response],
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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(side_effect=ConnectionError("down"))
            mock_client_cls.return_value = mock_client

            with pytest.raises(ContainerTimeout):
                await svc._wait_for_health("ctr-1")

        assert mock_client.get.await_count == 3


# --- Fork helpers ---


class TestCopySdkSessionDir:
    """Test _copy_sdk_session_dir with resilience for unreadable files."""

    def _make_ws(self, tmp_path):
        ws = MagicMock()
        ws.sdk_project_dir = tmp_path

        return ws

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
        ws = MagicMock()
        ws.sdk_project_dir = tmp_path

        return ws

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
        ws = MagicMock()
        ws.sdk_project_dir = tmp_path

        return ws

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
        ws = MagicMock()
        ws.sdk_project_dir = tmp_path

        return ws

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
        ws = MagicMock()
        ws.sdk_project_dir = tmp_path

        return ws

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

        result = svc._compute_derived_fields(events)

        assert result["total_cost_usd"] == pytest.approx(0.30)


class TestTruncateEventsMissingFile:
    """A session that never persisted an event is still forkable at a turn."""

    def test_absent_events_file_is_not_fatal(self, tmp_path):
        svc, _repo, _containers = _make_service(tmp_path)
        Workspace(tmp_path).ensure_session("sess")

        svc._truncate_events(Workspace(tmp_path), "sess", "t1")


# --- fork ---


class TestForkOwnershipTransfer:
    """Test fork(reuse_container=True) transfers Container.session_id to the new session."""

    @pytest.mark.anyio
    async def test_reuse_container_transfers_session_id(self, tmp_path):
        """When forking with reuse_container=True, container.session_id moves to the child."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # Real metadata avoids MagicMock auto-vivifying fields and OOMing the JSONEncoder.
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        existing = _make_container("ctr-existing", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.fork(parent_id, reuse_container=True)

        # The transfer call: container.session_id moves to the new (child) session.
        containers.update.assert_awaited_once()
        update_call = containers.update.await_args
        assert update_call.args[0] is existing  # ty: ignore[unresolved-attribute]
        assert update_call.kwargs.get("session_id") == result.session_id  # ty: ignore[unresolved-attribute]
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

        with pytest.raises(SessionContainerUnavailable):
            await svc.fork(parent_id, reuse_container=True)

        containers.update.assert_not_called()

    @pytest.mark.anyio
    async def test_no_reuse_does_not_transfer_ownership(self, tmp_path):
        """fork(reuse_container=False) spawns a new container; no session_id transfer."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        new_container = _make_container("ctr-new", session_id="will-be-overwritten")
        containers.find_by_session = AsyncMock()
        containers.create = AsyncMock(return_value=new_container)
        containers.update = AsyncMock()
        containers.get.return_value = new_container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            with patch.object(svc, "_wait_for_health", new=AsyncMock()):
                result = await svc.fork(parent_id, reuse_container=False)

        # Fresh container spawned with the new session_id from the start.
        containers.create.assert_awaited_once()
        create_call = containers.create.await_args
        assert create_call.kwargs.get("session_id") == result.session_id  # ty: ignore[unresolved-attribute]
        # No transfer call: the fresh-container path never touches containers.update.
        containers.update.assert_not_called()


class TestForkParentOverride:
    """Test fork()'s parent_session_id override - promotion re-parents onto a drawable ancestor."""

    @pytest.mark.anyio
    async def test_defaults_parent_to_source_session(self, tmp_path):
        """No override: the seed's parent_session_id is the fork source."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        new_container = _make_container("ctr-new", session_id="will-be-overwritten")
        containers.find_by_session = AsyncMock()
        containers.create = AsyncMock(return_value=new_container)
        containers.update = AsyncMock()
        containers.get.return_value = new_container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            with patch.object(svc, "_wait_for_health", new=AsyncMock()):
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

        new_container = _make_container("ctr-new", session_id="will-be-overwritten")
        containers.find_by_session = AsyncMock()
        containers.create = AsyncMock(return_value=new_container)
        containers.update = AsyncMock()
        containers.get.return_value = new_container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            with patch.object(svc, "_wait_for_health", new=AsyncMock()):
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

        new_container = _make_container("ctr-new", session_id="will-be-overwritten")
        containers.find_by_session = AsyncMock()
        containers.create = AsyncMock(return_value=new_container)
        containers.update = AsyncMock()
        containers.get.return_value = new_container

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            with patch.object(svc, "_wait_for_health", new=AsyncMock()):
                result = await svc.fork(side_id, parent_session_id="sess-main")

        assert result.is_side_thread is False


class TestForkSharesContainer:
    """Test fork(share_container=True) - the third disposition, no ownership transfer."""

    @pytest.mark.anyio
    async def test_joins_as_member_without_transferring_ownership(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        repo.get.return_value = _make_metadata(parent_id, name="Parent")

        existing = _make_container("ctr-existing", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.fork(parent_id, share_container=True)

        # Never the owner-transfer form: session_id keyword is absent, members is a fresh list.
        containers.update.assert_awaited_once()
        update_call = containers.update.await_args
        assert update_call.args[0] is existing  # ty: ignore[unresolved-attribute]
        assert "session_id" not in update_call.kwargs  # ty: ignore[unresolved-attribute]
        assert update_call.kwargs.get("members") == [result.session_id]  # ty: ignore[unresolved-attribute]
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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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

        existing = _make_container("ctr-existing", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            with patch.object(svc, "_wait_for_health", new=AsyncMock()):
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

        with (
            patch.object(svc, "_compute_derived_fields", side_effect=OSError("disk full")),
            pytest.raises(OSError),
        ):
            await svc.fork("sess-parent", reuse_container=True)

        assert {entry.name for entry in sessions_root.iterdir()} == before

    @pytest.mark.anyio
    async def test_the_original_error_is_what_propagates(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        self._parent_with_events(tmp_path, svc, containers)

        with (
            patch.object(svc, "_compute_derived_fields", side_effect=OSError("disk full")),
            pytest.raises(OSError, match="disk full"),
        ):
            await svc.fork("sess-parent", reuse_container=True)

    @pytest.mark.anyio
    async def test_cancellation_mid_fork_leaves_no_orphan(self, tmp_path):
        """CancelledError is a BaseException, so `except Exception` alone would miss it."""

        svc, _repo, containers = _make_service(tmp_path)
        parent = self._parent_with_events(tmp_path, svc, containers)
        sessions_root = parent.path.parent
        before = {entry.name for entry in sessions_root.iterdir()}

        with (
            patch.object(svc, "_compute_derived_fields", side_effect=asyncio.CancelledError),
            pytest.raises(asyncio.CancelledError),
        ):
            await svc.fork("sess-parent", reuse_container=True)

        assert {entry.name for entry in sessions_root.iterdir()} == before

    @pytest.mark.anyio
    async def test_a_successful_fork_keeps_its_session_dir(self, tmp_path):
        svc, _repo, containers = _make_service(tmp_path)
        parent = self._parent_with_events(tmp_path, svc, containers)
        sessions_root = parent.path.parent
        before = {entry.name for entry in sessions_root.iterdir()}

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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
            },
        )

        existing = _make_container("ctr-existing", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # User settings inherited verbatim.
        assert fork_data["permission_mode"] == "bypassPermissions"
        assert fork_data["effort_level"] == "max"
        assert fork_data["session_prompt"] == "Stay terse."
        assert fork_data["name"] == "Parent"
        assert fork_data["model"] == "claude-sonnet-5"
        assert fork_data["runtime"] == "LangGraph"
        assert fork_data["provider"] == "ollama"
        # first_message is identity-stable across rewinds (truncation keeps the session prefix).
        assert fork_data["first_message"] == "Initial"
        # Derived counters/snapshots come from the empty child events.jsonl, hence zero/None.
        assert fork_data["num_turns"] == 0
        assert fork_data["total_cost_usd"] == 0.0
        assert fork_data["total_duration_ms"] == 0
        assert fork_data["last_message"] is None
        assert fork_data["last_context_tokens"] == 0
        assert fork_data["todos"] is None
        # Fork-point snapshot equals derived total at fork moment (zero here).
        assert fork_data["fork_point_cost_usd"] == 0.0
        # SessionInfo omits session_prompt; it lives only in session.json for the frontend to read.
        assert result.permission_mode == "bypassPermissions"
        assert result.effort_level == "max"
        assert result.name == "Parent"
        assert result.fork_point_cost_usd == 0.0

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

        existing = _make_container("ctr-existing", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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

        existing = _make_container("ctr-existing", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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

        existing = _make_container("ctr-existing", session_id=parent_id)
        containers.find_by_session = AsyncMock(return_value=existing)
        containers.update = AsyncMock()

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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
        assert result["total_cost_usd"] == 0.0
        assert result["num_turns"] == 0

    def test_sums_cost_and_duration_across_result_events(self, tmp_path):
        events = tmp_path / "events.jsonl"
        lines = [
            {"type": "user", "is_human": True, "content": "hi"},
            {"type": "result", "cost_usd": 0.10, "duration_ms": 1000},
            {"type": "user", "is_human": True, "content": "more"},
            {"type": "result", "cost_usd": 0.25, "duration_ms": 2500},
        ]
        events.write_text("".join(json.dumps(line) + "\n" for line in lines))

        result = self._derive(tmp_path, events)

        assert result["total_cost_usd"] == pytest.approx(0.35)
        assert result["total_duration_ms"] == 3500
        assert result["num_turns"] == 2

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

        assert result["total_cost_usd"] == 0.5


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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # Derived from the events, NOT from parent_data's inflated counters.
        assert fork_data["total_cost_usd"] == pytest.approx(0.40)
        assert fork_data["total_duration_ms"] == 2000
        assert fork_data["num_turns"] == 2
        assert fork_data["last_message"] == "more"
        # fork_point = total_cost_usd at fork time; aggregation attributes zero new spend to it.
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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            result = await svc.fork(parent_id, reuse_container=True)

        fork_data = _read_fork_session_json(tmp_path, result.session_id)

        # None of the parent's accumulated-counter sentinels leak into the child.
        assert fork_data["num_turns"] == 0
        assert fork_data["total_cost_usd"] == 0.0
        assert fork_data["total_duration_ms"] == 0
        assert fork_data["last_message"] is None
        assert fork_data["last_context_tokens"] == 0
        assert fork_data["todos"] is None
        assert fork_data["fork_point_cost_usd"] == 0.0


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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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

        mock_response = MagicMock()
        mock_response.raise_for_status = MagicMock()

        with patch("claudebox_daemon.domain.sessions.service.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

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
