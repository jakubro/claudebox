"""Tests for claudebox_daemon.domain.containers.service - container lifecycle."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox.config import Config
from claudebox_daemon.domain.containers.errors import ContainerNotFound
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.containers.service import ContainerService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


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
    svc = ContainerService(ws, events, config, proxy)
    # Mock the container runtime backend to prevent real subprocess calls
    svc._runtime._backend = MagicMock()

    return svc, events


# --- get ---


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
            }
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
            }
        ]
        svc._runtime._backend.get_host_port.return_value = 8080

        await svc.sync_state()

        c = svc._containers["c1"]
        assert c.backend_id == "new-b"
        assert c.port == 8080
        assert c.status == ContainerStatus.RUNNING
        assert c.failure_count == 0

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
    async def test_ignores_other_workspace(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "backend-1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "other-ws"},
            }
        ]

        await svc.sync_state()

        assert "c1" not in svc._containers

    @pytest.mark.anyio
    async def test_ignores_container_without_id_label(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = [
            {"Id": "backend-1", "State": "running", "Labels": {}}
        ]

        await svc.sync_state()

        assert len(svc._containers) == 0

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

        # Containers unchanged
        assert svc._containers["c1"].status == ContainerStatus.RUNNING

    @pytest.mark.anyio
    async def test_port_discovery_failure(self, tmp_path):
        svc, _ = _make_service(tmp_path)
        svc._runtime._backend.list_containers.return_value = [
            {
                "Id": "backend-1",
                "State": "running",
                "Labels": {"claudebox-id": "c1", "claudebox-workspace": "test-ws"},
            }
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

        # Podman container name should be the UUID id
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
