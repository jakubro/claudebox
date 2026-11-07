"""SiblingSessionClient tests - every verb against a fake daemon socket and sibling endpoint."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from claudebox.agent_session._sibling_sessions import (
    SIBLING_REPLY_NOTE,
    SiblingSessionClient,
    SiblingSessionError,
    report_sibling_turn_end,
)
from claudebox.agent_session.orchestration.models import PublishedEvent
from claudebox.agent_session.orchestration.persistence import EventLog
from claudebox.workspace import Workspace


def _event(**overrides) -> PublishedEvent:
    """Minimal PublishedEvent, defaults to a human-authored text message."""

    defaults = {
        "type": "user",
        "subtype": "message",
        "content": None,
        "primary": True,
        "is_human": True,
        "raw": {},
        "id": "e1",
        "ts": datetime(2026, 3, 8, 12, 0, 0, tzinfo=UTC),
        "turn_id": "t1",
    }
    defaults.update(overrides)

    return PublishedEvent(**defaults)  # ty: ignore[invalid-argument-type]


class _FakeWriter:
    """Records what spawn() writes; mirrors an asyncio.StreamWriter's used surface."""

    def __init__(self) -> None:
        self.written = b""
        self.wrote_eof = False
        self.closed = False

    def write(self, data: bytes) -> None:
        self.written += data

    async def drain(self) -> None:
        return None

    def write_eof(self) -> None:
        self.wrote_eof = True

    def close(self) -> None:
        self.closed = True


class _FakeReader:
    """Mirrors an asyncio.StreamReader's used surface - one canned reply line."""

    def __init__(self, line: bytes) -> None:
        self._line = line

    async def readline(self) -> bytes:
        return self._line


def _patch_spawn_socket(monkeypatch, *, reply: dict | None, writer: _FakeWriter | None = None):
    """Patch _open_spawn_socket to return a fake (reader, writer) pair carrying `reply`.

    `reply=None` simulates the daemon closing the connection with no reply.
    """

    writer = writer or _FakeWriter()
    line = b"" if reply is None else (json.dumps(reply) + "\n").encode()

    async def fake_open(_socket_path: Path):
        return _FakeReader(line), writer

    monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", staticmethod(fake_open))

    return writer


def _patch_http(monkeypatch, handler):
    """Patch _build_http_client to route through an httpx.MockTransport handler."""

    def build() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=1.0)

    monkeypatch.setattr(SiblingSessionClient, "_build_http_client", staticmethod(build))


def _send_handler(sent: list[dict]):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/send":
            sent.append(
                {
                    "host": request.url.host,
                    "session_id": request.url.params.get("session_id"),
                    "prompt": json.loads(request.content)["prompt"],
                },
            )

            return httpx.Response(200, json={"ok": True})

        return httpx.Response(404)

    return handler


@pytest.fixture
def client(tmp_path) -> SiblingSessionClient:
    return SiblingSessionClient(session_id="parent-1", workspace_path=tmp_path)


class TestSpawn:
    @pytest.mark.anyio
    async def test_success_returns_ids_and_the_reply_note(self, client, monkeypatch):
        writer = _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1", "prompt_delivered": True},
        )

        result = await client.spawn("do the thing")

        assert result == {
            "session_id": "child-1",
            "container_id": "c1",
            "note": SIBLING_REPLY_NOTE,
        }

        sent = json.loads(writer.written.decode())
        assert sent == {
            "verb": "spawn",
            "caller_session_id": "parent-1",
            "prompt": "do the thing",
            "name": None,
            "model": None,
            "effort": None,
        }
        assert writer.wrote_eof
        assert writer.closed

    @pytest.mark.anyio
    async def test_settings_travel_with_the_request(self, client, monkeypatch):
        writer = _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1", "prompt_delivered": True},
        )

        await client.spawn("x", name="lint-fix", model="haiku", effort="low")

        sent = json.loads(writer.written.decode())
        assert (sent["name"], sent["model"], sent["effort"]) == ("lint-fix", "haiku", "low")

    @pytest.mark.anyio
    @pytest.mark.parametrize("reply_extra", [{"prompt_delivered": False}, {}])
    async def test_a_prompt_not_delivered_is_a_result_naming_the_session(
        self,
        client,
        monkeypatch,
        reply_extra,
    ):
        _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1", **reply_extra},
        )

        result = await client.spawn("x", name="lint-fix")

        assert result["prompt_delivered"] is False
        assert result["note"] == (
            "Session lint-fix was created, but your prompt did not reach it. Send it again with "
            "session_ask, or stop it with session_stop."
        )

    @pytest.mark.anyio
    async def test_a_lost_prompt_without_a_name_names_the_session_id(self, client, monkeypatch):
        _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1", "prompt_delivered": False},
        )

        result = await client.spawn("x")

        assert result["note"].startswith("Session child-1 was created")

    @pytest.mark.anyio
    async def test_settings_the_runtime_could_not_apply_are_named(self, client, monkeypatch):
        _patch_spawn_socket(
            monkeypatch,
            reply={
                "session_id": "child-1",
                "container_id": "c1",
                "prompt_delivered": True,
                "unapplied": ["model", "effort"],
            },
        )

        result = await client.spawn("x", model="haiku", effort="low")

        assert result["unapplied"] == ["model", "effort"]
        assert "cannot set the model and effort level" in result["note"]

    @pytest.mark.anyio
    async def test_socket_unreachable_raises(self, client, monkeypatch):
        async def fake_open(_socket_path):
            raise OSError("no such file or directory")

        monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", staticmethod(fake_open))

        with pytest.raises(SiblingSessionError, match="session_spawn: could not reach the daemon"):
            await client.spawn("x")

    @pytest.mark.anyio
    async def test_dial_that_never_connects_times_out_rather_than_hangs(self, client, monkeypatch):
        """A spawn listener that bound but never accepts must not hang the caller forever -
        the connect is bounded, and a timeout reports the same way a refused connection does."""

        async def fake_open(_socket_path):
            await asyncio.sleep(3600)

        monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", staticmethod(fake_open))
        monkeypatch.setattr(
            "claudebox.agent_session._sibling_sessions.SPAWN_SOCKET_CONNECT_TIMEOUT_SECONDS",
            0.05,
        )

        with pytest.raises(SiblingSessionError, match="could not reach the daemon"):
            await client.spawn("x")

    @pytest.mark.anyio
    async def test_empty_reply_raises(self, client, monkeypatch):
        _patch_spawn_socket(monkeypatch, reply=None)

        with pytest.raises(SiblingSessionError, match="closed the connection with no reply"):
            await client.spawn("x")

    @pytest.mark.anyio
    async def test_depth_exceeded_names_cap_and_depth(self, client, monkeypatch):
        _patch_spawn_socket(
            monkeypatch,
            reply={"error": "spawn_depth_exceeded", "cap": 3, "depth": 3},
        )

        with pytest.raises(SiblingSessionError, match=r"recursion cap \(3\) reached at depth 3"):
            await client.spawn("x")

    @pytest.mark.anyio
    async def test_other_error_reports_refusal_reason(self, client, monkeypatch):
        _patch_spawn_socket(monkeypatch, reply={"error": "workspace_locked"})

        with pytest.raises(SiblingSessionError, match=r"refused \(workspace_locked\)"):
            await client.spawn("x")


class TestFormatRefusal:
    @pytest.mark.parametrize(
        ("response", "expected"),
        [
            (
                {"error": "spawn_depth_exceeded", "cap": 5, "depth": 5},
                (
                    "session_spawn: recursion cap (5) reached at depth 5; refusing to spawn "
                    "another nested session."
                ),
            ),
            ({"error": "invalid_name"}, "session_spawn: name must be a single non-blank line"),
            (
                {"error": "invalid_model"},
                "session_spawn: model must be a non-blank name without spaces",
            ),
            (
                {"error": "invalid_effort"},
                "session_spawn: effort must be one of max, xhigh, high, medium, low",
            ),
            ({"error": "boom"}, "session_spawn: refused (boom)"),
        ],
    )
    def test_spawn_refusals(self, response, expected):
        request = {"verb": "spawn"}

        assert SiblingSessionClient._format_refusal("session_spawn", request, response) == expected

    def test_not_own_sibling_names_the_session(self):
        msg = SiblingSessionClient._format_refusal(
            "session_stop",
            {"verb": "stop", "session_id": "abc"},
            {"error": "not_own_sibling", "session_id": "abc"},
        )

        assert msg == "session_stop: 'abc' was not started by this session"

    def test_a_reply_thread_in_the_way_names_the_thread(self):
        msg = SiblingSessionClient._format_refusal(
            "session_stop",
            {"verb": "stop", "session_id": "abc"},
            {"error": "hosts_your_thread", "session_id": "thread-9"},
        )

        assert "reply thread 'thread-9'" in msg
        assert "nothing was stopped" in msg


async def _write_events(workspace: Path, session_id: str, *events: PublishedEvent) -> None:
    log = EventLog(session_id, Workspace(start_dir=workspace))

    try:
        await log.open()

        for event in events:
            await log.append(event)
    finally:
        await log.close()


class TestAsk:
    @pytest.mark.anyio
    async def test_returns_once_delivered_to_the_current_container(self, client, monkeypatch):
        writer = _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c-now", "resumed": False},
        )
        sent: list[dict] = []
        _patch_http(monkeypatch, _send_handler(sent))

        result = await client.ask("child-1", "hi")

        assert result == {
            "session_id": "child-1",
            "delivered": True,
            "resumed": False,
            "note": SIBLING_REPLY_NOTE,
        }
        assert json.loads(writer.written.decode()) == {
            "verb": "resume",
            "caller_session_id": "parent-1",
            "session_id": "child-1",
        }
        assert sent == [{"host": "c-now", "session_id": "child-1", "prompt": "hi"}]

    @pytest.mark.anyio
    async def test_a_resumed_sibling_is_reported_resumed(self, client, monkeypatch):
        _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c2", "resumed": True},
        )
        _patch_http(monkeypatch, _send_handler([]))

        result = await client.ask("child-1", "hi")

        assert result["resumed"] is True

    @pytest.mark.anyio
    async def test_a_session_not_started_by_this_one_is_refused_before_any_send(
        self,
        client,
        monkeypatch,
    ):
        _patch_spawn_socket(
            monkeypatch,
            reply={"error": "not_own_sibling", "session_id": "stranger"},
        )
        sent: list[dict] = []
        _patch_http(monkeypatch, _send_handler(sent))

        with pytest.raises(SiblingSessionError, match="'stranger' was not started by this session"):
            await client.ask("stranger", "hi")

        assert sent == []

    @pytest.mark.anyio
    @pytest.mark.parametrize("question_tool", ["AskUserQuestion", "ask_user_question"])
    async def test_a_sibling_waiting_on_a_question_form_gets_the_answer_envelope(
        self,
        tmp_workspace,
        monkeypatch,
        question_tool,
    ):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        await _write_events(
            tmp_workspace,
            "child-1",
            _event(id="e1", content="start"),
            _event(
                id="e2",
                type="assistant",
                subtype="tool_use",
                is_human=False,
                tool_name=question_tool,
            ),
            _event(id="e3", type="result", subtype="success", is_human=False),
        )
        _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1", "resumed": False},
        )
        sent: list[dict] = []
        _patch_http(monkeypatch, _send_handler(sent))
        client = SiblingSessionClient(session_id="parent-1", workspace_path=tmp_workspace)

        await client.ask("child-1", "option a")

        assert sent[0]["prompt"] == "<response:AskUserQuestion>option a</response:AskUserQuestion>"

    @pytest.mark.anyio
    async def test_an_answered_question_form_is_not_wrapped_again(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        await _write_events(
            tmp_workspace,
            "child-1",
            _event(
                id="e1",
                type="assistant",
                subtype="tool_use",
                is_human=False,
                tool_name="AskUserQuestion",
            ),
            _event(id="e2", content="<response:AskUserQuestion>a</response:AskUserQuestion>"),
        )
        _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1", "resumed": False},
        )
        sent: list[dict] = []
        _patch_http(monkeypatch, _send_handler(sent))
        client = SiblingSessionClient(session_id="parent-1", workspace_path=tmp_workspace)

        await client.ask("child-1", "carry on")

        assert sent[0]["prompt"] == "carry on"

    @pytest.mark.anyio
    async def test_unreachable_sibling_raises_sibling_error(self, client, monkeypatch):
        _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1", "resumed": False},
        )

        def handler(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        _patch_http(monkeypatch, handler)

        with pytest.raises(SiblingSessionError, match="unreachable"):
            await client.ask("child-1", "hi")


class TestStopAndList:
    @pytest.mark.anyio
    async def test_stop_sends_the_stop_verb_and_reports_the_state(self, client, monkeypatch):
        writer = _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "state": "stopped"},
        )

        result = await client.stop("child-1")

        assert result == {"session_id": "child-1", "state": "stopped"}
        assert json.loads(writer.written.decode()) == {
            "verb": "stop",
            "caller_session_id": "parent-1",
            "session_id": "child-1",
        }

    @pytest.mark.anyio
    async def test_list_returns_the_daemon_listing(self, client, monkeypatch):
        sessions = [
            {"session_id": "child-1", "name": "lint-fix", "state": "idle"},
            {"session_id": "child-2", "name": None, "state": "stopped"},
        ]
        writer = _patch_spawn_socket(monkeypatch, reply={"sessions": sessions})

        assert await client.list_siblings() == sessions
        assert json.loads(writer.written.decode()) == {
            "verb": "list",
            "caller_session_id": "parent-1",
        }

    @pytest.mark.anyio
    async def test_stop_refusal_carries_the_tool_name(self, client, monkeypatch):
        _patch_spawn_socket(monkeypatch, reply={"error": "listing_timeout"})

        with pytest.raises(
            SiblingSessionError,
            match=r"^session_stop: refused \(listing_timeout\)",
        ):
            await client.stop("child-1")


class TestTurnsFromEvents:
    def test_human_message_becomes_user_turn(self):
        events = [_event(is_human=True, type="user", subtype="message", content="hi there")]

        assert SiblingSessionClient._turns_from_events(events, 50) == [
            {"role": "user", "content": "hi there"},
        ]

    def test_assistant_text_becomes_assistant_turn(self):
        events = [
            _event(is_human=False, type="assistant", subtype="text", content="hello back"),
        ]

        assert SiblingSessionClient._turns_from_events(events, 50) == [
            {"role": "assistant", "content": "hello back"},
        ]

    def test_consecutive_assistant_text_events_merge(self):
        events = [
            _event(is_human=False, type="assistant", subtype="text", content="Part A. "),
            _event(is_human=False, type="assistant", subtype="text", content="Part B."),
        ]

        assert SiblingSessionClient._turns_from_events(events, 50) == [
            {"role": "assistant", "content": "Part A. Part B."},
        ]

    def test_human_message_after_assistant_starts_a_new_turn(self):
        events = [
            _event(is_human=False, type="assistant", subtype="text", content="answer"),
            _event(is_human=True, type="user", subtype="message", content="follow-up"),
        ]

        assert SiblingSessionClient._turns_from_events(events, 50) == [
            {"role": "assistant", "content": "answer"},
            {"role": "user", "content": "follow-up"},
        ]

    def test_non_text_events_are_ignored(self):
        events = [
            _event(
                is_human=False,
                type="assistant",
                subtype="tool_use",
                content=None,
                raw={"tool_name": "Bash"},
            ),
            _event(is_human=False, type="assistant", subtype="text", content="done"),
        ]

        assert SiblingSessionClient._turns_from_events(events, 50) == [
            {"role": "assistant", "content": "done"},
        ]

    def test_limit_keeps_only_the_most_recent_turns(self):
        events = [
            _event(is_human=True, type="user", subtype="message", content="one"),
            _event(is_human=False, type="assistant", subtype="text", content="two"),
            _event(is_human=True, type="user", subtype="message", content="three"),
        ]

        assert SiblingSessionClient._turns_from_events(events, 1) == [
            {"role": "user", "content": "three"},
        ]

    def test_a_limit_past_the_transcript_returns_every_turn(self):
        events = [
            _event(is_human=True, type="user", subtype="message", content="one"),
            _event(is_human=False, type="assistant", subtype="text", content="two"),
        ]

        assert len(SiblingSessionClient._turns_from_events(events, 10_000)) == 2


class TestRead:
    @pytest.mark.anyio
    @pytest.mark.parametrize("limit", [0, -1])
    async def test_a_limit_below_one_is_refused(self, client, limit):
        with pytest.raises(SiblingSessionError, match="session_read: limit must be at least 1"):
            await client.read("child-1", limit)

    @pytest.mark.anyio
    async def test_unknown_session_raises(self, client, monkeypatch):
        monkeypatch.setattr(
            "claudebox.agent_session._sibling_sessions.find_session_dir",
            lambda *_args, **_kwargs: None,
        )

        with pytest.raises(SiblingSessionError, match="no session found"):
            await client.read("ghost-session")

    @pytest.mark.anyio
    async def test_reads_persisted_turns_from_disk(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        log = EventLog("child-1", ws)

        try:
            await log.open()
            await log.append(
                _event(id="e1", is_human=True, type="user", subtype="message", content="hi"),
            )
            await log.append(
                _event(
                    id="e2",
                    is_human=False,
                    type="assistant",
                    subtype="text",
                    content="hello",
                    turn_id="t1",
                ),
            )
        finally:
            await log.close()

        sibling_client = SiblingSessionClient(session_id="parent-1", workspace_path=tmp_workspace)

        turns = await sibling_client.read("child-1")

        assert turns == [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]

    @pytest.mark.anyio
    async def test_no_network_call_involved(self, tmp_workspace, monkeypatch):
        """Reading works with no HTTP client ever built - proves it is a pure file read."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        log = EventLog("child-1", ws)

        try:
            await log.open()
            await log.append(
                _event(id="e1", is_human=True, type="user", subtype="message", content="hi"),
            )
        finally:
            await log.close()

        def _unexpected_client() -> httpx.AsyncClient:
            raise AssertionError("read() must not open an HTTP client")

        monkeypatch.setattr(
            SiblingSessionClient,
            "_build_http_client",
            staticmethod(_unexpected_client),
        )

        sibling_client = SiblingSessionClient(session_id="parent-1", workspace_path=tmp_workspace)
        turns = await sibling_client.read("child-1")

        assert turns == [{"role": "user", "content": "hi"}]


class _ScriptedSocket:
    """Answer each successive dial with the next scripted reply - a dict, None, or an OSError."""

    def __init__(self, replies: list) -> None:
        self._replies = list(replies)
        self.requests: list[dict] = []

    async def open(self, _socket_path: Path):
        reply = self._replies.pop(0)

        if isinstance(reply, OSError):
            raise reply

        writer = _FakeWriter()
        line = b"" if reply is None else (json.dumps(reply) + "\n").encode()
        self._writers = getattr(self, "_writers", []) + [writer]

        return _FakeReader(line), writer

    def sent(self) -> list[dict]:
        return [json.loads(writer.written) for writer in self._writers]


class TestReportSiblingTurnEnd:
    @staticmethod
    def _turn():
        from claudebox.agent_session.orchestration.sibling_turns import SiblingTurnEnd

        return SiblingTurnEnd(turn_id="T1", delivery_id="d1", outcome="ended", text="Done.")

    @staticmethod
    def _script(monkeypatch, replies) -> _ScriptedSocket:
        socket = _ScriptedSocket(replies)
        monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", staticmethod(socket.open))
        monkeypatch.setattr(
            "claudebox.agent_session._sibling_sessions._TURN_END_RETRY_DELAYS",
            (0.0, 0.0),
        )

        return socket

    @pytest.mark.anyio
    async def test_sends_the_turn_end_verb_once_when_it_is_taken(self, monkeypatch):
        socket = self._script(monkeypatch, [{"delivered": True}])

        await report_sibling_turn_end("sib-1", self._turn())

        assert socket.sent() == [
            {
                "verb": "turn_ended",
                "caller_session_id": "sib-1",
                "delivery_id": "d1",
                "outcome": "ended",
                "text": "Done.",
            },
        ]

    @pytest.mark.anyio
    async def test_an_unreachable_parent_is_retried_until_taken(self, monkeypatch):
        socket = self._script(
            monkeypatch,
            [{"error": "parent_unreachable"}, OSError("refused"), {"held": True}],
        )

        await report_sibling_turn_end("sib-1", self._turn())

        assert len(socket.sent()) == 2

    @pytest.mark.anyio
    async def test_it_gives_up_after_the_last_retry_and_logs(self, monkeypatch):
        self._script(monkeypatch, [None, None, None])

        with patch("claudebox.agent_session._sibling_sessions._logger") as logger:
            await report_sibling_turn_end("sib-1", self._turn())

        assert (
            logger.error.call_args.args[0]
            == "Sibling turn end dropped - its parent stayed unreachable"
        )

    @pytest.mark.anyio
    async def test_a_refusal_other_than_unreachable_is_logged_and_not_retried(self, monkeypatch):
        socket = self._script(monkeypatch, [{"error": "not_spawned"}, {"delivered": True}])

        with patch("claudebox.agent_session._sibling_sessions._logger") as logger:
            await report_sibling_turn_end("sib-1", self._turn())

        assert len(socket.sent()) == 1
        assert logger.error.call_args.kwargs["error"] == "not_spawned"
