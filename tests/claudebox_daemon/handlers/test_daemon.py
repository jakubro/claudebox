"""Tests for claudebox_daemon.handlers.daemon - HTTP adapter responses."""

from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox_daemon.domain import get_daemon
from claudebox_daemon.handlers.daemon import router


def _build_app():
    """Build a minimal FastAPI app with the daemon router and a service stub."""

    app = FastAPI()
    app.include_router(router)

    svc = MagicMock()
    app.dependency_overrides[get_daemon] = lambda: svc

    return app, svc


def test_health_returns_the_services_aggregated_report():
    """Handler stays thin: the verdict is assembled in the domain, not here."""

    app, svc = _build_app()
    client = TestClient(app)
    svc.health.return_value = {
        "mode": "daemon",
        "status": "ok",
        "degraded": [],
        "signals": {"event_loop": "ok", "serving": "ok"},
    }

    response = client.get("/api/daemon/health")

    assert response.status_code == 200
    assert response.json() == svc.health.return_value


def test_health_keeps_the_top_level_status_the_watchdog_script_greps_for():
    """`claudebox_watchdog.sh` matches on `"status": "..."` - the body may grow, that key may not."""

    app, svc = _build_app()
    client = TestClient(app)
    svc.health.return_value = {
        "mode": "daemon",
        "status": "degraded",
        "degraded": ["serving"],
        "signals": {"event_loop": "ok", "serving": "degraded"},
    }

    response = client.get("/api/daemon/health")

    assert response.json()["status"] == "degraded"


def test_report_forwards_body_fields_to_the_service():
    """Handler stays thin: validated fields pass straight through to DaemonService."""

    app, svc = _build_app()
    client = TestClient(app)

    response = client.post(
        "/api/daemon/report",
        json={
            "kind": "render-failure",
            "message": "boom",
            "stack_trace": "at Component",
            "app_version": "1.2.3",
            "client_timestamp": "2026-08-09T00:00:00Z",
        },
    )

    assert response.status_code == 200
    svc.report_frontend_error.assert_called_once_with(
        kind="render-failure",
        message="boom",
        stack_trace="at Component",
        app_version="1.2.3",
        client_timestamp="2026-08-09T00:00:00Z",
    )


def test_report_accepts_optional_fields_omitted():
    """stack_trace and app_version are optional - a minimal report is still valid."""

    app, svc = _build_app()
    client = TestClient(app)

    response = client.post(
        "/api/daemon/report",
        json={
            "kind": "persistence-failure",
            "message": "quota exceeded",
            "client_timestamp": "2026-08-09T00:00:00Z",
        },
    )

    assert response.status_code == 200
    svc.report_frontend_error.assert_called_once_with(
        kind="persistence-failure",
        message="quota exceeded",
        stack_trace=None,
        app_version=None,
        client_timestamp="2026-08-09T00:00:00Z",
    )


def test_report_rejects_malformed_payload_without_a_traceback():
    """A missing required field is a clean 422, never an unhandled exception."""

    app, svc = _build_app()
    client = TestClient(app)

    response = client.post("/api/daemon/report", json={"kind": "render-failure"})

    assert response.status_code == 422
    svc.report_frontend_error.assert_not_called()
