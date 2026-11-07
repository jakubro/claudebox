"""Tests for claudebox_daemon.domain.sessions.spawn - the unix-socket spawn listener."""

from __future__ import annotations

import asyncio
import json
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from claudebox import SessionNotFound as SharedSessionNotFound
from claudebox.constants import SPAWN_SOCKET_LINE_LIMIT
from claudebox.session.models import SessionMetadata
from claudebox_daemon.domain.errors import ListingTimeout
from claudebox_daemon.domain.executors import ObservedPool
from claudebox_daemon.domain.sessions.errors import (
    SessionNotSpawned,
    SiblingNotOwned,
    SiblingStopHostsThread,
    SpawnerUnreachable,
)
from claudebox_daemon.domain.sessions.models import SessionInfo, SiblingSummary
from claudebox_daemon.domain.sessions.service import SessionService
from claudebox_daemon.domain.sessions.spawn import MAX_SPAWN_DEPTH, SPAWN_SOCKET_NAME, SpawnListener
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace


# --- Helpers ---


@pytest.fixture
def socket_dir():
    """Short-path temp dir for the socket file - AF_UNIX paths are capped at 108 bytes, and
    pytest's own tmp_path fixture nests deep enough under this session's bind mount to exceed it."""

    with tempfile.TemporaryDirectory(dir="/tmp") as d:
        yield Path(d)


@pytest.fixture
def deep_socket_dir(socket_dir):
    """A workspace's sessions dir nested deep enough that its socket path exceeds the AF_UNIX cap."""

    deep = socket_dir / ("nested-" * 10) / ("project-" * 6) / ".claudebox" / "sessions"
    deep.mkdir(parents=True)
    assert len(str(deep / SPAWN_SOCKET_NAME)) > 108

    return deep


def _make_listener(
    tmp_path: Path,
    socket_dir: Path,
    *,
    sessions=None,
    containers=None,
    ports=None,
) -> tuple[SpawnListener, MagicMock, MagicMock]:
    """Create a SpawnListener with mocked sessions/containers/ports services."""

    ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
    sessions = sessions if sessions is not None else MagicMock()
    containers = containers if containers is not None else MagicMock()
    listener = SpawnListener(
        ws,
        sessions,
        containers,
        socket_dir,
        ports=ports if ports is not None else MagicMock(),
    )

    return listener, sessions, containers


def _happy_path_services() -> tuple[MagicMock, MagicMock]:
    """sessions/containers mocks wired for a spawn that succeeds end to end."""

    sessions = MagicMock()
    sessions.compute_spawn_depth = MagicMock(return_value=0)
    sessions.get = AsyncMock(
        return_value=SessionInfo(session_id="caller-1", fork_point_cost_usd=0.0, bundle="ops"),
    )
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


def _request(kind: str = "spawn", **overrides) -> bytes:
    bodies = {
        "spawn": {"prompt": "hello", "name": None, "model": None, "effort": None},
        "stop": {"session_id": SIBLING_ID},
        "resume": {"session_id": SIBLING_ID},
        "list": {},
        "turn_ended": {"delivery_id": "d-1", "outcome": "ended", "text": "Done."},
        "port_close": {"port": 8080},
    }
    body = {"verb": kind, "caller_session_id": "caller-1", **bodies[kind]}
    body.update(overrides)

    return (json.dumps(body) + "\n").encode()


SIBLING_ID = "11111111-2222-3333-4444-555555555555"

SPAWNED = {
    "session_id": "child-1",
    "container_id": "ctr-1",
    "prompt_delivered": True,
    "unapplied": [],
}

DEFAULT_SETTINGS = {"name": None, "model": None, "effort_level": None}


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

    @pytest.mark.anyio
    async def test_a_deep_socket_path_binds_where_containers_expect_it(
        self,
        tmp_path,
        socket_dir,
        deep_socket_dir,
    ):
        link = socket_dir / "s"
        link.symlink_to(deep_socket_dir)

        async with _running_listener(tmp_path, deep_socket_dir) as (listener, _, _):
            response = await _send_and_receive(link / SPAWN_SOCKET_NAME, b"not json\n")

            assert listener.socket_path == deep_socket_dir / SPAWN_SOCKET_NAME
            assert listener.socket_path.is_socket()
            assert listener.socket_path.stat().st_mode & 0o777 == 0o600
            assert response == {"error": "malformed_request"}

    @pytest.mark.anyio
    async def test_stop_unlinks_a_deep_socket_file(self, tmp_path, deep_socket_dir):
        listener, _, _ = _make_listener(tmp_path, deep_socket_dir)
        await listener.start()

        await listener.stop()

        assert not listener.socket_path.exists()

    @pytest.mark.anyio
    async def test_a_stale_file_at_a_deep_socket_path_is_replaced(self, tmp_path, deep_socket_dir):
        (deep_socket_dir / SPAWN_SOCKET_NAME).write_text("not a socket")

        async with _running_listener(tmp_path, deep_socket_dir) as (listener, _, _):
            assert listener.socket_path.is_socket()


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

        assert response == SPAWNED
        sessions.create_with_prompt.assert_awaited_once_with(
            "hello",
            spawned_from_session_id="caller-1",
            bundle="ops",
            **DEFAULT_SETTINGS,
        )

    @pytest.mark.anyio
    async def test_reports_when_the_prompt_did_not_arrive(self, tmp_path, socket_dir):
        """The session is still created; the answer must say the prompt was not delivered."""

        sessions, containers = _happy_path_services()
        sessions.create_with_prompt = AsyncMock(
            return_value=SessionInfo(
                session_id="child-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
                failed_prompts=["hello"],
            ),
        )

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

        assert response == {**SPAWNED, "prompt_delivered": False}


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
        ["extra_volumes", "run_args", "image", "privileged", "mounts", "bundle", "runtime", "env"],
    )
    @pytest.mark.parametrize("verb", ["spawn", "stop", "resume", "list"])
    @pytest.mark.anyio
    async def test_no_container_parameter_is_expressible_under_any_name(
        self,
        tmp_path,
        socket_dir,
        field_name,
        verb,
    ):
        """The vocabulary has no extension point, under any plausible container-control name."""

        response = await self._refused(
            tmp_path,
            socket_dir,
            _request(verb, **{field_name: "anything"}),
        )

        assert response == {"error": "unknown_fields"}

    @pytest.mark.parametrize("verb", ["spawn", "stop", "resume"])
    @pytest.mark.anyio
    async def test_a_verbs_missing_key_is_rejected(self, tmp_path, socket_dir, verb):
        body = json.loads(_request(verb))
        missing = next(key for key in body if key not in ("verb", "caller_session_id"))
        del body[missing]

        response = await self._refused(tmp_path, socket_dir, json.dumps(body).encode() + b"\n")

        assert response == {"error": "unknown_fields"}

    @pytest.mark.parametrize(
        ("overrides", "error"),
        [
            ({"name": "   "}, "invalid_name"),
            ({"name": "two\nlines"}, "invalid_name"),
            ({"name": 7}, "invalid_name"),
            ({"model": "has space"}, "invalid_model"),
            ({"model": ""}, "invalid_model"),
            ({"effort": "extreme"}, "invalid_effort"),
        ],
    )
    @pytest.mark.anyio
    async def test_a_malformed_spawn_setting_is_rejected(
        self,
        tmp_path,
        socket_dir,
        overrides,
        error,
    ):
        response = await self._refused(tmp_path, socket_dir, _request(**overrides))

        assert response == {"error": error}

    @pytest.mark.parametrize("verb", ["stop", "resume"])
    @pytest.mark.parametrize("session_id", ["../etc", "", 5])
    @pytest.mark.anyio
    async def test_a_malformed_session_id_is_rejected(self, tmp_path, socket_dir, verb, session_id):
        response = await self._refused(tmp_path, socket_dir, _request(verb, session_id=session_id))

        assert response == {"error": "invalid_session_id"}

    @pytest.mark.parametrize("verb", [["spawn"], 7, None])
    @pytest.mark.anyio
    async def test_a_verb_that_is_not_a_known_name_is_rejected(self, tmp_path, socket_dir, verb):
        response = await self._refused(tmp_path, socket_dir, _request(verb=verb))

        assert response == {"error": "unknown_verb"}

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

        assert response == {"error": "unknown_verb"}

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

        assert ok == SPAWNED

    @pytest.mark.anyio
    async def test_an_oversized_payload_is_rejected(self, tmp_path, socket_dir):
        response = await self._refused(tmp_path, socket_dir, b"x" * (SPAWN_SOCKET_LINE_LIMIT + 1))

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

        assert response == SPAWNED

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

    @pytest.mark.anyio
    async def test_recorded_lineage_is_the_resolved_caller_not_the_claim(
        self,
        tmp_path,
        socket_dir,
    ):
        sessions, containers = _happy_path_services()
        sessions.compute_spawn_depth = MagicMock(return_value=0)

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
            await _send_and_receive(
                listener._socket_path,
                _request(caller_session_id="an-unknown-session-nobody-heard-of"),
            )

        sessions.create_with_prompt.assert_awaited_once_with(
            "hello",
            spawned_from_session_id="caller-1",
            bundle="ops",
            **DEFAULT_SETTINGS,
        )

    @pytest.mark.anyio
    async def test_three_real_spawn_generations_reach_the_cap_the_fourth_is_refused(
        self,
        tmp_path,
        socket_dir,
    ):
        """Runs the real depth walk across real session records (every other test here mocks it) -
        every request claims the same nonexistent ancestor, which pre-fix resets depth to one each time.
        """

        (tmp_path / ".workspace").touch()
        ws = RegisteredWorkspace(id="test-ws", path=tmp_path)
        executor = ObservedPool(1, name="test-spawn-depth")
        session_containers = MagicMock()
        session_containers.find_by_session = AsyncMock(return_value=None)
        sessions = SessionService(
            ws,
            session_containers,
            AsyncMock(),
            agent="claude",
            executor=executor,
        )
        sessions._repo = MagicMock()

        records = {"root": SessionMetadata(session_id="root", fork_point_cost_usd=0.0)}

        def _get_record(session_id):
            try:
                return records[session_id]
            except KeyError:
                raise SharedSessionNotFound(session_id=session_id) from None

        sessions._repo.get.side_effect = _get_record

        next_ids = iter(["gen1", "gen2", "gen3", "gen4"])

        async def fake_create_with_prompt(
            prompt,
            *,
            spawned_from_session_id=None,
            bundle=None,
            **_settings,
        ):
            child_id = next(next_ids)
            records[child_id] = SessionMetadata(
                session_id=child_id,
                fork_point_cost_usd=0.0,
                spawned_from_session_id=spawned_from_session_id,
            )

            return SessionInfo(
                session_id=child_id,
                fork_point_cost_usd=0.0,
                container_id=f"ctr-{child_id}",
            )

        sessions.create_with_prompt = AsyncMock(side_effect=fake_create_with_prompt)

        containers = MagicMock()
        caller = "root"
        containers.find_by_peer_pid = AsyncMock(return_value=MagicMock(session_id=caller))

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
            for _ in range(3):
                response = await _send_and_receive(
                    listener._socket_path,
                    _request(caller_session_id="a-nonexistent-claimed-ancestor"),
                )
                assert response is not None and "session_id" in response, response
                caller = response["session_id"]
                containers.find_by_peer_pid = AsyncMock(return_value=MagicMock(session_id=caller))

            response = await _send_and_receive(
                listener._socket_path,
                _request(caller_session_id="a-nonexistent-claimed-ancestor"),
            )

        assert response == {
            "error": "spawn_depth_exceeded",
            "cap": MAX_SPAWN_DEPTH,
            "depth": MAX_SPAWN_DEPTH,
        }


# --- Spawn settings ---


class TestSpawnSettings:
    """The name, model and effort a spawn names reach session creation; the bundle stays inherited."""

    @pytest.mark.anyio
    async def test_settings_are_forwarded_and_the_name_trimmed(self, tmp_path, socket_dir):
        sessions, containers = _happy_path_services()

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (listener, _s, _c):
            await _send_and_receive(
                listener._socket_path,
                _request(name="  lint-fix ", model="haiku", effort="low"),
            )

        sessions.create_with_prompt.assert_awaited_once_with(
            "hello",
            spawned_from_session_id="caller-1",
            bundle="ops",
            name="lint-fix",
            model="haiku",
            effort_level="low",
        )

    @pytest.mark.anyio
    async def test_an_explicit_setting_the_runtime_could_not_apply_is_named(
        self,
        tmp_path,
        socket_dir,
    ):
        sessions, containers = _happy_path_services()
        sessions.create_with_prompt = AsyncMock(
            return_value=SessionInfo(
                session_id="child-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
                failed_seeds=["model", "effort_level", "permission_mode"],
            ),
        )

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (listener, _s, _c):
            response = await _send_and_receive(
                listener._socket_path,
                _request(model="haiku", effort="low"),
            )

        assert response is not None
        assert response["unapplied"] == ["model", "effort"]

    @pytest.mark.anyio
    async def test_a_bundle_value_that_failed_is_not_reported_as_unapplied(
        self,
        tmp_path,
        socket_dir,
    ):
        sessions, containers = _happy_path_services()
        sessions.create_with_prompt = AsyncMock(
            return_value=SessionInfo(
                session_id="child-1",
                fork_point_cost_usd=0.0,
                container_id="ctr-1",
                failed_seeds=["model"],
            ),
        )

        async with _running_listener(
            tmp_path,
            socket_dir,
            sessions=sessions,
            containers=containers,
        ) as (listener, _s, _c):
            response = await _send_and_receive(listener._socket_path, _request())

        assert response is not None
        assert response["unapplied"] == []


# --- Sibling verbs ---


def _sibling_services() -> tuple[MagicMock, MagicMock]:
    sessions, containers = _happy_path_services()
    sessions.stop_spawned = AsyncMock(return_value=None)
    sessions.resume_spawned = AsyncMock(
        return_value=(
            SessionInfo(session_id=SIBLING_ID, fork_point_cost_usd=0.0, container_id="ctr-now"),
            True,
        ),
    )
    sessions.list_spawned = AsyncMock(
        return_value=[SiblingSummary(session_id=SIBLING_ID, name="lint-fix", state="idle")],
    )

    return sessions, containers


async def _sibling_reply(tmp_path, socket_dir, payload: bytes, sessions, containers) -> dict | None:
    async with _running_listener(
        tmp_path,
        socket_dir,
        sessions=sessions,
        containers=containers,
    ) as (listener, _s, _c):
        return await _send_and_receive(listener._socket_path, payload)


class TestSiblingVerbs:
    """stop, resume and list act for the peer-resolved caller, never the one the payload names."""

    @pytest.mark.anyio
    async def test_stop_answers_stopped_for_the_resolved_caller(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("stop", caller_session_id="someone-else"),
            sessions,
            containers,
        )

        assert response == {"session_id": SIBLING_ID, "state": "stopped"}
        sessions.stop_spawned.assert_awaited_once_with("caller-1", SIBLING_ID)

    @pytest.mark.anyio
    async def test_resume_answers_where_the_sibling_runs_now(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("resume"),
            sessions,
            containers,
        )

        assert response == {"session_id": SIBLING_ID, "container_id": "ctr-now", "resumed": True}
        sessions.resume_spawned.assert_awaited_once_with("caller-1", SIBLING_ID)

    @pytest.mark.anyio
    async def test_list_answers_each_sibling_with_name_and_state(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("list"),
            sessions,
            containers,
        )

        assert response == {
            "sessions": [{"session_id": SIBLING_ID, "name": "lint-fix", "state": "idle"}],
        }
        sessions.list_spawned.assert_awaited_once_with("caller-1")

    @pytest.mark.anyio
    async def test_an_empty_list_answers_an_empty_list(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()
        sessions.list_spawned = AsyncMock(return_value=[])

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("list"),
            sessions,
            containers,
        )

        assert response == {"sessions": []}

    @pytest.mark.parametrize("verb", ["stop", "resume", "list"])
    @pytest.mark.anyio
    async def test_no_depth_walk_runs_for_a_sibling_verb(self, tmp_path, socket_dir, verb):
        sessions, containers = _sibling_services()

        await _sibling_reply(tmp_path, socket_dir, _request(verb), sessions, containers)

        sessions.compute_spawn_depth.assert_not_called()

    @pytest.mark.parametrize("verb", ["stop", "resume", "list"])
    @pytest.mark.anyio
    async def test_an_unresolvable_peer_is_refused_with_no_service_call(
        self,
        tmp_path,
        socket_dir,
        verb,
    ):
        sessions, containers = _sibling_services()
        containers.find_by_peer_pid = AsyncMock(return_value=None)

        response = await _sibling_reply(tmp_path, socket_dir, _request(verb), sessions, containers)

        assert response == {"error": "caller_unresolved"}
        sessions.stop_spawned.assert_not_awaited()
        sessions.resume_spawned.assert_not_awaited()
        sessions.list_spawned.assert_not_awaited()

    @pytest.mark.parametrize(
        ("verb", "method"),
        [("stop", "stop_spawned"), ("resume", "resume_spawned")],
    )
    @pytest.mark.anyio
    async def test_a_session_the_caller_did_not_spawn_is_refused_naming_it(
        self,
        tmp_path,
        socket_dir,
        verb,
        method,
    ):
        sessions, containers = _sibling_services()
        setattr(sessions, method, AsyncMock(side_effect=SiblingNotOwned(session_id=SIBLING_ID)))

        response = await _sibling_reply(tmp_path, socket_dir, _request(verb), sessions, containers)

        assert response == {"error": "not_own_sibling", "session_id": SIBLING_ID}

    @pytest.mark.anyio
    async def test_a_reply_thread_in_the_way_is_named(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()
        sessions.stop_spawned = AsyncMock(
            side_effect=SiblingStopHostsThread(session_id="thread-1"),
        )

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("stop"),
            sessions,
            containers,
        )

        assert response == {"error": "hosts_your_thread", "session_id": "thread-1"}

    @pytest.mark.anyio
    async def test_a_listing_timeout_answers_its_key_and_no_path(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()
        sessions.list_spawned = AsyncMock(
            side_effect=ListingTimeout(workspace=str(tmp_path)),
        )

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("list"),
            sessions,
            containers,
        )

        assert response == {"error": "listing_timeout"}


class TestTurnEnded:
    """A spawned session's turn end goes to the daemon's delivery for the peer-resolved sender."""

    @pytest.mark.parametrize("outcome", ["delivered", "held", "dropped"])
    @pytest.mark.anyio
    async def test_answers_how_the_turn_end_was_taken(self, tmp_path, socket_dir, outcome):
        sessions, containers = _sibling_services()
        sessions.deliver_turn_end = AsyncMock(return_value=outcome)

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("turn_ended", caller_session_id="claimed-other"),
            sessions,
            containers,
        )

        assert response == {outcome: True}
        sessions.deliver_turn_end.assert_awaited_once_with(
            "caller-1",
            delivery_id="d-1",
            outcome="ended",
            text="Done.",
        )

    @pytest.mark.parametrize("error", [SessionNotSpawned, SpawnerUnreachable])
    @pytest.mark.anyio
    async def test_a_refusal_carries_its_key_and_no_context(self, tmp_path, socket_dir, error):
        sessions, containers = _sibling_services()
        sessions.deliver_turn_end = AsyncMock(side_effect=error(session_id="secret-parent"))

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("turn_ended"),
            sessions,
            containers,
        )

        assert response == {"error": error.error_key}

    @pytest.mark.parametrize(
        ("overrides", "error"),
        [
            ({"delivery_id": " "}, "invalid_delivery_id"),
            ({"delivery_id": 3}, "invalid_delivery_id"),
            ({"outcome": "maybe"}, "invalid_outcome"),
            ({"text": None}, "invalid_text"),
        ],
    )
    @pytest.mark.anyio
    async def test_a_malformed_turn_end_is_refused(self, tmp_path, socket_dir, overrides, error):
        sessions, containers = _sibling_services()
        sessions.deliver_turn_end = AsyncMock(return_value="delivered")

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("turn_ended", **overrides),
            sessions,
            containers,
        )

        assert response == {"error": error}
        sessions.deliver_turn_end.assert_not_awaited()

    @pytest.mark.anyio
    async def test_a_turns_text_of_a_megabyte_fits_one_line(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()
        sessions.deliver_turn_end = AsyncMock(return_value="delivered")
        text = "x" * (1024 * 1024)

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("turn_ended", text=text),
            sessions,
            containers,
        )

        assert response == {"delivered": True}
        call = sessions.deliver_turn_end.await_args
        assert call is not None
        assert call.kwargs["text"] == text


class TestPortClose:
    """A container closes a port its own session opened; the session comes from the connection."""

    @pytest.mark.anyio
    async def test_closes_the_resolved_callers_port(self, tmp_path, socket_dir):
        sessions, containers = _sibling_services()
        ports = MagicMock(close=AsyncMock(return_value=None))

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
            listener._ports = ports
            response = await _send_and_receive(
                listener._socket_path,
                _request("port_close", caller_session_id="claimed"),
            )

        assert response == {"port": 8080, "state": "closed"}
        ports.close.assert_awaited_once_with("caller-1", 8080)

    @pytest.mark.parametrize("port", [0, 70000, "8080", True])
    @pytest.mark.anyio
    async def test_a_port_outside_the_range_is_refused(self, tmp_path, socket_dir, port):
        sessions, containers = _sibling_services()

        response = await _sibling_reply(
            tmp_path,
            socket_dir,
            _request("port_close", port=port),
            sessions,
            containers,
        )

        assert response == {"error": "invalid_port"}

    @pytest.mark.anyio
    async def test_a_port_never_opened_is_refused(self, tmp_path, socket_dir):
        from claudebox_daemon.domain.ports import PortNotOpen

        sessions, containers = _sibling_services()

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
            listener._ports = MagicMock(close=AsyncMock(side_effect=PortNotOpen(port="8080")))
            response = await _send_and_receive(listener._socket_path, _request("port_close"))

        assert response == {"error": "port_not_open"}
