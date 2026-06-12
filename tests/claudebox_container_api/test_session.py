"""Tests for the container API session lifespan - log-routing callback wiring."""

import pytest

from claudebox_container_api import session as session_module


class _FakeSession:
    """Capture the kwargs managed() passes to SessionService (no real session started)."""

    last_kwargs: dict = {}

    def __init__(self, **kwargs):
        type(self).last_kwargs = kwargs

    async def stop(self) -> None:
        pass


@pytest.mark.anyio
async def test_managed_wires_renamed_log_callbacks(monkeypatch, tmp_path):
    """managed() passes on_start/on_stop (not the old on_session_*); server args are not forwarded."""

    monkeypatch.setattr(session_module, "SessionService", _FakeSession)
    monkeypatch.setattr(session_module, "current", None)

    handler = session_module.managed(workspace=str(tmp_path), port=8080)

    async with handler(app=None):
        kwargs = _FakeSession.last_kwargs

        assert kwargs["on_start"] is not None
        assert kwargs["on_stop"] is not None
        assert "on_session_start" not in kwargs
        assert "on_session_stop" not in kwargs
        assert "port" not in kwargs
