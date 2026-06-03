"""Capability transport — Session.get_capabilities, REST endpoint, session-info envelope, SSE init enrichment."""

import dataclasses
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.agent_session.catalogs import EffortLevel, Model, PermissionMode, Skill
from claudebox.agent_session.config import RuntimeCapabilities
from claudebox.agent_session.orchestration.errors import SessionNotReady
from claudebox.agent_session.orchestration.models import (
    EventSubtype,
    EventType,
    PublishedEvent,
    SessionSummary,
)
from claudebox.agent_session.orchestration.pipeline import EventPipeline
from claudebox.agent_session.orchestration.session import SessionService
from claudebox.agent_session.runtime_claude import ClaudeRuntime
from claudebox.core.http import JSONResponse
from claudebox_container_api.handlers.sessions import router
from claudebox_container_api.session import get_session


# --- Helpers ---


def _runtime_double(*, capabilities: RuntimeCapabilities | None = None):
    """Mock AgentSession with the capability surface and catalog accessors needed by the transport."""

    runtime = MagicMock()
    runtime.runtime_name = "Claude"
    runtime.capabilities = capabilities or ClaudeRuntime.CAPABILITIES
    runtime.get_models.return_value = [
        Model(id="m-1", name="Model 1", context_window=200_000),
    ]
    runtime.get_effort_levels.return_value = [EffortLevel(id="medium", name="Medium")]
    runtime.get_permission_modes.return_value = [
        PermissionMode(id="default", name="Default", description="standard"),
    ]
    runtime.get_skills.return_value = [Skill(name="example-skill")]
    return runtime


def _session_with_runtime(tmp_workspace, runtime) -> SessionService:
    """Construct a Session and attach a fake AgentSession runtime."""

    session = SessionService(workspace=tmp_workspace)
    session._sdk_client = runtime
    return session


def _build_client(session: SessionService) -> TestClient:
    """TestClient on a mini app using the production JSONResponse."""

    app = FastAPI(default_response_class=JSONResponse)
    app.include_router(router)
    app.dependency_overrides[get_session] = lambda: session
    return TestClient(app)


# --- Session.get_capabilities + Session.runtime_name ---


class TestSessionAccessors:
    """get_capabilities + runtime_name raise SessionNotReady before connect; delegate when ready."""

    def test_get_capabilities_raises_when_not_started(self, tmp_workspace):
        session = SessionService(workspace=tmp_workspace)

        with pytest.raises(SessionNotReady):
            session.get_capabilities()

    def test_runtime_name_raises_when_not_started(self, tmp_workspace):
        session = SessionService(workspace=tmp_workspace)

        with pytest.raises(SessionNotReady):
            _ = session.runtime_name

    def test_get_capabilities_delegates_to_runtime(self, tmp_workspace):
        runtime = _runtime_double()
        session = _session_with_runtime(tmp_workspace, runtime)

        assert session.get_capabilities() is runtime.capabilities

    def test_runtime_name_delegates_to_runtime(self, tmp_workspace):
        runtime = _runtime_double()
        session = _session_with_runtime(tmp_workspace, runtime)

        assert session.runtime_name == "Claude"


# --- GET /api/sessions/current/capabilities ---


class TestCapabilitiesEndpoint:
    """The combined capabilities endpoint exposes the 15-flag matrix + runtime_name + per-flag catalogs."""

    def test_returns_fifteen_flag_matrix(self, tmp_workspace):
        runtime = _runtime_double()
        session = _session_with_runtime(tmp_workspace, runtime)
        client = _build_client(session)

        body = client.get("/api/sessions/current/capabilities").json()

        assert len(body["capabilities"]) == 15
        assert all(isinstance(v, bool) for v in body["capabilities"].values())
        assert body["runtime_name"] == "Claude"

    def test_catalogs_populated_when_flags_true(self, tmp_workspace):
        runtime = _runtime_double()
        session = _session_with_runtime(tmp_workspace, runtime)
        client = _build_client(session)

        body = client.get("/api/sessions/current/capabilities").json()

        assert [m["id"] for m in body["models"]] == ["m-1"]
        assert [e["id"] for e in body["effort_levels"]] == ["medium"]
        assert [p["id"] for p in body["permission_modes"]] == ["default"]
        assert [s["name"] for s in body["skills"]] == ["example-skill"]

    def test_catalogs_null_when_flags_false(self, tmp_workspace):
        caps = dataclasses.replace(
            ClaudeRuntime.CAPABILITIES,
            supports_models=False,
            supports_effort_levels=False,
            supports_permission_modes=False,
            supports_skills=False,
        )
        runtime = _runtime_double(capabilities=caps)
        session = _session_with_runtime(tmp_workspace, runtime)
        client = _build_client(session)

        body = client.get("/api/sessions/current/capabilities").json()

        assert body["models"] is None
        assert body["effort_levels"] is None
        assert body["permission_modes"] is None
        assert body["skills"] is None


# --- GET /api/sessions/current — envelope additions ---


class TestSessionInfoEnvelope:
    """The session-info envelope gains capabilities + runtime_name sibling fields."""

    def test_envelope_includes_capabilities_and_runtime_name(self, tmp_workspace, monkeypatch):
        runtime = _runtime_double()
        session = _session_with_runtime(tmp_workspace, runtime)

        summary = SessionSummary(
            session_id="sess-abc",
            model="claude-opus-4-7",
            permission_mode="default",
            num_turns=0,
            total_cost_usd=0.0,
        )
        monkeypatch.setattr(session, "get", lambda *_a, **_k: summary)

        body = _build_client(session).get("/api/sessions/current").json()

        assert body["session_id"] == "sess-abc"
        assert body["runtime_name"] == "Claude"
        assert len(body["capabilities"]) == 15
        assert body["capabilities"]["supports_models"] is True

    def test_envelope_empty_when_no_session(self, tmp_workspace, monkeypatch):
        runtime = _runtime_double()
        session = _session_with_runtime(tmp_workspace, runtime)
        monkeypatch.setattr(session, "get", lambda *_a, **_k: None)

        body = _build_client(session).get("/api/sessions/current").json()

        assert body == {}


# --- SSE init event enrichment ---


class TestSystemInitEnrichment:
    """system/init PublishedEvents carry capabilities + runtime_name for race-free initial render."""

    def test_init_event_gains_capabilities_and_runtime_name(self):
        runtime = _runtime_double()
        pipeline = EventPipeline.__new__(EventPipeline)
        pipeline._sdk_client = runtime

        event = PublishedEvent(
            type=EventType.SYSTEM,
            subtype=EventSubtype.INIT,
            content=None,
            primary=False,
            is_human=False,
            raw={},
            id="evt_000000001",
            ts=None,  # ty: ignore[invalid-argument-type]
            turn_id=None,
        )

        pipeline._enrich_init_capabilities(event)

        assert event.runtime_name == "Claude"
        assert event.capabilities is not None
        assert event.capabilities["supports_models"] is True
        assert len(event.capabilities) == 15

    def test_non_init_event_unchanged(self):
        runtime = _runtime_double()
        pipeline = EventPipeline.__new__(EventPipeline)
        pipeline._sdk_client = runtime

        event = PublishedEvent(
            type=EventType.ASSISTANT,
            subtype=EventSubtype.TEXT,
            content="hello",
            primary=True,
            is_human=False,
            raw={},
            id="evt_000000002",
            ts=None,  # ty: ignore[invalid-argument-type]
            turn_id="turn-1",
        )

        pipeline._enrich_init_capabilities(event)

        assert event.capabilities is None
        assert event.runtime_name is None
