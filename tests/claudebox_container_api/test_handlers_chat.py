"""Tests for the container API chat handlers - stream readiness gating."""

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
