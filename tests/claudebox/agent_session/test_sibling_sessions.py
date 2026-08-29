"""SiblingSessionClient tests - spawn/ask/read against a fake daemon socket and sibling endpoint."""

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from claudebox.agent_session._sibling_sessions import SiblingSessionClient, SiblingSessionError
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


def _sse_body(*events: dict) -> bytes:
    """Raw SSE body in BroadcastEventSourceResponse's wire format: one `data: <json>` line per
    event, blank line between frames."""

    return "".join(f"data: {json.dumps(event)}\n\n" for event in events).encode()


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


def _stream_and_send_handler(sse_events: list[dict], sent: list[str]):
    """Route GET /api/stream to a fixed SSE body; capture POST /api/send prompts into `sent`."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/stream":
            return httpx.Response(200, content=_sse_body(*sse_events))
        elif request.url.path == "/api/send":
            sent.append(json.loads(request.content)["prompt"])

            return httpx.Response(200, json={"ok": True})
        else:
            return httpx.Response(404)

    return handler


@pytest.fixture
def client(tmp_path) -> SiblingSessionClient:
    return SiblingSessionClient(session_id="parent-1", workspace_path=tmp_path)


def _known(client: SiblingSessionClient, session_id: str, container_id: str = "c1") -> None:
    """Seed a sibling as already-spawned, the state ask()/read() require."""

    client._containers[session_id] = container_id


class TestSpawn:
    @pytest.mark.anyio
    async def test_success_returns_and_remembers_container(self, client, monkeypatch):
        writer = _patch_spawn_socket(
            monkeypatch,
            reply={"session_id": "child-1", "container_id": "c1"},
        )

        result = await client.spawn("do the thing")

        assert result == {"session_id": "child-1", "container_id": "c1"}
        assert client._containers["child-1"] == "c1"

        sent = json.loads(writer.written.decode())
        assert sent == {"verb": "spawn", "caller_session_id": "parent-1", "prompt": "do the thing"}
        assert writer.wrote_eof
        assert writer.closed

    @pytest.mark.anyio
    async def test_socket_unreachable_raises(self, client, monkeypatch):
        async def fake_open(_socket_path):
            raise OSError("no such file or directory")

        monkeypatch.setattr(SiblingSessionClient, "_open_spawn_socket", staticmethod(fake_open))

        with pytest.raises(SiblingSessionError, match="could not reach the daemon"):
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


class TestFormatSpawnError:
    def test_depth_exceeded_message(self):
        msg = SiblingSessionClient._format_spawn_error(
            {"error": "spawn_depth_exceeded", "cap": 5, "depth": 5},
        )

        assert msg == (
            "session_spawn: recursion cap (5) reached at depth 5; refusing to spawn "
            "another nested session."
        )

    def test_other_error_message(self):
        msg = SiblingSessionClient._format_spawn_error({"error": "boom"})

        assert msg == "session_spawn: refused (boom)"


class TestAsk:
    @pytest.mark.anyio
    async def test_unknown_sibling_raises_without_a_network_call(self, client):
        with pytest.raises(SiblingSessionError, match="unknown sibling"):
            await client.ask("never-spawned", "hi")

    @pytest.mark.anyio
    async def test_replies_with_final_text(self, client, monkeypatch):
        _known(client, "child-1")
        sent: list[str] = []
        _patch_http(
            monkeypatch,
            _stream_and_send_handler(
                [
                    {"type": "assistant", "subtype": "text", "content": "Hello there"},
                    {"type": "result", "subtype": "success"},
                ],
                sent,
            ),
        )

        result = await client.ask("child-1", "hi")

        assert result == {"state": "replied", "text": "Hello there"}
        assert sent == ["hi"]

    @pytest.mark.anyio
    async def test_multiple_text_fragments_accumulate_in_order(self, client, monkeypatch):
        _known(client, "child-1")
        _patch_http(
            monkeypatch,
            _stream_and_send_handler(
                [
                    {"type": "assistant", "subtype": "text", "content": "Part A. "},
                    {"type": "assistant", "subtype": "text", "content": "Part B."},
                    {"type": "result"},
                ],
                [],
            ),
        )

        result = await client.ask("child-1", "hi")

        assert result == {"state": "replied", "text": "Part A. Part B."}

    @pytest.mark.anyio
    async def test_claude_ask_user_question_reports_asking(self, client, monkeypatch):
        _known(client, "child-1")
        questions = [{"question": "Pick one", "options": ["a", "b"]}]
        _patch_http(
            monkeypatch,
            _stream_and_send_handler(
                [
                    {
                        "type": "assistant",
                        "subtype": "tool_use",
                        "tool_name": "AskUserQuestion",
                        "tool_input": {"questions": questions},
                    },
                ],
                [],
            ),
        )

        result = await client.ask("child-1", "hi")

        assert result == {"state": "asking", "text": json.dumps(questions)}
        assert "child-1" in client._asking

    @pytest.mark.anyio
    async def test_langgraph_ask_user_question_tool_name_recognized(self, client, monkeypatch):
        _known(client, "child-1")
        _patch_http(
            monkeypatch,
            _stream_and_send_handler(
                [
                    {
                        "type": "assistant",
                        "subtype": "tool_use",
                        "tool_name": "ask_user_question",
                        "tool_input": {"questions": [{"question": "Continue?"}]},
                    },
                ],
                [],
            ),
        )

        result = await client.ask("child-1", "hi")

        assert result["state"] == "asking"

    @pytest.mark.anyio
    async def test_second_call_after_asking_wraps_the_answer_envelope(self, client, monkeypatch):
        _known(client, "child-1")
        sent: list[str] = []
        _patch_http(
            monkeypatch,
            _stream_and_send_handler(
                [
                    {
                        "type": "assistant",
                        "subtype": "tool_use",
                        "tool_name": "AskUserQuestion",
                        "tool_input": {"questions": [{"question": "Pick one"}]},
                    },
                ],
                sent,
            ),
        )
        await client.ask("child-1", "asking now")

        _patch_http(
            monkeypatch,
            _stream_and_send_handler([{"type": "result"}], sent),
        )
        await client.ask("child-1", "option a")

        assert sent[-1] == "<response:AskUserQuestion>option a</response:AskUserQuestion>"

    @pytest.mark.anyio
    async def test_reply_after_asking_clears_the_flag(self, client, monkeypatch):
        client._asking.add("child-1")
        _known(client, "child-1")
        _patch_http(
            monkeypatch,
            _stream_and_send_handler([{"type": "result"}], []),
        )

        await client.ask("child-1", "resumed")

        assert "child-1" not in client._asking

    @pytest.mark.anyio
    async def test_stream_ending_with_no_terminal_event_raises(self, client, monkeypatch):
        _known(client, "child-1")
        _patch_http(
            monkeypatch,
            _stream_and_send_handler(
                [{"type": "assistant", "subtype": "text", "content": "still thinking"}],
                [],
            ),
        )

        with pytest.raises(SiblingSessionError, match="ended with no result"):
            await client.ask("child-1", "hi")

    @pytest.mark.anyio
    async def test_malformed_frame_is_skipped_not_fatal(self, client, monkeypatch):
        _known(client, "child-1")

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/stream":
                body = b"data: not-json-at-all\n\n" + _sse_body({"type": "result"})

                return httpx.Response(200, content=body)

            return httpx.Response(200, json={"ok": True})

        _patch_http(monkeypatch, handler)

        result = await client.ask("child-1", "hi")

        assert result == {"state": "replied", "text": ""}

    @pytest.mark.anyio
    async def test_unreachable_sibling_raises_sibling_error(self, client, monkeypatch):
        _known(client, "child-1")

        def handler(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused")

        _patch_http(monkeypatch, handler)

        with pytest.raises(SiblingSessionError, match="unreachable"):
            await client.ask("child-1", "hi")


class TestParseSseData:
    def test_empty_lines_returns_none(self):
        assert SiblingSessionClient._parse_sse_data([]) is None

    def test_malformed_json_returns_none(self):
        assert SiblingSessionClient._parse_sse_data(["not json"]) is None

    def test_valid_json_parsed(self):
        assert SiblingSessionClient._parse_sse_data(['{"a": 1}']) == {"a": 1}


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

    def test_limit_zero_returns_every_turn(self):
        events = [
            _event(is_human=True, type="user", subtype="message", content="one"),
            _event(is_human=False, type="assistant", subtype="text", content="two"),
        ]

        assert len(SiblingSessionClient._turns_from_events(events, 0)) == 2


class TestRead:
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
