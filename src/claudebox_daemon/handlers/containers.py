"""Container signal/proxy routes (workspace-scoped only)."""

from fastapi import APIRouter, Request

from ._models import StopContainerRequest
from ._shared import WorkspaceDep


workspace_router = APIRouter(prefix="/api/workspaces/{workspace_id}")


# Workspace-scoped routes
# ----------------------------------------------------------------------------------------------


@workspace_router.get("/containers")
async def list_containers(svc: WorkspaceDep) -> dict:
    """List every registered container for this workspace."""

    return {"containers": svc.container_service.list_all()}


@workspace_router.get("/containers/{container_id}")
async def get_container(svc: WorkspaceDep, container_id: str):
    """Return a single registered container for a workspace."""

    return svc.container_service.get(container_id)


@workspace_router.post("/containers/{container_id}/stop")
async def stop_container(svc: WorkspaceDep, container_id: str, body: StopContainerRequest):
    """Send SIGTERM with grace; container ends STOPPED, stays in the registry."""

    await svc.container_service.stop_container(container_id, **body.model_dump())

    return {"id": container_id, "status": "stopped"}


@workspace_router.post("/containers/{container_id}/kill")
async def kill_container(svc: WorkspaceDep, container_id: str):
    """Send SIGKILL; container ends STOPPED, stays in the registry."""

    await svc.container_service.kill_container(container_id)

    return {"id": container_id, "status": "stopped"}


@workspace_router.delete("/containers/{container_id}")
async def delete_container(svc: WorkspaceDep, container_id: str):
    """Gracefully stop and remove a container within a workspace."""

    await svc.container_service.stop_container(container_id)
    await svc.container_service.remove(container_id)

    return {"id": container_id, "status": "deleted"}


@workspace_router.api_route(
    "/containers/{container_id}/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def proxy(svc: WorkspaceDep, container_id: str, path: str, request: Request):
    """Reverse-proxy requests to a container backend within a workspace."""

    return await svc.container_service.forward(request, container_id, path)
