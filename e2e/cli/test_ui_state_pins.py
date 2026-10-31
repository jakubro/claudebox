"""End-to-end UI-state writes through the real route and UIStateService, onto disk."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from claudebox.constants import SESSION_MAX_AGE
from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.ui_state.service import UIStateService
from claudebox_daemon.domain.workspaces.models import RegisteredWorkspace
from claudebox_daemon.handlers.ui_state import router as ui_state_router


AGED = (datetime.now(UTC) - timedelta(days=400)).isoformat()


@pytest.fixture
def state_file(tmp_path: Path) -> Path:
    path = tmp_path / ".claudebox" / "ui-state.json"
    path.parent.mkdir()
    path.write_text(
        json.dumps(
            {
                "version": UIStateService.VERSION,
                "global": {"pinnedSessions": ["kept-by-pin"]},
                "sessions": {
                    session_id: {"minimapPinned": False, "updated_at": AGED}
                    for session_id in ("kept-by-pin", "nothing-keeps-it")
                },
            },
        ),
    )

    return path


@pytest.fixture
def client(tmp_path: Path, state_file: Path):
    with ThreadPoolExecutor(max_workers=1) as executor:
        service = UIStateService(
            RegisteredWorkspace(id="ws", path=tmp_path),
            executor=executor,
            session_days=SESSION_MAX_AGE.days,
        )
        app = FastAPI()
        app.include_router(ui_state_router)
        app.dependency_overrides[get_workspace] = lambda workspace_id: SimpleNamespace(
            ui_state=service,
        )

        yield TestClient(app)


# SPEC: panel-session:pin-keeps-settings
def test_a_write_keeps_what_the_app_remembers_for_a_pinned_session_however_old(client, state_file):
    response = client.patch(
        "/api/workspaces/ws/ui-state",
        json={"global": [{"op": "set", "path": "sessionsPanelFilter", "value": "all"}]},
    )

    assert response.status_code == 200
    sessions = json.loads(state_file.read_text())["sessions"]
    assert sessions == {"kept-by-pin": {"minimapPinned": False, "updated_at": AGED}}
