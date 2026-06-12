"""Workspaces - top-level CRUD + workspace-scoped session-defaults / commands."""

import dataclasses

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from claudebox import UnknownRuntime, resolve_runtime_class
from ._shared import DaemonDep, WorkspaceDep


class RegisterWorkspaceRequest(BaseModel):
    """Body for POST /api/workspaces."""

    path: str


router = APIRouter(prefix="/api/workspaces")


# Top-level CRUD
# ----------------------------------------------------------------------------------------------


@router.get("")
async def list_workspaces(svc: DaemonDep) -> dict:
    """List every registered workspace with running/stopped container counts."""

    return {"workspaces": await svc.list_workspaces_with_counts()}


@router.post("")
async def register_workspace(svc: DaemonDep, body: RegisterWorkspaceRequest):
    """Register a workspace; idempotent - re-register returns the existing entry."""

    return await svc.register_workspace(body.path)


@router.delete("/{workspace_id}")
async def deregister_workspace(svc: DaemonDep, workspace_id: str):
    """Remove a workspace from the registry; 404 via WorkspaceNotRegistered if absent."""

    await svc.deregister_workspace(workspace_id)

    return {"id": workspace_id, "status": "deregistered"}


# Workspace-scoped
# ----------------------------------------------------------------------------------------------


@router.get("/{workspace_id}/session-defaults")
async def get_session_defaults(svc: WorkspaceDep) -> dict:
    """Return what a new session in this workspace would inherit plus the available choices.

    Catalog fields (default + available list per axis) are NULL when the runtime
    advertises that flag as False - frontend infers absence from the missing field.
    The workspace's configured runtime (`agent` TOML key) selects the capability
    matrix and default-catalog source; unknown runtimes return HTTP 422.
    """

    try:
        cls = resolve_runtime_class(svc.config.agent)
    except UnknownRuntime as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    caps = cls.CAPABILITIES

    return {
        "workspace": str(svc.workspace.path),
        "runtime_name": cls.runtime_name,
        "capabilities": dataclasses.asdict(caps),
        "model": cls.get_default_model() if caps.supports_models else None,
        "permission_mode": (
            cls.get_default_permission_mode() if caps.supports_permission_modes else None
        ),
        "effort_level": (cls.get_default_effort_level() if caps.supports_effort_levels else None),
        "available_models": cls.AVAILABLE_MODELS if caps.supports_models else None,
        "available_permission_modes": (
            cls.AVAILABLE_PERMISSION_MODES if caps.supports_permission_modes else None
        ),
        "available_effort_levels": (
            cls.AVAILABLE_EFFORT_LEVELS if caps.supports_effort_levels else None
        ),
    }


@router.get("/{workspace_id}/commands")
async def get_workspace_commands(svc: WorkspaceDep) -> dict | None:
    """Return the workspace's filesystem-discovered slash commands and skills, or null when supports_skills is False."""

    return svc.list_workspace_commands()
