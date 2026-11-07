"""Tests for agent_session._ports - the port tools' replies, close request and the answer text."""

from __future__ import annotations

import pytest

from claudebox.agent_session import _ports
from claudebox.agent_session._sibling_sessions import SiblingSessionClient, SiblingSessionError
from claudebox.core.io import write_json


@pytest.mark.parametrize(
    ("record", "port", "starts"),
    [
        ({}, 8080, "Asked the user to open port 8080"),
        ({"spawned_from_session_id": "p"}, 8080, "Not asked: a session another session started"),
        ({"is_side_thread": True}, 8080, "Not asked: a reply thread"),
        ({}, 0, "Not asked: the port must be from 1 to 65535"),
        ({}, 65536, "Not asked: the port must be from 1 to 65535"),
    ],
)
def test_port_open_reply(tmp_path, record, port, starts):
    write_json(tmp_path / "session.json", record)

    assert _ports.port_open_reply(tmp_path, port).startswith(starts)


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        (
            "http://127.0.0.1:18080",
            (
                '<response:port_open port="8080">Approved: port 8080 is reachable at '
                "http://127.0.0.1:18080.</response:port_open>"
            ),
        ),
        (
            None,
            '<response:port_open port="8080">Rejected: port 8080 stays closed.</response:port_open>',
        ),
    ],
)
def test_port_answer(address, expected):
    assert _ports.port_answer(8080, address) == expected


@pytest.mark.anyio
async def test_close_port_sends_the_close_verb(monkeypatch):
    sent = []

    async def request(tool, body):
        sent.append((tool, body))

        return {"port": 8080, "state": "closed"}

    monkeypatch.setattr(SiblingSessionClient, "daemon_request", staticmethod(request))

    assert await _ports.close_port("s-1", 8080) == {"port": 8080, "state": "closed"}
    assert sent == [
        ("port_close", {"verb": "port_close", "caller_session_id": "s-1", "port": 8080}),
    ]


@pytest.mark.anyio
async def test_close_port_names_a_port_never_opened(monkeypatch):
    async def refuse(tool, body):
        raise SiblingSessionError(
            SiblingSessionClient._format_refusal(tool, body, {"error": "port_not_open"}),
        )

    monkeypatch.setattr(SiblingSessionClient, "daemon_request", staticmethod(refuse))

    with pytest.raises(SiblingSessionError, match="port_close: port 8080 is not open"):
        await _ports.close_port("s-1", 8080)
