"""Tests for claudebox_daemon.domain.containers.service - container lifecycle."""

from __future__ import annotations

import asyncio
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox import temp
from claudebox.config import Config
from claudebox_daemon.constants import DAEMON_STATE_FILE
from claudebox_daemon.domain.containers.errors import (
    BundleNotDeclared,
    ContainerNotFound,
    ContainerTmpMountConflict,
    NetworkModeUnsupported,
)
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.containers.service import ContainerService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from ....fake_podman import FakePodman, on_fake_podman, publishes


# --- Helpers ---


def _make_service(tmp_path: Path) -> tuple[ContainerService, MagicMock]:
    """Create a ContainerService with mocked backend and real file I/O."""

    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    events = AsyncMock()

    config_dir = tmp_path / ".claudebox"
    config_dir.mkdir(parents=True, exist_ok=True)

    config = Config(
        work_dir=tmp_path,
        config_dir=config_dir,
        backend="podman",
    )

    proxy = MagicMock()
    executor = ThreadPoolExecutor(max_workers=2)
    svc = ContainerService(ws, events, config, proxy, executor, executor)
    # Mock the container runtime backend to prevent real subprocess calls
    svc._runtime._backend = MagicMock()

    return svc, events


# --- get ---


class TestFindByPeerPid:
    """Test peer-pid-to-container resolution - what the spawn socket uses to identify its
    caller, never trusting anything the request payload claims."""

    @pytest.mark.anyio
    async def test_resolves_the_matching_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers = {
            "c1": Container(id="c1", backend_id="b1", port=8080),
            "c2": Container(id="c2", backend_id="b2", port=8081),
        }
        svc._runtime.identify_container_from_pid = MagicMock(return_value="b2")

        result = await svc.find_by_peer_pid(4242)

        assert result is svc._containers["c2"]
        svc._runtime.identify_container_from_pid.assert_called_once_with(4242, ["b1", "b2"])

    @pytest.mark.anyio
    async def test_returns_none_when_the_runtime_cannot_identify_the_pid(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers = {"c1": Container(id="c1", backend_id="b1", port=8080)}
        svc._runtime.identify_container_from_pid = MagicMock(return_value=None)

        assert await svc.find_by_peer_pid(4242) is None

    @pytest.mark.anyio
    async def test_returns_none_when_the_identified_id_matches_no_registered_container(
        self,
        tmp_path,
    ):
        """Defensive: the runtime named an id that is not (or is no longer) registered."""

        svc, _ = _make_service(tmp_path)
        svc._containers = {"c1": Container(id="c1", backend_id="b1", port=8080)}
        svc._runtime.identify_container_from_pid = MagicMock(return_value="unregistered-id")

        assert await svc.find_by_peer_pid(4242) is None


class TestGet:
    """Test container lookup by ID."""

    def test_returns_registered_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080)
        svc._containers["c1"] = c

        assert svc.get("c1") is c

    def test_raises_not_found(self, tmp_path):
        svc, _ = _make_service(tmp_path)

        with pytest.raises(ContainerNotFound):
            svc.get("nonexistent")


# --- save / _load ---


class TestSaveLoad:
    """Test state persistence roundtrip."""

    @pytest.mark.anyio
    async def test_save_and_load(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080)
        svc._containers["c1"] = c
        await svc.save()

        # Fresh service loads state
        svc2, _ = _make_service(tmp_path)
        svc2._load()

        assert "c1" in svc2._containers
        assert svc2._containers["c1"].port == 8080

    def test_load_empty_state(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._load()
        assert svc._containers == {}

    @pytest.mark.anyio
    async def test_members_survive_a_daemon_restart(self, tmp_path):
        """A side thread's membership must persist the same way session_id already does -
        sync_state() rewrites only backend_id and status on an existing entry."""

        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080, members=["thread-1", "thread-2"])
        svc._containers["c1"] = c
        await svc.save()

        svc2, _ = _make_service(tmp_path)
        svc2._load()

        assert svc2._containers["c1"].members == ["thread-1", "thread-2"]


# --- list_all ---


class TestListAll:
    """Test container listing."""

    def test_returns_all_containers(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(id="c1", backend_id="b1", port=8080)
        svc._containers["c2"] = Container(id="c2", backend_id="b2", port=8081)

        result = svc.list_all()
        assert len(result) == 2


# --- sync_state (public) ---


class TestSyncState:
    """Test registry synchronization with container backend."""

    @pytest.mark.anyio
    async def test_registers_new_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "backend-1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.return_value = 9090

        await svc.sync_state()

        assert "c1" in svc._containers
        assert svc._containers["c1"].status == ContainerStatus.RUNNING
        assert svc._containers["c1"].port == 9090

    @pytest.mark.anyio
    async def test_updates_existing_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="old-b",
            port=0,
            status=ContainerStatus.STOPPED,
            failure_count=5,
        )

        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "new-b",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.sync_state()

        c = svc._containers["c1"]
        assert c.backend_id == "new-b"
        assert c.port == 8080
        assert c.status == ContainerStatus.RUNNING
        # The count belongs to the health probe; resetting it here made CRASHED unreachable.
        assert c.failure_count == 5

    @pytest.mark.anyio
    async def test_observers_see_a_container_that_exited_or_vanished_on_its_own(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        seen: list[tuple[str, ContainerStatus]] = []
        svc.add_status_observer(lambda c: seen.append((c.id, c.status)))

        for container_id in ("exited", "vanished", "unchanged"):
            svc._containers[container_id] = Container(
                id=container_id,
                backend_id=f"b-{container_id}",
                port=8080,
                status=ContainerStatus.RUNNING,
            )

        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": f"b-{container_id}",
                "State": state,
                "Labels": {"claudebox-id": container_id, "claudebox-workspace": "test-ws"},
            }
            for container_id, state in (("exited", "exited"), ("unchanged", "running"))
        ]
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.sync_state()

        assert sorted(seen) == [
            ("exited", ContainerStatus.STOPPED),
            ("vanished", ContainerStatus.RUNNING),
        ]

    @pytest.mark.anyio
    async def test_a_live_process_does_not_resurrect_a_crashed_container(self, tmp_path):
        """The runtime says a process exists; only the probe knows whether the API answers."""

        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.CRASHED,
        )

        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "b1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.sync_state()

        assert svc._containers["c1"].status == ContainerStatus.CRASHED

    @pytest.mark.anyio
    async def test_a_stopped_process_still_moves_a_crashed_container(self, tmp_path):
        """A crashed verdict outranks a running process, not a stopped one."""

        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.CRASHED,
        )

        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "b1",
                "State": "exited",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.sync_state()

        assert svc._containers["c1"].status == ContainerStatus.STOPPED

    @pytest.mark.anyio
    async def test_removes_missing_containers(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime._backend.list_containers.return_value = []

        await svc.sync_state()

        assert "c1" not in svc._containers

    @pytest.mark.anyio
    async def test_a_forged_nonzero_port_is_corrected_from_the_runtime(self, tmp_path):
        """A container that edited its own registry entry, changing only the port, is not
        believed - the runtime's own port wins even when the recorded one is already non-zero."""

        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=6666,
            status=ContainerStatus.RUNNING,
        )

        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "b1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.return_value = 9090

        await svc.sync_state()

        assert svc._containers["c1"].port == 9090

    @pytest.mark.anyio
    async def test_a_forged_port_disagreement_is_logged_at_warning(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._logger = MagicMock()
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=6666,
            status=ContainerStatus.RUNNING,
        )

        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "b1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.return_value = 9090

        await svc.sync_state()

        svc._logger.warning.assert_called_once()
        kwargs = svc._logger.warning.call_args.kwargs
        assert kwargs["recorded_port"] == 6666
        assert kwargs["runtime_port"] == 9090

    @pytest.mark.anyio
    async def test_a_fresh_zero_port_discovery_logs_at_info_not_warning(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._logger = MagicMock()
        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "backend-1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.return_value = 9090

        await svc.sync_state()

        svc._logger.warning.assert_not_called()
        svc._logger.info.assert_called_once()

    @pytest.mark.anyio
    async def test_ignores_other_workspace(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "backend-1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "other-ws"},
            },
        ]

        await svc.sync_state()

        assert "c1" not in svc._containers

    @pytest.mark.anyio
    async def test_ignores_container_without_id_label(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = [
            {"Id": "backend-1", "State": "running", "Labels": {}},
        ]

        await svc.sync_state()

        assert len(svc._containers) == 0

    @pytest.mark.anyio
    async def test_podman_dispatch_never_touches_the_default_executor(self, tmp_path):
        """Podman dispatch never touches the default pool, so a wedged call can't starve it."""

        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = []

        await svc.sync_state()

        assert asyncio.get_running_loop()._default_executor is None  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_handles_backend_error(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime._backend.list_containers.side_effect = RuntimeError("backend down")

        # Should not crash - graceful fallback
        await svc.sync_state()

        assert svc._containers["c1"].status == ContainerStatus.RUNNING

    @pytest.mark.anyio
    async def test_port_discovery_failure(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "backend-1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            },
        ]
        svc._runtime._backend.get_host_port.side_effect = RuntimeError("no port")

        await svc.sync_state()

        assert svc._containers["c1"].port == 0


# --- create ---


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestCreate:
    """Test container creation."""

    @pytest.mark.anyio
    async def test_creates_and_registers(self, _touch_file, _touch_dir, tmp_path):
        svc, events = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-new"
        svc._runtime._backend.get_host_port.return_value = 9090

        container = await svc.create()

        assert container.id is not None
        assert container.status == ContainerStatus.STARTING
        assert container.id in svc._containers
        events.broadcast.assert_awaited_once()

    @pytest.mark.anyio
    async def test_id_is_auto_generated_uuid(self, _touch_file, _touch_dir, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-new"
        svc._runtime._backend.get_host_port.return_value = 8080

        container = await svc.create()

        assert container.id is not None
        assert container.id in svc._containers

    @pytest.mark.anyio
    async def test_podman_name_uses_id(self, _touch_file, _touch_dir, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-new"
        svc._runtime._backend.get_host_port.return_value = 8080

        container = await svc.create()

        call_args = svc._runtime._backend.run_container.call_args[0]
        name_idx = list(call_args).index("--name")
        podman_name = call_args[name_idx + 1]
        assert podman_name == container.id

    @pytest.mark.anyio
    async def test_daemon_spawn_applies_kind_agent_label(self, _touch_file, _touch_dir, tmp_path):
        """Daemon-spawned containers are always agent sessions."""

        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-new"
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.create()

        call_args = list(svc._runtime._backend.run_container.call_args[0])
        labels = [call_args[i + 1] for i, a in enumerate(call_args) if a == "--label"]
        assert "kind=agent" in labels


# --- update ---


class TestUpdate:
    """Test container field updates."""

    @pytest.mark.anyio
    async def test_status_change_broadcasts(self, tmp_path):
        svc, events = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080)
        svc._containers["c1"] = c

        await svc.update(c, status=ContainerStatus.CRASHED)

        assert c.status == ContainerStatus.CRASHED
        events.broadcast.assert_awaited_once()

    @pytest.mark.anyio
    async def test_no_status_change_no_broadcast(self, tmp_path):
        svc, events = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080)
        svc._containers["c1"] = c

        await svc.update(c, failure_count=5)

        assert c.failure_count == 5
        events.broadcast.assert_not_awaited()

    @pytest.mark.anyio
    async def test_unknown_field_raises_type_error(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080)

        with pytest.raises(TypeError):
            await svc.update(c, bogus_field=1)

    @pytest.mark.anyio
    async def test_an_unchanged_field_writes_nothing(self, tmp_path, monkeypatch):
        """A healthy probe re-reports the same status every few seconds; each rewrite took a lock."""

        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080, status=ContainerStatus.RUNNING)
        svc._containers["c1"] = c
        writes = []
        monkeypatch.setattr(svc, "save", AsyncMock(side_effect=lambda: writes.append(1)))

        for _ in range(5):
            await svc.update(c, status=ContainerStatus.RUNNING)

        assert writes == []

    @pytest.mark.anyio
    async def test_a_changed_field_still_writes(self, tmp_path, monkeypatch):
        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080, status=ContainerStatus.RUNNING)
        svc._containers["c1"] = c
        writes = []
        monkeypatch.setattr(svc, "save", AsyncMock(side_effect=lambda: writes.append(1)))

        await svc.update(c, session_id="sess-1")
        await svc.update(c, session_id="sess-1")

        assert c.session_id == "sess-1"
        assert len(writes) == 1


# --- remove ---


class TestRemove:
    """Test container removal."""

    @pytest.mark.anyio
    async def test_removes_calls_backend_and_pops(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080)
        svc._containers["c1"] = c

        await svc.remove("c1")

        assert "c1" not in svc._containers
        svc._runtime._backend.remove_container.assert_called_once_with("b1")

    @pytest.mark.anyio
    async def test_remove_nonexistent_raises(self, tmp_path):
        svc, _ = _make_service(tmp_path)

        with pytest.raises(ContainerNotFound):
            await svc.remove("nonexistent")

    @pytest.mark.anyio
    async def test_remove_broadcasts_sessions_changed_when_session_bound(self, tmp_path):
        from claudebox_daemon.domain.sessions.models import SessionsChangedEvent

        svc, events = _make_service(tmp_path)
        svc._containers["c1"] = Container(id="c1", backend_id="b1", port=8080, session_id="sess-1")

        await svc.remove("c1")

        events.broadcast.assert_awaited_once()
        event = events.broadcast.await_args.args[0]
        assert isinstance(event, SessionsChangedEvent)
        assert event.container_id == "c1"
        assert event.workspace_id == "test-ws"

    @pytest.mark.anyio
    async def test_remove_no_broadcast_when_no_session(self, tmp_path):
        svc, events = _make_service(tmp_path)
        svc._containers["c1"] = Container(id="c1", backend_id="b1", port=8080)

        await svc.remove("c1")

        events.broadcast.assert_not_awaited()


# --- start / stop lifecycle ---


class TestLifecycle:
    """Test service start/stop."""

    @pytest.mark.anyio
    async def test_start(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = []

        await svc.start()

        svc._runtime._backend.create_network.assert_called_once()

    @pytest.mark.anyio
    async def test_stop_persists_state(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(id="c1", backend_id="b1", port=8080)
        svc._containers["c1"] = c

        await svc.stop()

        assert svc._state_path.exists()


# --- find_by_session ---


class TestFindBySession:
    """Test session-based container lookup."""

    @pytest.mark.anyio
    async def test_returns_running_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            session_id="sess-1",
            status=ContainerStatus.RUNNING,
        )
        svc._containers["c1"] = c

        assert await svc.find_by_session("sess-1") is c

    @pytest.mark.anyio
    async def test_returns_starting_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            session_id="sess-1",
            status=ContainerStatus.STARTING,
        )
        svc._containers["c1"] = c

        assert await svc.find_by_session("sess-1") is c

    @pytest.mark.anyio
    async def test_ignores_stopped_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            session_id="sess-1",
            status=ContainerStatus.STOPPED,
        )

        assert await svc.find_by_session("sess-1") is None

    @pytest.mark.anyio
    async def test_ignores_crashed_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            session_id="sess-1",
            status=ContainerStatus.CRASHED,
        )

        assert await svc.find_by_session("sess-1") is None

    @pytest.mark.anyio
    async def test_returns_none_when_no_match(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            session_id="other-sess",
            status=ContainerStatus.RUNNING,
        )

        assert await svc.find_by_session("sess-1") is None

    @pytest.mark.anyio
    async def test_sync_calls_sync_state(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = []

        with patch.object(svc, "sync_state", new_callable=AsyncMock) as mock_sync:
            await svc.find_by_session("sess-1", sync=True)
            mock_sync.assert_awaited_once()

    @pytest.mark.anyio
    async def test_resolves_a_member_session(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        c = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            session_id="owner-sess",
            status=ContainerStatus.RUNNING,
            members=["thread-1", "thread-2"],
        )
        svc._containers["c1"] = c

        assert await svc.find_by_session("thread-1") is c
        assert await svc.find_by_session("thread-2") is c

    @pytest.mark.anyio
    async def test_owner_wins_over_a_member_match_on_another_container(self, tmp_path):
        """The owner is what a stop must resolve to - it must never lose to a member match
        on a different container, regardless of dict iteration order."""

        svc, _ = _make_service(tmp_path)
        owner_container = Container(
            id="c-owner",
            backend_id="b1",
            port=8080,
            session_id="sess-1",
            status=ContainerStatus.RUNNING,
        )
        member_container = Container(
            id="c-member",
            backend_id="b2",
            port=8081,
            session_id="other-owner",
            status=ContainerStatus.RUNNING,
            members=["sess-1"],
        )
        svc._containers["c-member"] = member_container
        svc._containers["c-owner"] = owner_container

        assert await svc.find_by_session("sess-1") is owner_container

    @pytest.mark.anyio
    async def test_ignores_membership_on_a_stopped_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            session_id="owner-sess",
            status=ContainerStatus.STOPPED,
            members=["thread-1"],
        )

        assert await svc.find_by_session("thread-1") is None


# --- config reload at container-create (staleness regression) ---


def _created_volumes(backend: MagicMock) -> list[str]:
    """Volume mount args from the most recent backend run_container call."""

    args = list(backend.run_container.call_args.args)

    return [args[i + 1] for i, a in enumerate(args) if a == "--volume"]


def _write_settings(tmp_path: Path, body: str) -> None:
    settings = tmp_path / ".claudebox" / "settings.toml"
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(body)


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestConfigReloadOnCreate:
    """A settings.toml mount edit reaches the next created container without a daemon restart."""

    @pytest.mark.anyio
    async def test_new_mount_applies_to_next_create(self, _touch_file, _touch_dir, tmp_path):
        _write_settings(tmp_path, "root = true\n")
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-1"
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.create()
        assert not any("extra_mount_src" in v for v in _created_volumes(svc._runtime._backend))

        mount_src = tmp_path / "extra_mount_src"
        mount_dst = tmp_path / "extra_mount_dst"
        _write_settings(tmp_path, f'root = true\n\n[mounts]\n"{mount_src}" = "{mount_dst}"\n')

        await svc.create()
        assert any("extra_mount_src" in v for v in _created_volumes(svc._runtime._backend))


def _created_args(backend: MagicMock, flag: str) -> list[str]:
    args = list(backend.run_container.call_args.args)

    return [args[i + 1] for i, a in enumerate(args) if a == flag]


_BUNDLED_SETTINGS = """root = true

[env]
SHARED = "workspace"
ONLY_WORKSPACE = "w"

[bundles.research.env]
SHARED = "bundle"

[bundles.research.mounts]
"{mount_src}" = "/bundle-data"

[bundles.research.ports]
8181 = 81

[bundles.research.network]
mode = "research-net"
"""


@patch("claudebox.containers.run._port_in_use", lambda _port, _mapping: False)
@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestBundleOnCreate:
    """A named bundle decides the created container's env, mounts, ports and network."""

    @pytest.mark.anyio
    async def test_bundle_shapes_the_container(self, _touch_file, _touch_dir, tmp_path):
        _write_settings(tmp_path, _BUNDLED_SETTINGS.format(mount_src=tmp_path / "bundle_src"))
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-1"
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.create(session_id="sess-1", bundle="research")

        backend = svc._runtime._backend
        env = _created_args(backend, "--env")
        assert "SHARED=bundle" in env
        assert "SHARED=workspace" not in env
        assert "ONLY_WORKSPACE=w" in env
        assert f"{tmp_path / 'bundle_src'}:/bundle-data" in _created_volumes(backend)
        assert "127.0.0.1:8181:81" in _created_args(backend, "--publish")
        assert _created_args(backend, "--network") == ["research-net"]

    @pytest.mark.anyio
    async def test_no_bundle_builds_what_a_plain_load_builds(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        _write_settings(tmp_path, _BUNDLED_SETTINGS.format(mount_src=tmp_path / "bundle_src"))
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-1"
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.create(session_id="sess-1")

        backend = svc._runtime._backend
        env = _created_args(backend, "--env")
        assert "SHARED=workspace" in env
        assert "SHARED=bundle" not in env
        assert not any("bundle-data" in v for v in _created_volumes(backend))
        assert _created_args(backend, "--publish") == ["127.0.0.1::8080", "127.0.0.1::8081"]
        assert _created_args(backend, "--network") == [svc._network]

    @pytest.mark.anyio
    async def test_undeclared_bundle_is_refused_before_anything_spawns(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        _write_settings(tmp_path, _BUNDLED_SETTINGS.format(mount_src=tmp_path / "bundle_src"))
        svc, _ = _make_service(tmp_path)

        with pytest.raises(BundleNotDeclared) as excinfo:
            await svc.create(session_id="sess-1", bundle="typo")

        assert excinfo.value.context == {"bundle": "typo", "session_id": "sess-1"}
        assert excinfo.value.status_code == 409
        svc._runtime._backend.run_container.assert_not_called()
        assert svc.list_all() == []

    @pytest.mark.anyio
    async def test_each_create_re_resolves_the_bundle(self, _touch_file, _touch_dir, tmp_path):
        _write_settings(tmp_path, _BUNDLED_SETTINGS.format(mount_src=tmp_path / "bundle_src"))
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-1"
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.create(session_id="sess-1", bundle="research")
        _write_settings(
            tmp_path,
            _BUNDLED_SETTINGS.format(mount_src=tmp_path / "bundle_src").replace(
                'SHARED = "bundle"',
                'SHARED = "edited"',
            ),
        )
        await svc.create(session_id="sess-1", bundle="research")

        assert "SHARED=edited" in _created_args(svc._runtime._backend, "--env")

    @pytest.mark.anyio
    async def test_a_deleted_bundle_refuses_the_next_spawn(self, _touch_file, _touch_dir, tmp_path):
        _write_settings(tmp_path, _BUNDLED_SETTINGS.format(mount_src=tmp_path / "bundle_src"))
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-1"
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.create(session_id="sess-1", bundle="research")
        _write_settings(tmp_path, "root = true\n")

        with pytest.raises(BundleNotDeclared) as excinfo:
            await svc.create(session_id="sess-1", bundle="research")

        assert excinfo.value.context == {"bundle": "research", "session_id": "sess-1"}


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestTmpMountConflictOnCreate:
    """A spawn that would have the session delete a mount under /tmp is refused before it runs."""

    @pytest.mark.anyio
    async def test_a_mount_under_tmp_refuses_the_spawn(self, _touch_file, _touch_dir, tmp_path):
        agent_dir = temp.TMP_PATH / "ssh-agent"
        body = f'root = true\n[mounts]\n"{tmp_path / "agent"}" = "{agent_dir}"\n'
        _write_settings(tmp_path, body)
        svc, _ = _make_service(tmp_path)

        with pytest.raises(ContainerTmpMountConflict) as excinfo:
            await svc.create(session_id="sess-1")

        assert excinfo.value.status_code == 409
        assert excinfo.value.context == {"paths": str(agent_dir)}
        svc._runtime._backend.run_container.assert_not_called()
        assert svc.list_all() == []

    @pytest.mark.anyio
    async def test_the_opt_out_lets_it_spawn(self, _touch_file, _touch_dir, tmp_path):
        agent_dir = temp.TMP_PATH / "ssh-agent"
        _write_settings(
            tmp_path,
            f'root = true\n[env]\nCLAUDEBOX_NO_TMP_REMAP = "1"\n'
            f'[mounts]\n"{tmp_path / "agent"}" = "{agent_dir}"\n',
        )
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "backend-1"
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.create(session_id="sess-1")

        svc._runtime._backend.run_container.assert_called_once()


# --- sync_state races ---


class _GatedListing:
    """A listing that blocks until released; by default it snapshots the runtime on entry,
    `late=True` on release - podman answering with what it saw while the spawn ran."""

    def __init__(self, containers: list[dict], *, late: bool = False) -> None:
        self.containers = containers
        self.late = late
        self.calls = 0
        self.entered = threading.Event()
        self.release = threading.Event()

    def __call__(self, *_args, **_kwargs) -> list[dict]:
        self.calls += 1
        snapshot = list(self.containers)
        self.entered.set()
        self.release.wait(5)

        return list(self.containers) if self.late else snapshot


def _listed(container_id: str, backend_id: str, state: str = "running") -> dict:
    return {
        "Id": backend_id,
        "State": state,
        "Labels": {"claudebox-id": container_id, "claudebox-workspace": "test-ws"},
    }


async def _while_listing(svc: ContainerService, gate: _GatedListing, during) -> None:
    """Run `during()` after a reconcile has taken its listing and before it applies it."""

    svc._runtime._backend.list_containers.side_effect = gate
    reconcile = asyncio.create_task(svc.sync_state())
    await asyncio.get_running_loop().run_in_executor(None, gate.entered.wait, 5)

    try:
        await during()
    finally:
        gate.release.set()

    await reconcile


class TestSyncStateRaces:
    """A write the service makes after a listing began outranks that listing."""

    @pytest.mark.anyio
    @patch("claudebox.containers.run.touch_dir")
    @patch("claudebox.containers.run.touch_file")
    async def test_a_container_registered_while_listing_is_kept(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "b-new"
        svc._runtime._backend.get_host_port.return_value = 9090
        gate = _GatedListing([])
        created = []

        async def create():
            created.append(await svc.create(session_id="s1"))

        await _while_listing(svc, gate, create)

        assert created[0].id in svc._containers
        persisted = json.loads((tmp_path / ".claudebox" / DAEMON_STATE_FILE).read_text())
        assert [c["id"] for c in persisted] == [created[0].id]
        # A resume looking for s1 finds it rather than spawning a second container.
        found = await svc.find_by_session("s1")
        assert found is not None
        assert found.id == created[0].id

    @pytest.mark.anyio
    @patch("claudebox.containers.run.touch_dir")
    @patch("claudebox.containers.run.touch_file")
    async def test_a_failed_start_during_a_listing_can_still_be_cleaned_up(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "b-new"
        svc._runtime._backend.get_host_port.return_value = 9090
        created = []

        async def create():
            created.append(await svc.create(session_id="s1"))

        await _while_listing(svc, _GatedListing([]), create)
        await svc.remove(created[0].id)

        svc._runtime._backend.remove_container.assert_called_once_with("b-new")
        assert created[0].id not in svc._containers

    @pytest.mark.anyio
    async def test_a_container_removed_while_listing_stays_removed(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime._backend.get_host_port.return_value = 8080
        gate = _GatedListing([_listed("c1", "b1")])

        await _while_listing(svc, gate, lambda: svc.remove("c1"))

        assert "c1" not in svc._containers

    @pytest.mark.anyio
    async def test_a_container_stopped_while_listing_stays_stopped(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
            session_id="s1",
        )
        svc._runtime._backend.get_host_port.return_value = 8080
        gate = _GatedListing([_listed("c1", "b1")])

        await _while_listing(svc, gate, lambda: svc.stop_container("c1"))

        assert svc._containers["c1"].status == ContainerStatus.STOPPED
        assert await svc.find_by_session("s1") is None

    @pytest.mark.anyio
    @patch("claudebox.containers.run.touch_dir")
    @patch("claudebox.containers.run.touch_file")
    async def test_a_listing_taken_mid_spawn_leaves_the_new_container_starting(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "b-new"
        svc._runtime._backend.get_host_port.return_value = 9090
        created = []
        gate = _GatedListing([], late=True)

        async def create():
            container = await svc.create(session_id="s1")
            created.append(container)
            # podman reports the new container as created, its process not yet running.
            gate.containers.append(_listed(container.id, "b-new", state="created"))

        await _while_listing(svc, gate, create)

        container_id = created[0].id
        assert svc._containers[container_id].status == ContainerStatus.STARTING
        found = await svc.find_by_session("s1")
        assert found is not None
        assert found.id == container_id

        svc._runtime._backend.list_containers.side_effect = None
        svc._runtime._backend.list_containers.return_value = [_listed(container_id, "b-new")]
        await svc.sync_state()

        assert svc._containers[container_id].status == ContainerStatus.RUNNING

    @pytest.mark.anyio
    async def test_concurrent_reconciles_share_one_listing(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        gate = _GatedListing([])
        svc._runtime._backend.list_containers.side_effect = gate

        first = asyncio.create_task(svc.sync_state())
        await asyncio.get_running_loop().run_in_executor(None, gate.entered.wait, 5)
        second = asyncio.create_task(svc.sync_state())
        await asyncio.sleep(0)
        gate.release.set()
        await asyncio.gather(first, second)

        assert gate.calls == 1

    @pytest.mark.anyio
    async def test_a_container_absent_from_a_later_listing_is_still_dropped(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = Container(
            id="c1",
            backend_id="b1",
            port=8080,
            status=ContainerStatus.RUNNING,
        )
        svc._runtime._backend.list_containers.return_value = []

        await svc.sync_state()

        assert "c1" not in svc._containers


# --- reap_orphan ---


def _aged(**fields) -> Container:
    """A registered container an hour old unless `created_at` says otherwise."""

    container = Container(
        id="c1",
        backend_id="b1",
        port=8080,
        status=ContainerStatus.RUNNING,
        created_at=datetime.now(UTC) - timedelta(hours=1),
    )

    for name, value in fields.items():
        setattr(container, name, value)

    return container


class TestReapOrphan:
    """A container no session can reach is killed and removed; anything reachable is kept."""

    @pytest.mark.anyio
    async def test_reaps_an_old_ownerless_running_container(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = _aged()

        assert await svc.reap_orphan("c1") is True

        svc._runtime._backend.kill.assert_called_once_with("b1")
        svc._runtime._backend.remove_container.assert_called_once_with("b1")
        assert "c1" not in svc._containers

    @pytest.mark.anyio
    @pytest.mark.parametrize(
        "fields",
        [
            {"created_at": datetime.now(UTC) - timedelta(seconds=10)},
            {"session_id": "owner"},
            {"members": ["side-1"]},
            {"live_session_ids": ["side-1"]},
            {"status": ContainerStatus.CRASHED},
        ],
        ids=["young", "owned", "members", "live", "crashed"],
    )
    async def test_keeps_a_reachable_or_unanswering_container(self, tmp_path, fields):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = _aged(**fields)

        assert await svc.reap_orphan("c1") is False

        svc._runtime._backend.kill.assert_not_called()
        svc._runtime._backend.remove_container.assert_not_called()
        assert "c1" in svc._containers

    @pytest.mark.anyio
    async def test_a_stopped_orphan_is_removed_without_a_kill(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._containers["c1"] = _aged(status=ContainerStatus.STOPPED)

        assert await svc.reap_orphan("c1") is True

        svc._runtime._backend.kill.assert_not_called()
        svc._runtime._backend.remove_container.assert_called_once_with("b1")

    @pytest.mark.anyio
    @patch("claudebox.containers.run.touch_dir")
    @patch("claudebox.containers.run.touch_file")
    async def test_a_claimed_spawn_is_kept_until_released(self, _touch_file, _touch_dir, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.run_container.return_value = "b-new"
        svc._runtime._backend.get_host_port.return_value = 9090
        container = await svc.create()
        container.created_at = datetime.now(UTC) - timedelta(hours=1)
        container.status = ContainerStatus.RUNNING

        assert await svc.reap_orphan(container.id) is False

        svc.release_spawn(container.id)
        assert await svc.reap_orphan(container.id) is True

    @pytest.mark.anyio
    @patch("claudebox.containers.run.touch_dir")
    @patch("claudebox.containers.run.touch_file")
    async def test_a_container_adopted_while_podman_runs_is_claimed(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        svc, _ = _make_service(tmp_path)
        started = threading.Event()
        finish = threading.Event()
        spawned = {}

        def run_container(*args, **_kwargs):
            spawned["id"] = args[args.index("--name") + 1]
            started.set()
            finish.wait(5)

            return "b-new"

        svc._runtime._backend.run_container.side_effect = run_container
        svc._runtime._backend.get_host_port.return_value = 9090
        create = asyncio.create_task(svc.create())
        await asyncio.get_running_loop().run_in_executor(None, started.wait, 5)

        svc._runtime._backend.list_containers.return_value = [_listed(spawned["id"], "b-new")]
        await svc.sync_state()
        svc._containers[spawned["id"]].created_at = datetime.now(UTC) - timedelta(hours=1)

        assert await svc.reap_orphan(spawned["id"]) is False

        finish.set()
        await create

    @pytest.mark.anyio
    @patch("claudebox.containers.run.touch_dir")
    @patch("claudebox.containers.run.touch_file")
    async def test_a_spawn_that_timed_out_after_creating_drops_its_claim(
        self,
        _touch_file,
        _touch_dir,
        tmp_path,
    ):
        svc, _ = _make_service(tmp_path)
        spawned = {}

        def run_container(*args, **_kwargs):
            spawned["id"] = args[args.index("--name") + 1]

            raise TimeoutError("podman run timed out")

        svc._runtime._backend.run_container.side_effect = run_container
        svc._runtime._backend.get_host_port.return_value = 9090

        with pytest.raises(TimeoutError):
            await svc.create()

        svc._runtime._backend.list_containers.return_value = [_listed(spawned["id"], "b-new")]
        await svc.sync_state()
        svc._containers[spawned["id"]].created_at = datetime.now(UTC) - timedelta(hours=1)

        assert await svc.reap_orphan(spawned["id"]) is True


def _podman_service(tmp_path: Path, settings: str) -> ContainerService:
    _write_settings(tmp_path, settings + '\n[env]\nCLAUDEBOX_NO_TMP_REMAP = "1"\n')
    ws = RegisteredWorkspace(id="ws", path=tmp_path)
    config = Config(work_dir=tmp_path, config_dir=tmp_path / ".claudebox", backend="podman")
    pool = ThreadPoolExecutor(max_workers=2)

    return ContainerService(ws, AsyncMock(), config, MagicMock(), pool, pool)


@patch("claudebox.containers.run.touch_dir")
@patch("claudebox.containers.run.touch_file")
class TestSpawnsShareTheHost:
    """Session containers coexist on one host whatever fixed ports the settings name, and a
    network mode that drops the daemon's publish is refused before anything runs."""

    @pytest.mark.anyio
    async def test_two_sessions_with_a_fixed_port_both_start(self, _tf, _td, tmp_path):
        podman = FakePodman()
        svc = _podman_service(tmp_path, "root = true\n\n[ports]\n8080 = 80\n")

        with on_fake_podman(podman):
            first = await svc.create(session_id="session-a")
            second = await svc.create(session_id="session-b")

        assert first.port and second.port
        assert "127.0.0.1:8080:80" in publishes(podman.runs[0])
        moved = [p for p in publishes(podman.runs[1]) if p.endswith(":80")]
        assert (
            len(moved) == 1
            and moved[0].startswith("127.0.0.1:")
            and moved[0] != "127.0.0.1:8080:80"
        )

    @pytest.mark.anyio
    async def test_a_freed_port_is_taken_again(self, _tf, _td, tmp_path):
        podman = FakePodman()
        svc = _podman_service(tmp_path, "root = true\n\n[ports]\n8080 = 80\n")

        with on_fake_podman(podman):
            first = await svc.create(session_id="session-a")
            await svc.create(session_id="session-b")
            await svc.remove(first.id)
            await svc.create(session_id="session-c")

        assert "127.0.0.1:8080:80" in publishes(podman.runs[2])

    @pytest.mark.anyio
    @pytest.mark.parametrize("mode", ["host", "none", "container:abc", "ns:/run/netns/x"])
    async def test_a_workspace_mode_that_drops_publishing_is_refused(
        self,
        _tf,
        _td,
        tmp_path,
        mode,
    ):
        podman = FakePodman()
        svc = _podman_service(tmp_path, f'root = true\n\n[network]\nmode = "{mode}"\n')

        with on_fake_podman(podman), pytest.raises(NetworkModeUnsupported) as excinfo:
            await svc.create(session_id="session-a")

        assert excinfo.value.status_code == 409
        assert excinfo.value.context == {
            "mode": mode,
            "source": "workspace",
            "session_id": "session-a",
        }
        assert podman.runs == []
        assert svc.list_all() == []

    @pytest.mark.anyio
    async def test_a_bundle_mode_that_drops_publishing_names_the_bundle(self, _tf, _td, tmp_path):
        podman = FakePodman()
        svc = _podman_service(tmp_path, 'root = true\n\n[bundles.web.network]\nmode = "host"\n')

        with on_fake_podman(podman), pytest.raises(NetworkModeUnsupported) as excinfo:
            await svc.create(session_id="session-a", bundle="web")

        assert excinfo.value.context == {
            "mode": "host",
            "source": "bundle",
            "bundle": "web",
            "session_id": "session-a",
        }
        assert podman.runs == []

    @pytest.mark.anyio
    async def test_a_named_network_still_applies(self, _tf, _td, tmp_path):
        podman = FakePodman()
        svc = _podman_service(tmp_path, 'root = true\n\n[network]\nmode = "mynet"\n')

        with on_fake_podman(podman):
            container = await svc.create(session_id="session-a")

        run = podman.runs[0]
        assert run[run.index("--network") + 1] == "mynet"
        assert container.port
