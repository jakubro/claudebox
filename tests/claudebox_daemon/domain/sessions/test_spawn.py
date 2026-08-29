"""Tests for claudebox_daemon.domain.sessions.spawn - the unix-socket spawn listener."""

import asyncio
import json
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from claudebox_daemon.domain.sessions.models import SessionInfo
from claudebox_daemon.domain.sessions.spawn import MAX_SPAWN_DEPTH, SPAWN_SOCKET_NAME, SpawnListener
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


@pytest.fixture
def socket_dir():
    """Short-path temp dir for the socket file - AF_UNIX paths are capped at 108 bytes, and
    pytest's own tmp_path fixture nests deep enough under this session's bind mount to exceed it."""

    with tempfile.TemporaryDirectory(dir="/tmp") as d:
        yield Path(d)


def _make_listener(
    tmp_path: Path,
    socket_dir: Path,
    *,
    sessions=None,
    containers=None,
) -> tuple[SpawnListener, MagicMock, MagicMock]:
    """Create a SpawnListener with mocked sessions/containers services."""

    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    sessions = sessions if sessions is not None else MagicMock()
    containers = containers if containers is not None else MagicMock()
    listener = SpawnListener(ws, sessions, containers, socket_dir)

    return listener, sessions, containers


def _happy_path_services() -> tuple[MagicMock, MagicMock]:
    """sessions/containers mocks wired for a spawn that succeeds end to end."""

    sessions = MagicMock()
    sessions.compute_spawn_depth = MagicMock(return_value=0)
    sessions.create_with_prompt = AsyncMock(
        return_value=SessionInfo(
            session_id="child-1",
            fork_point_cost_usd=0.0,
            container_id="ctr-1",
        ),
    )

    containers = MagicMock()
    containers.find_by_peer_pid = AsyncMock(return_value=MagicMock(session_id="caller-1"))

    return sessions, containers


@asynccontextmanager
async def _running_listener(tmp_path: Path, socket_dir: Path, *, sessions=None, containers=None):
    """Build, start, and guarantee-stop a SpawnListener - most tests just need one running."""

    listener, sessions, containers = _make_listener(
        tmp_path,
        socket_dir,
        sessions=sessions,
        containers=containers,
    )
    await listener.start()

    try:
        yield listener, sessions, containers
    finally:
        await listener.stop()


async def _send_and_receive(socket_path: Path, payload: bytes) -> dict | None:
    """Connect, send raw bytes, read one line of JSON response - None if closed with no reply."""

    reader, writer = await asyncio.open_unix_connection(path=str(socket_path))

    writer.write(payload)
    await writer.drain()
    writer.write_eof()  # lets the server's readline() settle on data with no trailing newline

    line = await reader.readline()
    writer.close()
    await writer.wait_closed()

    return json.loads(line) if line else None


def _request(**overrides) -> bytes:
    body = {"verb": "spawn", "caller_session_id": "caller-1", "prompt": "hello"}
    body.update(overrides)

    return (json.dumps(body) + "\n").encode()


# --- Lifecycle ---


class TestSpawnListenerLifecycle:
    """Test socket bind/unbind, including recovery from a hard daemon kill."""

    @pytest.mark.anyio
    async def test_start_binds_a_socket_file(self, tmp_path, socket_dir):
        async with _running_listener(tmp_path, socket_dir) as (listener, _sessions, _containers):
            assert listener._socket_path.exists()
            assert listener._socket_path.name == SPAWN_SOCKET_NAME

    @pytest.mark.anyio
    async def test_stop_unlinks_the_socket_file(self, tmp_path, socket_dir):
        listener, _, _ = _make_listener(tmp_path, socket_dir)
        await listener.start()

        await listener.stop()

        assert not listener._socket_path.exists()

    @pytest.mark.anyio
    async def test_start_recovers_from_a_stale_socket_file(self, tmp_path, socket_dir):
        """A hard daemon kill leaves the socket file behind with nothing listening - start()
        must unlink and rebind rather than fail to bind."""

        (socket_dir / SPAWN_SOCKET_NAME).write_text("not a socket")

        async with _running_listener(tmp_path, socket_dir) as (listener, _sessions, _containers):
            assert listener._socket_path.is_socket()


# --- Happy path ---


class TestSpawnListenerHappyPath:
    """Test the well-formed spawn request end to end, over a real unix socket."""

    @pytest.mark.anyio
    async def test_returns_the_new_session_and_container_ids(self, tmp_path, socket_dir):
        sessions, containers = _happy_path_services()

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(listener._socket_path, _request())

        assert response == {"session_id": "child-1", "container_id": "ctr-1"}
        sessions.create_with_prompt.assert_awaited_once_with(
            "hello",
            spawned_from_session_id="caller-1",
        )


# --- Request validation ---


class TestSpawnListenerValidation:
    """Test the request-shape refusal cases - unknown fields are rejected, never ignored."""

    async def _refused(self, tmp_path, socket_dir, payload: bytes) -> dict | None:
        sessions, containers = _happy_path_services()

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(listener._socket_path, payload)

        sessions.create_with_prompt.assert_not_awaited()

        return response

    @pytest.mark.anyio
    async def test_an_extra_field_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, _request(extra_field="mount=/etc"))

        assert response == {"error": "unknown_fields"}

    @pytest.mark.anyio
    async def test_a_missing_field_is_rejected(self, tmp_path, socket_dir):
        payload = json.dumps({"verb": "spawn", "prompt": "hello"}).encode() + b"\n"
        response = await self._refused(tmp_path, socket_dir, payload)

        assert response == {"error": "unknown_fields"}

    @pytest.mark.parametrize(
        "field_name",
        ["extra_volumes", "run_args", "image", "privileged", "mounts", "name"],
    )
    @pytest.mark.anyio
    async def test_no_container_parameter_is_expressible_under_any_name(
        self,
        tmp_path,
        socket_dir,
        field_name,
    ):
        """The vocabulary has no extension point, under any plausible container-control name."""

        response = await self._refused(tmp_path, socket_dir, _request(**{field_name: "anything"}))

        assert response == {"error": "unknown_fields"}

    @pytest.mark.anyio
    async def test_an_unknown_verb_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, _request(verb="delete"))

        assert response == {"error": "unknown_verb"}

    @pytest.mark.anyio
    async def test_a_blank_prompt_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, _request(prompt="   "))

        assert response == {"error": "invalid_prompt"}

    @pytest.mark.anyio
    async def test_a_non_string_prompt_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, _request(prompt=42))

        assert response == {"error": "invalid_prompt"}

    @pytest.mark.anyio
    async def test_a_blank_caller_session_id_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, _request(caller_session_id=""))

        assert response == {"error": "invalid_caller_session_id"}

    @pytest.mark.anyio
    async def test_a_json_array_instead_of_an_object_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, b'["spawn", "x", "y"]\n')

        assert response == {"error": "unknown_fields"}

    @pytest.mark.anyio
    async def test_malformed_json_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, b"{not json at all\n")

        assert response == {"error": "malformed_request"}

    @pytest.mark.anyio
    async def test_garbage_bytes_are_rejected_and_the_daemon_stays_up(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, b"\x00\x01\xff\xfe garbage \n")

        assert response == {"error": "malformed_request"}

        # Proven by using the same socket dir again - a garbage connection didn't take it down.
        sessions, containers = _happy_path_services()

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            ok = await _send_and_receive(listener._socket_path, _request())

        assert ok == {"session_id": "child-1", "container_id": "ctr-1"}

    @pytest.mark.anyio
    async def test_an_oversized_payload_is_rejected(self, tmp_path, socket_dir):
        # Exceeds the stream's default 64KiB line-buffer limit with no newline at all.
        response = await self._refused(tmp_path, socket_dir, b"x" * 70_000)

        assert response == {"error": "payload_too_large"}


# --- Caller resolution and the depth cap ---


class TestSpawnListenerCallerResolution:
    """Test that the caller is identified from the connection, never the payload."""

    @pytest.mark.anyio
    async def test_an_unresolvable_peer_is_refused(self, tmp_path, socket_dir):
        sessions, containers = _happy_path_services()
        containers.find_by_peer_pid = AsyncMock(return_value=None)

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(listener._socket_path, _request())

        assert response == {"error": "caller_unresolved"}
        sessions.create_with_prompt.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_caller_container_with_no_session_is_refused(self, tmp_path, socket_dir):
        """A container mid-boot, not yet owning a session - fails closed, same as unresolved."""

        sessions, containers = _happy_path_services()
        containers.find_by_peer_pid = AsyncMock(return_value=MagicMock(session_id=None))

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(listener._socket_path, _request())

        assert response == {"error": "caller_unresolved"}

    @pytest.mark.anyio
    async def test_an_unreadable_caller_record_is_refused(self, tmp_path, socket_dir):
        """compute_spawn_depth returning None means the caller's own record can't be read -
        exactly the state a laundering attempt produces, so this fails closed."""

        sessions, containers = _happy_path_services()
        sessions.compute_spawn_depth = MagicMock(return_value=None)

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(listener._socket_path, _request())

        assert response == {"error": "caller_record_unreadable"}
        sessions.create_with_prompt.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_caller_at_the_cap_is_refused_naming_the_cap_and_the_depth(
        self,
        tmp_path,
        socket_dir,
    ):
        sessions, containers = _happy_path_services()
        sessions.compute_spawn_depth = MagicMock(return_value=MAX_SPAWN_DEPTH)

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(listener._socket_path, _request())

        assert response == {
            "error": "spawn_depth_exceeded",
            "cap": MAX_SPAWN_DEPTH,
            "depth": MAX_SPAWN_DEPTH,
        }
        sessions.create_with_prompt.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_caller_one_below_the_cap_is_allowed(self, tmp_path, socket_dir):
        sessions, containers = _happy_path_services()
        sessions.compute_spawn_depth = MagicMock(return_value=MAX_SPAWN_DEPTH - 1)

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(listener._socket_path, _request())

        assert response == {"session_id": "child-1", "container_id": "ctr-1"}

    @pytest.mark.anyio
    async def test_naming_a_different_caller_in_the_payload_never_moves_the_depth(
        self,
        tmp_path,
        socket_dir,
    ):
        """The cap is derived from the connection's real peer, not from caller_session_id - a
        request claiming a shallower ancestor is refused identically to an honest one."""

        sessions, containers = _happy_path_services()
        sessions.compute_spawn_depth = MagicMock(return_value=MAX_SPAWN_DEPTH)

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (
            listener,
            _s,
            _c,
        ):
            response = await _send_and_receive(
                listener._socket_path,
                _request(caller_session_id="root-session-claimed-falsely"),
            )

        assert response == {
            "error": "spawn_depth_exceeded",
            "cap": MAX_SPAWN_DEPTH,
            "depth": MAX_SPAWN_DEPTH,
        }
        # The depth check reads the resolved caller's OWN record - the claimed id in the
        # payload never enters that computation.
        sessions.compute_spawn_depth.assert_called_once_with("caller-1")
