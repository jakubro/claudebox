"""Tests for the container API chat handlers - stream readiness gating."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from claudebox import SessionNotReady
from claudebox_container_api.handlers.chat import chat_stream


@pytest.mark.anyio
async def test_stream_rejects_before_the_session_is_ready():
    """The route rejects up front so the caller gets a typed error; deferring to subscribe()
    would put the failure inside the response body after headers are already on the wire.
    """

    svc = MagicMock()
    svc.ensure_ready.side_effect = SessionNotReady()

    with pytest.raises(SessionNotReady):
        await chat_stream(svc)


@pytest.mark.anyio
async def test_stream_opens_once_the_session_is_ready():
    """A ready session still gets its SSE response."""

    svc = MagicMock()
    svc.ensure_ready.return_value = None

    response = await chat_stream(svc)

    assert response is not None
    svc.ensure_ready.assert_called_once()


@pytest.mark.anyio
async def test_stream_replay_true_by_default_subscribes_with_no_kwargs(monkeypatch):
    svc = MagicMock()
    svc.ensure_ready.return_value = None
    captured = {}

    def fake_response(broadcaster, subscribe_kwargs=None, **kwargs):
        captured["subscribe_kwargs"] = subscribe_kwargs

        return MagicMock()

    monkeypatch.setattr(
        "claudebox_container_api.handlers.chat.BroadcastEventSourceResponse",
        fake_response,
    )

    await chat_stream(svc)

    assert captured["subscribe_kwargs"] is None


@pytest.mark.anyio
async def test_stream_replay_false_forwards_to_subscribe_kwargs(monkeypatch):
    """A float re-attaching to a running side thread passes replay=false - it already read
    the persisted log via the events route and wants only what arrives from here on."""

    svc = MagicMock()
    svc.ensure_ready.return_value = None
    captured = {}

    def fake_response(broadcaster, subscribe_kwargs=None, **kwargs):
        captured["subscribe_kwargs"] = subscribe_kwargs

        return MagicMock()

    monkeypatch.setattr(
        "claudebox_container_api.handlers.chat.BroadcastEventSourceResponse",
        fake_response,
    )

    await chat_stream(svc, replay=False)

    assert captured["subscribe_kwargs"] == {"replay": False}


@pytest.mark.anyio
async def test_a_sibling_message_reaches_the_session_as_one_message():
    from unittest.mock import AsyncMock

    from claudebox import SiblingMessage
    from claudebox_container_api.handlers._models import SiblingMessageRequest
    from claudebox_container_api.handlers.chat import sibling_message

    svc = MagicMock(deliver_sibling_message=AsyncMock())
    body = SiblingMessageRequest(
        from_session_id="sib-1",
        from_name=None,
        delivery_id="d1",
        outcome="asking",
        text="Which branch?",
    )

    await sibling_message(svc, body)

    svc.deliver_sibling_message.assert_awaited_once_with(
        SiblingMessage("sib-1", None, "asking", "d1", "Which branch?"),
    )


def test_a_sibling_message_with_an_unknown_outcome_is_refused():
    from pydantic import ValidationError

    from claudebox_container_api.handlers._models import SiblingMessageRequest

    with pytest.raises(ValidationError):
        SiblingMessageRequest.model_validate(
            {"from_session_id": "s", "delivery_id": "d", "outcome": "maybe", "text": ""},
        )
