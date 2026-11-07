"""End-to-end tests for what the daemon's container proxy lets cross between the browser and a container.

The daemon's container router and its real proxy client in front of a stub container that answers the way a
hostile one would and records the request headers it was sent.
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from claudebox_daemon.domain import get_workspace
from claudebox_daemon.domain.containers.models import Container
from claudebox_daemon.domain.containers.proxy import ContainerProxyClient
from claudebox_daemon.handlers.containers import workspace_router


ATTACHMENTS = {
    "probe.png": "image/png",
    "probe.svg": "image/svg+xml",
    "probe.pdf": "application/pdf",
    "probe.xyz": "application/octet-stream",
}
HOSTILE = {
    "set-cookie": "session=stolen",
    "location": "https://elsewhere.example/",
    "clear-site-data": '"*"',
    "refresh": "0; url=https://elsewhere.example/",
    "content-security-policy": "default-src *",
    "x-custom": "from-the-container",
}


@pytest.fixture
def stub():
    seen: list[dict[str, str]] = []

    async def attachment(request: Request) -> Response:
        name = request.path_params["name"]

        return Response(b"bytes", media_type=ATTACHMENTS[name])

    async def send(request: Request) -> Response:
        seen.append(dict(request.headers))

        return JSONResponse({"ok": True}, headers=HOSTILE)

    async def events(_request: Request) -> Response:
        async def body():
            yield b"data: one\n\n"
            yield b"data: two\n\n"

        return StreamingResponse(body(), media_type="text/event-stream; charset=utf-8")

    app = Starlette(
        routes=[
            Route("/api/sessions/current/attachments/{name}", attachment),
            Route("/api/send", send, methods=["POST"]),
            Route("/api/events", events),
        ],
    )

    return SimpleNamespace(app=app, seen=seen)


@pytest.fixture
async def daemon(stub):
    proxy = ContainerProxyClient()
    await proxy._client._transport.aclose()
    proxy._client._transport = httpx.ASGITransport(app=stub.app)
    container = Container(id="c1", backend_id="b1", port=8080)

    async def forward(request, container_id, endpoint):
        assert container_id == container.id

        return await proxy.forward(request, container, endpoint)

    app = FastAPI()
    app.include_router(workspace_router)
    app.dependency_overrides[get_workspace] = lambda: SimpleNamespace(
        container_service=SimpleNamespace(forward=forward),
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://daemon",
    ) as client:
        yield client

    await proxy.close()


def _route(endpoint: str) -> str:
    return f"/api/workspaces/ws/containers/c1/{endpoint}"


# SPEC: chat:attachment-download
@pytest.mark.anyio
@pytest.mark.parametrize(
    ("name", "downloads"),
    [("probe.png", False), ("probe.svg", True), ("probe.pdf", True), ("probe.xyz", True)],
)
async def test_only_a_raster_picture_opens_inline_and_everything_is_sandboxed(
    daemon,
    name,
    downloads,
):
    response = await daemon.get(_route(f"api/sessions/current/attachments/{name}"))

    assert response.status_code == 200
    assert response.headers.get("content-disposition", "").startswith("attachment") is downloads
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"


@pytest.mark.anyio
async def test_the_browsers_credentials_never_reach_the_container(daemon, stub):
    await daemon.post(
        _route("api/send"),
        json={"text": "hi"},
        headers={
            "cookie": "session=secret",
            "authorization": "Bearer secret",
            "origin": "https://localhost:41820",
            "referer": "https://localhost:41820/",
            "x-forwarded-for": "10.0.0.9",
            "x-custom": "from-the-browser",
        },
    )

    seen = stub.seen[0]

    for name in ("cookie", "authorization", "origin", "referer", "x-forwarded-for", "x-custom"):
        assert name not in seen

    assert seen["content-type"] == "application/json"


@pytest.mark.anyio
async def test_a_cookie_the_container_sets_never_comes_back_to_it(daemon, stub):
    for _ in range(2):
        await daemon.post(_route("api/send"), json={"text": "hi"})

    assert [seen.get("cookie") for seen in stub.seen] == [None, None]


@pytest.mark.anyio
async def test_the_containers_headers_do_not_act_on_the_apps_origin(daemon):
    response = await daemon.post(_route("api/send"), json={"text": "hi"})

    assert (response.status_code, response.json()) == (200, {"ok": True})
    assert response.headers.get_list("set-cookie") == []

    for name in ("location", "clear-site-data", "refresh", "x-custom"):
        assert name not in response.headers

    assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert response.headers["x-content-type-options"] == "nosniff"


@pytest.mark.anyio
async def test_the_event_stream_still_arrives_as_a_stream(daemon):
    async with daemon.stream("GET", _route("api/events")) as response:
        body = b"".join([chunk async for chunk in response.aiter_bytes()])

    assert response.headers["content-type"].startswith("text/event-stream")
    assert "content-disposition" not in response.headers
    assert body == b"data: one\n\ndata: two\n\n"
