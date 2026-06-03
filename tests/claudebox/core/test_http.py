"""Tests for claudebox.core.http — HTTP proxy client."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from starlette.requests import Request

from claudebox.core.http import (
    JSONResponse,
    ProxyBufferedResponse,
    ProxyClient,
    ProxyStreamingResponse,
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
        upstream.aclose.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    @pytest.mark.anyio
    async def test_closes_upstream_on_connect_error(self):
        upstream = MagicMock(spec=httpx.Response)
        upstream.aclose = AsyncMock()

        async def aiter_bytes():
            raise httpx.ConnectError("connection lost")
            yield  # pragma: no cover — makes this an async generator

        upstream.aiter_bytes = aiter_bytes
        resp = ProxyStreamingResponse(upstream)
        async for _ in resp.body_iterator:
            pass
        upstream.aclose.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.

    @pytest.mark.anyio
    async def test_closes_upstream_on_remote_protocol_error(self):
        upstream = MagicMock(spec=httpx.Response)
        upstream.aclose = AsyncMock()

        async def aiter_bytes():
            raise httpx.RemoteProtocolError("bad framing")
            yield  # pragma: no cover — makes this an async generator

        upstream.aiter_bytes = aiter_bytes
        resp = ProxyStreamingResponse(upstream)
        async for _ in resp.body_iterator:
            pass
        upstream.aclose.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.


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

        upstream.aclose.assert_awaited_once()  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.


# --- ProxyClient._request_headers ---


class TestRequestHeaders:
    """Test host header stripping on outgoing proxy requests."""

    def test_strips_host_header(self):
        req = _make_starlette_request(headers={"host": "example.com", "accept": "application/json"})
        headers = ProxyClient._request_headers(req)
        assert "host" not in {k.lower() for k in headers}
        assert headers["accept"] == "application/json"

    def test_preserves_other_headers(self):
        req = _make_starlette_request(
            headers={
                "authorization": "Bearer token",
                "content-type": "application/json",
                "x-custom": "foo",
            }
        )
        headers = ProxyClient._request_headers(req)
        assert headers["authorization"] == "Bearer token"
        assert headers["content-type"] == "application/json"
        assert headers["x-custom"] == "foo"

    def test_empty_headers(self):
        req = _make_starlette_request(headers={})
        headers = ProxyClient._request_headers(req)
        assert headers == {}


# --- ProxyClient._response_headers ---


class TestResponseHeaders:
    """Test hop-by-hop header stripping on upstream responses."""

    def test_strips_content_length(self):
        resp = _make_httpx_response(headers={"content-length": "42", "x-req-id": "abc"})
        headers = ProxyClient._response_headers(resp)
        assert "content-length" not in {k.lower() for k in headers}
        assert headers["x-req-id"] == "abc"

    def test_strips_transfer_encoding(self):
        resp = _make_httpx_response(headers={"transfer-encoding": "chunked"})
        headers = ProxyClient._response_headers(resp)
        assert "transfer-encoding" not in {k.lower() for k in headers}

    def test_strips_content_encoding(self):
        resp = _make_httpx_response(headers={"content-encoding": "gzip"})
        headers = ProxyClient._response_headers(resp)
        assert "content-encoding" not in {k.lower() for k in headers}

    def test_preserves_other_headers(self):
        resp = _make_httpx_response(
            headers={
                "content-type": "application/json",
                "x-custom": "bar",
                "content-length": "10",
            }
        )
        headers = ProxyClient._response_headers(resp)
        assert headers["content-type"] == "application/json"
        assert headers["x-custom"] == "bar"
        assert "content-length" not in {k.lower() for k in headers}


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
        client._client.send = mock_send  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

        request = _make_starlette_request(method="POST", body=b'{"prompt":"hi"}')
        resp = await client.forward(request, path="/v1/chat")

        assert isinstance(resp, ProxyStreamingResponse)
        await client.close()

    @pytest.mark.anyio
    async def test_returns_buffered_for_json(self):
        upstream = _make_httpx_response(
            headers={"content-type": "application/json"},
            content=b'{"result": "ok"}',
        )
        # Make it behave like a streamed response (send with stream=True)
        upstream.aread = AsyncMock(return_value=b'{"result": "ok"}')  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.
        upstream.aclose = AsyncMock()  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.
        upstream_mock = MagicMock(spec=httpx.Response)
        upstream_mock.status_code = 200
        upstream_mock.headers = httpx.Headers({"content-type": "application/json"})
        upstream_mock.aread = AsyncMock(return_value=b'{"result": "ok"}')
        upstream_mock.aclose = AsyncMock()

        client = ProxyClient(base_url="http://upstream")
        client._client.send = AsyncMock(return_value=upstream_mock)  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

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
        client._client.build_request = build_spy  # ty: ignore[invalid-assignment]  # MagicMock spy structurally replaces real method for the test.
        client._client.send = AsyncMock(return_value=upstream_mock)  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

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
        client._client.build_request = build_spy  # ty: ignore[invalid-assignment]  # MagicMock spy structurally replaces real method for the test.
        client._client.send = AsyncMock(return_value=upstream_mock)  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

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
        client._client.build_request = build_spy  # ty: ignore[invalid-assignment]  # MagicMock spy structurally replaces real method for the test.
        client._client.send = AsyncMock(return_value=upstream_mock)  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.

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
        client._client.aclose = AsyncMock()  # ty: ignore[invalid-assignment]  # AsyncMock structurally replaces real method for the test.
        await client.close()
        client._client.aclose.assert_awaited_once()  # ty: ignore[unresolved-attribute]  # Mock attribute (assert_*, call_*, await_*) on test-replaced method.
