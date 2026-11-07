"""Tests for claudebox.core.http - HTTP proxy client."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from starlette.requests import Request

from claudebox.core import serialization
from claudebox.core.broadcaster import CLOSED
from claudebox.core.http import (
    BroadcastEventSourceResponse,
    JSONResponse,
    ProxyBufferedResponse,
    ProxyClient,
    ProxyStreamingResponse,
    http_serve,
)


# --- helpers ---


def _make_starlette_request(
    method: str = "GET",
    path: str = "/test",
    headers: dict[str, str] | None = None,
    body: bytes = b"",
    query_string: str = "",
) -> Request:
    """Build a minimal Starlette Request from ASGI scope."""

    hdrs = headers or {}
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in hdrs.items()]
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": query_string.encode(),
        "headers": raw_headers,
    }

    async def receive():
        return {"type": "http.request", "body": body}

    return Request(scope, receive)


def _make_httpx_response(
    status_code: int = 200,
    headers: dict[str, str] | None = None,
    content: bytes = b"",
) -> httpx.Response:
    """Build an httpx.Response with given headers and content."""

    hdrs = headers or {}
    resp = httpx.Response(status_code=status_code, headers=hdrs, content=content)

    return resp


def _make_streaming_httpx_response(
    status_code: int = 200,
    headers: dict[str, str] | None = None,
    chunks: list[bytes] | None = None,
) -> httpx.Response:
    """Build an httpx.Response that supports async streaming."""

    hdrs = headers or {}
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.headers = httpx.Headers(hdrs)

    async def aiter_bytes():
        for chunk in chunks or []:
            yield chunk

    resp.aiter_bytes = aiter_bytes
    resp.aclose = AsyncMock()

    return resp


# --- JSONResponse ---


class TestJSONResponse:
    """Test custom JSON response rendering."""

    def test_render_dict(self):
        resp = JSONResponse(content={"key": "value"})
        assert b'"key"' in resp.body
        assert b'"value"' in resp.body

    def test_render_list(self):
        resp = JSONResponse(content=[1, 2, 3])
        assert b"[1, 2, 3]" in resp.body

    def test_render_nested(self):
        resp = JSONResponse(content={"a": {"b": 1}})
        body = resp.body.decode("utf-8")  # ty: ignore[unresolved-attribute]
        assert '"a"' in body
        assert '"b"' in body

    def test_content_type_is_json(self):
        resp = JSONResponse(content={"x": 1})
        assert resp.media_type == "application/json"


# --- ProxyStreamingResponse ---


class TestProxyStreamingResponse:
    """Test streaming proxy response passthrough and cleanup."""

    @pytest.mark.anyio
    async def test_streams_chunks(self):
        upstream = _make_streaming_httpx_response(
            chunks=[b"hello ", b"world"],
        )
        resp = ProxyStreamingResponse(upstream)
        collected = []

        async for chunk in resp.body_iterator:
            collected.append(chunk)

        assert b"hello " in collected
        assert b"world" in collected

    @pytest.mark.anyio
    async def test_closes_upstream_after_streaming(self):
        upstream = _make_streaming_httpx_response(chunks=[b"data"])
        resp = ProxyStreamingResponse(upstream)

        async for _ in resp.body_iterator:
            pass

        upstream.aclose.assert_awaited_once()  # ty: ignore[unresolved-attribute]

    @pytest.mark.anyio
    async def test_closes_upstream_on_connect_error(self):
        upstream = MagicMock(spec=httpx.Response)
        upstream.aclose = AsyncMock()

        async def aiter_bytes():
            raise httpx.ConnectError("connection lost")
            yield  # pragma: no cover - makes this an async generator

        upstream.aiter_bytes = aiter_bytes
        resp = ProxyStreamingResponse(upstream)

        async for _ in resp.body_iterator:
            pass

        upstream.aclose.assert_awaited_once()

    @pytest.mark.anyio
    async def test_closes_upstream_on_remote_protocol_error(self):
        upstream = MagicMock(spec=httpx.Response)
        upstream.aclose = AsyncMock()

        async def aiter_bytes():
            raise httpx.RemoteProtocolError("bad framing")
            yield  # pragma: no cover - makes this an async generator

        upstream.aiter_bytes = aiter_bytes
        resp = ProxyStreamingResponse(upstream)

        async for _ in resp.body_iterator:
            pass

        upstream.aclose.assert_awaited_once()


# --- ProxyBufferedResponse ---


class TestProxyBufferedResponse:
    """Test buffered proxy response reading and cleanup."""

    @pytest.mark.anyio
    async def test_reads_full_body(self):
        upstream = _make_httpx_response(
            status_code=200,
            content=b"full body",
        )
        resp = await ProxyBufferedResponse.from_upstream(upstream)
        assert resp.body == b"full body"

    @pytest.mark.anyio
    async def test_preserves_status_code(self):
        upstream = _make_httpx_response(status_code=404, content=b"not found")
        resp = await ProxyBufferedResponse.from_upstream(upstream)
        assert resp.status_code == 404

    @pytest.mark.anyio
    async def test_passes_kwargs_to_response(self):
        upstream = _make_httpx_response(content=b"data")
        resp = await ProxyBufferedResponse.from_upstream(upstream, headers={"x-custom": "val"})
        assert resp.headers["x-custom"] == "val"

    @pytest.mark.anyio
    async def test_closes_upstream_on_error(self):
        upstream = MagicMock(spec=httpx.Response)
        upstream.status_code = 200
        upstream.aread = AsyncMock(side_effect=httpx.ReadError("oops"))
        upstream.aclose = AsyncMock()

        with pytest.raises(httpx.ReadError):
            await ProxyBufferedResponse.from_upstream(upstream)

        upstream.aclose.assert_awaited_once()


# --- ProxyClient._request_headers ---


class TestRequestHeaders:
    """Only Accept and Content-Type cross from the browser to the container."""

    def test_keeps_accept_and_content_type(self):
        req = _make_starlette_request(
            headers={"accept": "text/event-stream", "content-type": "application/json"},
        )
        headers = ProxyClient._request_headers(req)
        assert headers == {"accept": "text/event-stream", "content-type": "application/json"}

    @pytest.mark.parametrize(
        "name",
        [
            "host",
            "authorization",
            "cookie",
            "origin",
            "referer",
            "x-forwarded-for",
            "sec-fetch-site",
            "x-custom",
        ],
    )
    def test_drops_every_other_header(self, name):
        req = _make_starlette_request(headers={name: "value", "Content-Type": "application/json"})
        headers = ProxyClient._request_headers(req)
        assert {k.lower() for k in headers} == {"content-type"}

    def test_empty_headers(self):
        req = _make_starlette_request(headers={})
        headers = ProxyClient._request_headers(req)
        assert headers == {}


# --- ProxyClient._response_headers ---


class TestResponseHeaders:
    """Only listed headers come back, every response is sandboxed, and non-inline types download."""

    @staticmethod
    def _lowered(headers: dict[str, str]) -> dict[str, str]:
        return {k.lower(): v for k, v in headers.items()}

    def test_keeps_the_listed_headers(self):
        resp = _make_httpx_response(
            headers={
                "content-type": "application/json",
                "cache-control": "no-store",
                "etag": '"v1"',
                "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
                "x-accel-buffering": "no",
            },
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert headers["content-type"] == "application/json"
        assert headers["cache-control"] == "no-store"
        assert headers["etag"] == '"v1"'
        assert headers["last-modified"] == "Wed, 01 Jan 2025 00:00:00 GMT"
        assert headers["x-accel-buffering"] == "no"

    @pytest.mark.parametrize(
        "name",
        [
            "set-cookie",
            "location",
            "content-length",
            "transfer-encoding",
            "content-encoding",
            "refresh",
            "clear-site-data",
            "access-control-allow-origin",
            "x-req-id",
        ],
    )
    def test_drops_every_other_header(self, name):
        resp = _make_httpx_response(headers={name: "value", "content-type": "application/json"})
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert name not in headers

    def test_forces_nosniff_and_the_sandbox_policy_over_the_upstream_ones(self):
        resp = _make_httpx_response(
            headers={
                "content-type": "application/json",
                "content-security-policy": "default-src *",
                "x-content-type-options": "sniff",
            },
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["content-security-policy"] == "default-src 'none'; sandbox"

    @pytest.mark.parametrize(
        "content_type",
        [
            "application/json",
            "application/json; charset=utf-8",
            "text/event-stream; charset=utf-8",
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "IMAGE/PNG",
        ],
    )
    def test_an_inline_type_carries_no_disposition(self, content_type):
        resp = _make_httpx_response(
            headers={"content-type": content_type, "content-disposition": "attachment"},
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert "content-disposition" not in headers

    @pytest.mark.parametrize(
        "content_type",
        [
            "image/svg+xml",
            "application/pdf",
            "text/html",
            "text/plain",
            "application/octet-stream",
            "image/png, text/html",
            None,
        ],
    )
    def test_any_other_type_downloads(self, content_type):
        upstream = {"content-type": content_type} if content_type else {}
        headers = self._lowered(
            ProxyClient._response_headers(_make_httpx_response(headers=upstream)),
        )
        assert headers["content-disposition"] == "attachment"

    @pytest.mark.parametrize(
        "values",
        [
            ["image/png; x=1", "text/html"],
            ["text/html", "image/png"],
            ["image/png, text/html"],
        ],
    )
    def test_a_repeated_or_joined_type_downloads(self, values):
        upstream = httpx.Response(200, headers=[("content-type", value) for value in values])
        headers = self._lowered(ProxyClient._response_headers(upstream))
        assert headers["content-disposition"] == "attachment"

    def test_an_upstream_attachment_disposition_is_kept_verbatim(self):
        resp = _make_httpx_response(
            headers={
                "content-type": "text/plain",
                "content-disposition": 'attachment; filename="x.txt"',
            },
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert headers["content-disposition"] == 'attachment; filename="x.txt"'

    @pytest.mark.parametrize("disposition", ["attachment=1", "attachmentfoo; filename=a.html"])
    def test_a_disposition_whose_type_is_not_attachment_is_replaced(self, disposition):
        resp = _make_httpx_response(
            headers={"content-type": "text/html", "content-disposition": disposition},
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert headers["content-disposition"] == "attachment"

    def test_a_disposition_opening_with_a_space_other_than_space_or_tab_is_replaced(self):
        resp = httpx.Response(
            200,
            headers=[
                (b"content-type", b"text/html"),
                (b"content-disposition", b"\xa0attachment; filename=a.html"),
            ],
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert headers["content-disposition"] == "attachment"

    def test_a_disposition_with_space_and_tab_around_its_type_is_kept(self):
        resp = _make_httpx_response(
            headers={
                "content-type": "text/plain",
                "content-disposition": ' \tattachment ; filename="x.txt"',
            },
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert headers["content-disposition"] == ' \tattachment ; filename="x.txt"'

    def test_an_upstream_inline_disposition_becomes_attachment(self):
        resp = _make_httpx_response(
            headers={"content-type": "image/svg+xml", "content-disposition": "inline"},
        )
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert headers["content-disposition"] == "attachment"

    def test_a_not_modified_answer_carries_no_disposition(self):
        resp = _make_httpx_response(status_code=304, headers={"content-type": "image/svg+xml"})
        headers = self._lowered(ProxyClient._response_headers(resp))
        assert "content-disposition" not in headers


# --- ProxyClient.forward ---


class TestProxyClientForward:
    """Test content-type routing in the forward method."""

    @pytest.mark.anyio
    async def test_returns_streaming_for_sse(self):
        upstream = _make_streaming_httpx_response(
            headers={"content-type": "text/event-stream"},
            chunks=[b"data: hello\n\n"],
        )

        client = ProxyClient(base_url="http://upstream")
        mock_send = AsyncMock(return_value=upstream)
        client._client.send = mock_send

        request = _make_starlette_request(method="POST", body=b'{"prompt":"hi"}')
        resp = await client.forward(request, path="/v1/chat")

        assert isinstance(resp, ProxyStreamingResponse)
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["content-security-policy"] == "default-src 'none'; sandbox"
        assert "content-disposition" not in resp.headers
        await client.close()

    @pytest.mark.anyio
    async def test_a_repeated_event_stream_type_is_buffered_as_a_download(self):
        upstream_mock = MagicMock(spec=httpx.Response)
        upstream_mock.status_code = 200
        upstream_mock.headers = httpx.Headers(
            [("content-type", "text/event-stream; x=1"), ("content-type", "text/html")],
        )
        upstream_mock.aread = AsyncMock(return_value=b"<p>hi</p>")
        upstream_mock.aclose = AsyncMock()

        client = ProxyClient(base_url="http://upstream")
        client._client.send = AsyncMock(return_value=upstream_mock)

        resp = await client.forward(_make_starlette_request(), path="/x")

        assert isinstance(resp, ProxyBufferedResponse)
        assert resp.headers["content-disposition"] == "attachment"
        await client.close()

    @pytest.mark.anyio
    async def test_a_buffered_answer_is_sandboxed_and_sets_no_cookie_and_no_redirect(self):
        upstream_mock = MagicMock(spec=httpx.Response)
        upstream_mock.status_code = 302
        upstream_mock.headers = httpx.Headers(
            [
                ("content-type", "application/json"),
                ("set-cookie", "a=1"),
                ("set-cookie", "b=2"),
                ("location", "https://elsewhere.example/"),
            ],
        )
        upstream_mock.aread = AsyncMock(return_value=b"{}")
        upstream_mock.aclose = AsyncMock()

        client = ProxyClient(base_url="http://upstream")
        client._client.send = AsyncMock(return_value=upstream_mock)

        resp = await client.forward(_make_starlette_request(), path="/x")

        assert resp.status_code == 302
        assert resp.headers.getlist("set-cookie") == []
        assert "location" not in resp.headers
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["content-security-policy"] == "default-src 'none'; sandbox"
        await client.close()

    @pytest.mark.anyio
    async def test_a_cookie_one_upstream_sets_reaches_no_later_request(self):
        seen = []

        def upstream(request):
            seen.append(request.headers.get("cookie"))
            headers = {"content-type": "application/json"}

            if request.url.port == 9001:
                headers["set-cookie"] = "planted=1; Path=/"

            return httpx.Response(200, headers=headers, json={})

        client = ProxyClient(transport=httpx.MockTransport(upstream))

        for url in (
            "http://localhost:9001/api/a",
            "http://localhost:9002/api/b",
            "http://localhost:9001/api/c",
        ):
            await client.forward(_make_starlette_request(), path=url)

        assert seen == [None, None, None]
        await client.close()

    @pytest.mark.anyio
    async def test_returns_buffered_for_json(self):
        upstream = _make_httpx_response(
            headers={"content-type": "application/json"},
            content=b'{"result": "ok"}',
        )
        # Make it behave like a streamed response (send with stream=True)
        upstream.aread = AsyncMock(return_value=b'{"result": "ok"}')
        upstream.aclose = AsyncMock()
        upstream_mock = MagicMock(spec=httpx.Response)
        upstream_mock.status_code = 200
        upstream_mock.headers = httpx.Headers({"content-type": "application/json"})
        upstream_mock.aread = AsyncMock(return_value=b'{"result": "ok"}')
        upstream_mock.aclose = AsyncMock()

        client = ProxyClient(base_url="http://upstream")
        client._client.send = AsyncMock(return_value=upstream_mock)

        request = _make_starlette_request(method="GET")
        resp = await client.forward(request, path="/v1/models")

        assert isinstance(resp, ProxyBufferedResponse)
        assert resp.body == b'{"result": "ok"}'
        await client.close()

    @pytest.mark.anyio
    async def test_forwards_query_params(self):
        upstream_mock = MagicMock(spec=httpx.Response)
        upstream_mock.status_code = 200
        upstream_mock.headers = httpx.Headers({"content-type": "application/json"})
        upstream_mock.aread = AsyncMock(return_value=b"{}")
        upstream_mock.aclose = AsyncMock()

        client = ProxyClient(base_url="http://upstream")
        build_spy = MagicMock(wraps=client._client.build_request)
        client._client.build_request = build_spy
        client._client.send = AsyncMock(return_value=upstream_mock)

        request = _make_starlette_request(query_string="foo=bar&baz=1")
        await client.forward(request, path="/api")

        _, kwargs = build_spy.call_args
        assert kwargs["params"] == {"foo": "bar", "baz": "1"}
        await client.close()

    @pytest.mark.anyio
    async def test_forwards_method_and_body(self):
        upstream_mock = MagicMock(spec=httpx.Response)
        upstream_mock.status_code = 200
        upstream_mock.headers = httpx.Headers({"content-type": "text/plain"})
        upstream_mock.aread = AsyncMock(return_value=b"ok")
        upstream_mock.aclose = AsyncMock()

        client = ProxyClient(base_url="http://upstream")
        build_spy = MagicMock(wraps=client._client.build_request)
        client._client.build_request = build_spy
        client._client.send = AsyncMock(return_value=upstream_mock)

        request = _make_starlette_request(method="PUT", body=b"payload")
        await client.forward(request, path="/resource")

        _, kwargs = build_spy.call_args
        assert kwargs["method"] == "PUT"
        assert kwargs["content"] == b"payload"
        await client.close()

    @pytest.mark.anyio
    async def test_empty_body_sends_none(self):
        upstream_mock = MagicMock(spec=httpx.Response)
        upstream_mock.status_code = 200
        upstream_mock.headers = httpx.Headers({"content-type": "application/json"})
        upstream_mock.aread = AsyncMock(return_value=b"{}")
        upstream_mock.aclose = AsyncMock()

        client = ProxyClient(base_url="http://upstream")
        build_spy = MagicMock(wraps=client._client.build_request)
        client._client.build_request = build_spy
        client._client.send = AsyncMock(return_value=upstream_mock)

        request = _make_starlette_request(method="GET", body=b"")
        await client.forward(request, path="/endpoint")

        _, kwargs = build_spy.call_args
        assert kwargs["content"] is None
        await client.close()


# --- ProxyClient.close ---


class TestProxyClientClose:
    """Test client lifecycle management."""

    @pytest.mark.anyio
    async def test_close_delegates_to_httpx(self):
        client = ProxyClient(base_url="http://upstream")
        client._client.aclose = AsyncMock()
        await client.close()
        client._client.aclose.assert_awaited_once()


# --- BroadcastEventSourceResponse ---


class TestBroadcastEventSourceStream:
    """Test the subscribe/yield/unsubscribe generator underlying the SSE response."""

    @pytest.mark.anyio
    async def test_subscribes_with_no_kwargs_by_default(self):
        queue = asyncio.Queue()
        await queue.put(CLOSED)
        broadcaster = MagicMock()
        broadcaster.subscribe = AsyncMock(return_value=("sub-1", queue))
        broadcaster.unsubscribe = AsyncMock()

        async for _event in BroadcastEventSourceResponse._stream(broadcaster):
            pass

        broadcaster.subscribe.assert_awaited_once_with()

    @pytest.mark.anyio
    async def test_forwards_subscribe_kwargs(self):
        """The no-replay attach: a caller passes replay=False through to subscribe()."""

        queue = asyncio.Queue()
        await queue.put(CLOSED)
        broadcaster = MagicMock()
        broadcaster.subscribe = AsyncMock(return_value=("sub-1", queue))
        broadcaster.unsubscribe = AsyncMock()

        async for _event in BroadcastEventSourceResponse._stream(
            broadcaster,
            subscribe_kwargs={"replay": False},
        ):
            pass

        broadcaster.subscribe.assert_awaited_once_with(replay=False)

    @pytest.mark.anyio
    async def test_yields_events_and_stops_on_closed_sentinel(self):
        queue = asyncio.Queue()
        await queue.put({"id": "e1"})
        await queue.put({"id": "e2"})
        await queue.put(CLOSED)
        broadcaster = MagicMock()
        broadcaster.subscribe = AsyncMock(return_value=("sub-1", queue))
        broadcaster.unsubscribe = AsyncMock()

        yielded = [event async for event in BroadcastEventSourceResponse._stream(broadcaster)]

        assert [e["data"] for e in yielded] == [
            serialization.dumps({"id": "e1"}),
            serialization.dumps({"id": "e2"}),
        ]
        broadcaster.unsubscribe.assert_awaited_once_with("sub-1")


# --- http_serve ---


class TestHttpServe:
    """Test host binding passed through to uvicorn."""

    def test_defaults_to_all_interfaces(self):
        with patch("claudebox.core.http.uvicorn.run") as mock_run:
            http_serve(lambda: None, port=8000)  # ty: ignore[invalid-argument-type]

        assert mock_run.call_args.kwargs["host"] == "0.0.0.0"

    def test_explicit_host_forwarded(self):
        with patch("claudebox.core.http.uvicorn.run") as mock_run:
            http_serve(lambda: None, port=8000, host="127.0.0.1")  # ty: ignore[invalid-argument-type]

        assert mock_run.call_args.kwargs["host"] == "127.0.0.1"
