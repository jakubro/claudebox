"""Daemon HTTP handler package."""

from fastapi import APIRouter

from .boards import router as boards_router
from .containers import workspace_router as containers_workspace_router
from .daemon import router as daemon_router
from .sessions import router as sessions_router
from .ui_state import router as ui_state_router
from .workspaces import router as workspaces_router


api_router = APIRouter()
api_router.include_router(containers_workspace_router)
api_router.include_router(boards_router)
api_router.include_router(daemon_router)
api_router.include_router(sessions_router)
api_router.include_router(ui_state_router)
api_router.include_router(workspaces_router)
