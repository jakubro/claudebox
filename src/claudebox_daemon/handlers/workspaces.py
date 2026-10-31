"""Workspaces - top-level CRUD + workspace-scoped session-defaults / commands."""

from __future__ import annotations

import dataclasses

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from claudebox import Config, UnknownRuntime, agent_logged_in, resolve_runtime_class
from ._shared import DaemonDep, WorkspaceDep
from ..domain import SEEDED_BUNDLE_KEYS


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
async def register_workspace(svc: DaemonDep, body: RegisterWorkspaceRequest) -> dict:
    """Register a directory as a workspace, writing its .workspace marker; a repeat says so."""

    workspace, already_registered = await svc.register_workspace(body.path)

    return {
        "id": workspace.id,
        "path": str(workspace.path),
        "already_registered": already_registered,
    }


@router.delete("/{workspace_id}")
async def deregister_workspace(svc: DaemonDep, workspace_id: str):
    """Remove a workspace from the registry; 404 via WorkspaceNotRegistered if absent."""

    await svc.deregister_workspace(workspace_id)

    return {"id": workspace_id, "status": "deregistered"}


# Workspace-scoped
# ----------------------------------------------------------------------------------------------


@router.get("/{workspace_id}/session-defaults")
async def get_session_defaults(svc: WorkspaceDep, workspace_id: str) -> dict:
    """Return what a new session in this workspace would inherit plus the available choices.

    Catalog fields go NULL when the runtime flag is False; frontend infers absence from the missing field.
    The `agent` TOML key selects the capability matrix and default source; unknown runtimes -> HTTP 422.
    """

    try:
        cls = resolve_runtime_class(svc.config.agent)
    except UnknownRuntime as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    caps = cls.CAPABILITIES
    # Re-read per request: `svc.config` is a construction-time snapshot and bundles re-resolve.
    config = Config.load(svc.workspace.path)
    bundles = config.bundles or {}

    return {
        "workspace": str(svc.workspace.path),
        "runtime_name": cls.runtime_name,
        "editor_url_template": svc.config.editor_url_template,
        "capabilities": dataclasses.asdict(caps),
        "rate_limits": svc.rate_limits.get(),
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
        "logged_in": agent_logged_in(config),
        "bundle_names": list(bundles),
        "bundles": {
            name: {
                "declared": {key: table[key] for key in SEEDED_BUNDLE_KEYS if key in table},
                "keys": sorted(table),
            }
            for name, table in bundles.items()
        },
    }


@router.get("/{workspace_id}/commands")
async def get_workspace_commands(svc: WorkspaceDep, workspace_id: str) -> dict | None:
    """Return the workspace's filesystem-discovered slash commands and skills, or null when supports_skills is False."""

    return svc.list_workspace_commands()
