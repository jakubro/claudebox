"""Shared handler dependencies - FastAPI DI aliases for common services."""

from typing import Annotated

from fastapi import Depends

from ..domain import DaemonService, WorkspaceService, get_daemon, get_workspace


# FastAPI dependency - injects the top-level DaemonService singleton.
DaemonDep = Annotated[DaemonService, Depends(get_daemon)]

# FastAPI dependency - injects the WorkspaceService for the path-resolved workspace.
WorkspaceDep = Annotated[WorkspaceService, Depends(get_workspace)]
