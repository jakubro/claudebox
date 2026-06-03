"""Tests for claudebox_daemon.domain.sessions.service — session lifecycle."""

import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from claudebox import SessionNotFound as SharedSessionNotFound
from claudebox import Workspace, write_json
from claudebox.constants import SESSION_METADATA_FILE
from claudebox.session.models import SessionMetadata
from claudebox_daemon.domain.containers.errors import ContainerTimeout
from claudebox_daemon.domain.containers.models import Container, ContainerStatus
from claudebox_daemon.domain.sessions.errors import SessionNotFound
from claudebox_daemon.domain.sessions.models import SessionInfo
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


def _make_metadata(session_id: str, **overrides) -> SessionMetadata:
    """Create a SessionMetadata with sensible defaults."""
    defaults = dict(session_id=session_id)
    defaults.update(overrides)
    return SessionMetadata(**defaults)  # ty: ignore[invalid-argument-type]  # Dynamic kwargs from heterogeneous defaults dict; ty can't narrow per-field types here.


def _make_container(
    container_id: str = "ctr-1",
    port: int = 8080,
    session_id: str | None = None,
    status: ContainerStatus = ContainerStatus.RUNNING,
) -> Container:
    """Create a Container with sensible defaults."""
    return Container(
        id=container_id,
        backend_id="backend-1",
        port=port,
        status=status,
        session_id=session_id,
    )


def _make_service(tmp_path: Path) -> tuple[SessionService, MagicMock, MagicMock]:
    """Create a SessionService with mocked repo and containers.

    Returns (service, mock_repo, mock_containers).
    """
    (tmp_path / ".workspace").touch()
    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    containers = MagicMock()
    events = AsyncMock()

    svc = SessionService(ws, containers, events)
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
        containers.find_by_session = AsyncMock(return_value=_make_container("ctr-1"))

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
    async def test_multiple_sessions(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.list_all.return_value = [
            _make_metadata("sess-1"),
            _make_metadata("sess-2"),
        ]
        containers.find_by_session = AsyncMock(
            side_effect=[
                _make_container("ctr-1"),
                None,
            ]
        )

        result = await svc.list_all()

        assert len(result) == 2
        assert result[0].container_id == "ctr-1"
        assert result[1].container_id is None


# --- get ---


class TestGet:
    """Test session lookup by ID."""

    @pytest.mark.anyio
    async def test_returns_session_info_with_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        repo.get.return_value = _make_metadata("sess-1", name="my session")
        containers.find_by_session = AsyncMock(return_value=_make_container("ctr-1"))

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
    async def test_raises_session_not_found(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.get.side_effect = SharedSessionNotFound(
            "sess-missing"
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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
            "sess-1", name="updated"
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert result.session_id == "sess-1"
        assert result.name == "updated"

    @pytest.mark.anyio
    async def test_raises_session_not_found(self, tmp_path):
        svc, repo, _containers = _make_service(tmp_path)
        repo.update.side_effect = SharedSessionNotFound(
            "sess-missing"
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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
        assert result.model == "claude-opus-4-8"
        assert result.permission_mode == "default"
        assert result.num_turns == 0
        assert result.total_cost_usd == 0.0
        containers.create.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        # Verify POST to /api/sessions/new
        mock_client.post.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        post_url = mock_client.post.call_args[0][
            0
        ]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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


# --- resume ---


class TestResume:
    """Test session resume — reuses existing container or spawns new."""

    @pytest.mark.anyio
    async def test_returns_existing_container(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        existing = _make_container("ctr-existing", session_id="sess-1")
        containers.find_by_session = AsyncMock(return_value=existing)
        repo.get.side_effect = SharedSessionNotFound(
            "sess-1"
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

        result = await svc.resume("sess-1")

        assert isinstance(result, SessionInfo)
        assert result.session_id == "sess-1"
        assert result.container_id == "ctr-existing"
        assert result.workspace == str(tmp_path)
        assert result.effort_level == "xhigh"
        # Should not create a new container
        containers.create.assert_not_called()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    @pytest.mark.anyio
    async def test_spawns_new_container_when_none_exists(self, tmp_path):
        svc, repo, containers = _make_service(tmp_path)
        containers.find_by_session = AsyncMock(return_value=None)
        new_container = _make_container("ctr-new", port=9090)
        containers.create = AsyncMock(return_value=new_container)
        containers.get.return_value = new_container
        repo.get.side_effect = SharedSessionNotFound(
            "sess-1"
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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
            session_id="sess-1"
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        # Verify POST to /api/sessions/{id}/resume
        mock_client.post.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        post_url = mock_client.post.call_args[0][
            0
        ]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert "/api/sessions/sess-1/resume" in post_url


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

        # Only one GET call — succeeded immediately
        mock_client.get.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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
                side_effect=[ConnectionError("down"), ConnectionError("down"), ok_response]
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

        # All 3 retries exhausted
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
            }[sid]
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
        lines = [
            json.dumps({"type": "assistant", "uuid": "t1"}) + "\n",
            json.dumps({"type": "user", "uuid": "t2"}) + "\n",
            json.dumps({"type": "assistant", "uuid": "t2"}) + "\n",
        ]
        (tmp_path / "sess.jsonl").write_text("".join(lines))

        SessionService._truncate_sdk_transcript(ws, "sess", "t2")

        result = (tmp_path / "sess.jsonl").read_text().splitlines()
        assert len(result) == 1

    def test_skips_when_absent(self, tmp_path):
        ws = self._make_ws(tmp_path)

        SessionService._truncate_sdk_transcript(ws, "nonexistent", "t1")


# --- fork ---


class TestForkOwnershipTransfer:
    """Test fork(reuse_container=True) transfers Container.session_id to the new session."""

    @pytest.mark.anyio
    async def test_reuse_container_transfers_session_id(self, tmp_path):
        """When forking with reuse_container=True, container.session_id moves to the child."""

        svc, repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # Provide real metadata for the seed dict — using MagicMock here causes
        # JSONEncoder to recursively auto-vivify MagicMock fields (OOM).
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
        containers.update.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        update_call = (
            containers.update.await_args
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert update_call.args[0] is existing  # ty: ignore[unresolved-attribute]
        assert update_call.kwargs.get("session_id") == result.session_id  # ty: ignore[unresolved-attribute]
        # Result reflects the reused container.
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

        with pytest.raises(ValueError, match="No running container"):
            await svc.fork(parent_id, reuse_container=True)

        # No transfer should have happened.
        containers.update.assert_not_called()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

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
        containers.create.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        create_call = (
            containers.create.await_args
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        assert create_call.kwargs.get("session_id") == result.session_id  # ty: ignore[unresolved-attribute]
        # No ownership-transfer update call (containers.update was never invoked
        # for transfer purposes — the fresh-container path does not touch it).
        containers.update.assert_not_called()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.


# --- fork inheritance ---


def _seed_parent_session_json(tmp_path: Path, parent_id: str, payload: dict) -> Path:
    """Write a session.json for the source session inside the workspace.

    Returns the parent session directory so callers can also stage sibling
    artifacts (events.jsonl, etc.) when a test needs them.
    """
    workspace = Workspace(tmp_path)
    parent_session = workspace.ensure_session(parent_id)
    write_json(parent_session.path / SESSION_METADATA_FILE, payload)
    return parent_session.path


def _read_fork_session_json(tmp_path: Path, fork_id: str) -> dict:
    """Read the new session's session.json from disk after fork()."""
    workspace = Workspace(tmp_path)
    fork_session = workspace.ensure_session(fork_id)
    return json.loads((fork_session.path / SESSION_METADATA_FILE).read_text())


class TestForkInheritsUserSettings:
    """Forking carries user-controlled settings (permission mode, effort, prompt, name) from the parent."""

    @pytest.mark.anyio
    async def test_inherits_permission_mode_effort_session_prompt_name_model(self, tmp_path):
        """The fork's session.json mirrors the parent's user settings verbatim."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # Make repo.get raise: MagicMock return_value would auto-vivify into the
        # seed dict and OOM JSONEncoder. Post-fix code never calls repo.get from
        # fork() — this guard only matters for the legacy overlay loop.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
        _seed_parent_session_json(
            tmp_path,
            parent_id,
            {
                "session_id": parent_id,
                "name": "Parent",
                "model": "claude-sonnet-4-6",
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
        assert fork_data["model"] == "claude-sonnet-4-6"
        # Display-relevant counters and previews carry over too.
        assert fork_data["num_turns"] == 7
        assert fork_data["total_cost_usd"] == 0.42
        assert fork_data["first_message"] == "Initial"
        assert fork_data["last_message"] == "Latest"
        # SessionInfo result mirrors the inheritance for the fields it exposes.
        # session_prompt intentionally lives only on session.json (the
        # SessionInfo / SessionMetadata dataclasses don't surface it); the
        # frontend reads it directly from the per-session metadata file.
        assert result.permission_mode == "bypassPermissions"
        assert result.effort_level == "max"
        assert result.name == "Parent"

    @pytest.mark.anyio
    async def test_overrides_identity_fields(self, tmp_path):
        """session_id, parent_session_id, session_dir, workspace, started_at, updated_at always overridden."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # Make repo.get raise: MagicMock return_value would auto-vivify into the
        # seed dict and OOM JSONEncoder. Post-fix code never calls repo.get from
        # fork() — this guard only matters for the legacy overlay loop.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
        # Make repo.get raise: MagicMock return_value would auto-vivify into the
        # seed dict and OOM JSONEncoder. Post-fix code never calls repo.get from
        # fork() — this guard only matters for the legacy overlay loop.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
        # No KeyError when user-settings keys are absent — they are simply missing.
        assert "permission_mode" not in fork_data
        assert "effort_level" not in fork_data
        assert "session_prompt" not in fork_data

    @pytest.mark.anyio
    async def test_corrupt_parent_session_json_falls_back_to_defaults(self, tmp_path):
        """Unparseable parent session.json — fork seeds with identity only and logs."""

        svc, _repo, containers = _make_service(tmp_path)
        parent_id = "sess-parent"
        # Make repo.get raise: MagicMock return_value would auto-vivify into the
        # seed dict and OOM JSONEncoder. Post-fix code never calls repo.get from
        # fork() — this guard only matters for the legacy overlay loop.
        _repo.get.side_effect = SharedSessionNotFound(
            parent_id
        )  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
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
        # Inherited fields are absent — corrupt source means safe-default fallback.
        assert "permission_mode" not in fork_data
        assert "effort_level" not in fork_data
