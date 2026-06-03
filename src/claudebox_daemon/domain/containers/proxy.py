"""Reverse proxy for forwarding HTTP and SSE requests to containers."""

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import httpx
from fastapi.responses import Response
from starlette.requests import Request

from claudebox import ProxyClient, get_logger
from .errors import ContainerTimeout, ContainerUnavailable
from .models import Container
from ...constants import CONTAINER_PROXY_TIMEOUT


T = TypeVar("T")


class ContainerProxyClient(ProxyClient):
    """Proxy client scoped to container forwarding."""

    def __init__(self) -> None:
        super().__init__(timeout=CONTAINER_PROXY_TIMEOUT)
        self._logger = get_logger(__name__)

    async def send(
        self,
        *,
        payload: Any,
        container: Container,
        endpoint: str,
        method: str,
        raw: bool = False,
    ) -> Any:
        """Send a request to a container endpoint.

        When raw=True, returns the httpx.Response directly without parsing.
        """

        async def handler(path: str) -> Any:
            response = await self._client.request(method, path, json=payload)

            if raw:
                return response

            response.raise_for_status()
            return response.json()

        return await self._handle_request(handler, container, endpoint)

    # noinspection PyMethodOverriding
    async def forward(self, request: Request, container: Container, endpoint: str) -> Response:  # ty: ignore[invalid-method-override]
        """Forward a request to a container endpoint."""

        parent_forward = super().forward

        async def handler(path: str):
            return await parent_forward(request=request, path=path)

        return await self._handle_request(handler, container, endpoint)

    async def _handle_request(
        self,
        fn: Callable[[str], Awaitable[T]],
        container: Container,
        endpoint: str,
    ) -> T:
        url = f"{container.base_url}/{endpoint}"

        try:
            return await fn(url)
        except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as exc:
            self._logger.warning(
                "Container connection failed",
                url=url,
                container={"id": container.id, "port": container.port, "status": container.status},
                error={"type": type(exc).__name__, "message": str(exc)},
            )
            raise ContainerUnavailable(container_id=container.id)
        except httpx.TimeoutException as exc:
            self._logger.warning(
                "Container request timed out",
                url=url,
                container={"id": container.id, "port": container.port, "status": container.status},
                error={"type": type(exc).__name__, "message": str(exc)},
            )
            raise ContainerTimeout(container_id=container.id)
