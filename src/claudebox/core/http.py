"""HTTP utilities — uvicorn server launcher and SSE streaming from broadcasters."""

import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, Protocol, Self

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse as BaseJSONResponse
from sse_starlette.sse import EventSourceResponse
from starlette.requests import Request
from starlette.responses import Response
from starlette.responses import StreamingResponse as BaseStreamingResponse

from . import serialization
from .concurrency import maybe_awaitable


class JSONResponse(BaseJSONResponse):
    """JSON response using the application's custom serialization encoder."""

    def render(self, content: Any) -> bytes:
        """Render content to UTF-8 encoded JSON bytes."""

        return serialization.dumps(content).encode("utf-8")


class ProxyStreamingResponse(BaseStreamingResponse):
    """StreamingResponse that wraps an httpx.Response, handling cleanup on completion."""

    def __init__(self, response: httpx.Response, **kwargs) -> None:
        self._upstream = response
        super().__init__(content=self._passthrough(), **kwargs)

    async def _passthrough(self) -> AsyncIterator[bytes]:
        """Yield raw bytes from the upstream response."""

        try:
            async for chunk in self._upstream.aiter_bytes():
                yield chunk
        except (
            httpx.ConnectError,
            httpx.ReadError,
            httpx.RemoteProtocolError,
            httpx.TimeoutException,
        ):
            pass
        finally:
            await self._upstream.aclose()


class ProxyBufferedResponse(Response):
    """Response that buffers an httpx.Response body, handling cleanup."""

    @classmethod
    async def from_upstream(cls, response: httpx.Response, **kwargs) -> Self:
        """Read full upstream body, close the response, and return as buffered."""

        try:
            raw = await response.aread()
        finally:
            await response.aclose()

        return cls(content=raw, status_code=response.status_code, **kwargs)


class ProxyClient:
    """HTTP reverse proxy that routes to streaming or buffered responses.

    Routes to SSE streaming or buffered pass-through based on upstream content-type.
    """

    def __init__(self, **kwargs) -> None:
        kwargs.setdefault("transport", httpx.AsyncHTTPTransport(retries=1))
        self._client = httpx.AsyncClient(**kwargs)

    async def close(self) -> None:
        await self._client.aclose()

    async def forward(self, request: Request, path: str) -> Response:
        """Forward a request to a URL, returning streaming or buffered response."""

        body = await request.body()

        req = self._client.build_request(
            method=request.method,
            url=path,
            headers=self._request_headers(request),
            content=body or None,
            params=dict(request.query_params),
        )
        res = await self._client.send(req, stream=True)

        headers = self._response_headers(res)
        content_type = res.headers.get("content-type", "")

        if content_type.startswith("text/event-stream"):
            return ProxyStreamingResponse(res, headers=headers)
        else:
            return await ProxyBufferedResponse.from_upstream(res, headers=headers)

    @classmethod
    def _request_headers(cls, request: Request) -> dict[str, str]:
        """Strip the Host header from an incoming request."""

        return {key: val for key, val in request.headers.items() if key.lower() not in ("host",)}

    @classmethod
    def _response_headers(cls, response: httpx.Response) -> dict[str, str]:
        """Strip content-length, transfer-encoding, and content-encoding from an upstream response."""

        return {
            key: val
            for key, val in response.headers.items()
            if key.lower() not in ("content-length", "transfer-encoding", "content-encoding")
        }


class BroadcastEventSource(Protocol):
    """Sync broadcast event source with subscribe/unsubscribe lifecycle."""

    def subscribe(self) -> tuple[str, asyncio.Queue[dict]]:
        """Register a new subscriber and return (subscriber_id, queue)."""

    def unsubscribe(self, subscriber_id: str) -> None:
        """Remove a subscriber from the broadcast list."""


class AsyncBroadcastEventSource(Protocol):
    """Async broadcast event source with subscribe/unsubscribe lifecycle."""

    async def subscribe(self) -> tuple[str, asyncio.Queue[dict]]:
        """Register a new subscriber and return (subscriber_id, queue)."""

    async def unsubscribe(self, subscriber_id: str) -> None:
        """Remove a subscriber from the broadcast list."""


class BroadcastEventSourceResponse(EventSourceResponse):
    """SSE response that subscribes to a broadcaster and streams events until disconnect."""

    def __init__(
        self,
        broadcaster: BroadcastEventSource | AsyncBroadcastEventSource,
        **kwargs,
    ) -> None:
        kwargs.setdefault("ping", 1)
        super().__init__(content=self._stream(broadcaster), **kwargs)

    @staticmethod
    async def _stream(
        broadcaster: BroadcastEventSource | AsyncBroadcastEventSource,
    ) -> AsyncIterator[dict]:
        """Yield SSE events until the client disconnects."""

        subscriber_id, queue = await maybe_awaitable(broadcaster.subscribe())

        try:
            while True:
                event = await queue.get()
                yield {"data": serialization.dumps(event)}
        except asyncio.CancelledError:
            pass
        finally:
            await maybe_awaitable(broadcaster.unsubscribe(subscriber_id))


class Factory(Protocol):
    """Callable that returns a FastAPI application instance."""

    def __call__(self) -> FastAPI: ...


def http_serve(
    factory: Factory,
    *,
    port: int,
    dev: bool = False,
    reload_dirs: list[str | Path] | None = None,
) -> None:
    """Launch uvicorn with shared defaults, enabling hot-reload when dev is True.

    Reload is suppressed when CLAUDEBOX_NO_RELOAD=1 even in dev mode.
    """

    reload = dev and os.environ.get("CLAUDEBOX_NO_RELOAD") != "1"

    uvicorn.run(
        f"{factory.__module__}:{factory.__name__}",  # ty: ignore[unresolved-attribute]
        factory=True,
        host="0.0.0.0",
        port=port,
        timeout_keep_alive=30,
        reload=reload,
        reload_dirs=[str(d) for d in reload_dirs] if reload and reload_dirs else None,
        reload_excludes=[".git", ".venv", "node_modules"] if reload else None,
        log_config=None,
    )
