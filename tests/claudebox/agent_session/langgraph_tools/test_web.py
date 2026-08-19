"""web.py @tool tests - web_fetch, web_search."""

import socket
from unittest.mock import MagicMock, patch

import httpx
import pytest

from claudebox.agent_session.langgraph_tools.web import make_web_tools


# A resolvable public IP so `_guard_url`'s host check passes without a real DNS lookup.
_PUBLIC_ADDRINFO = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]


def _tools(tool_ctx):
    by_name = {tool_obj.name: tool_obj for tool_obj in make_web_tools(tool_ctx)}

    return by_name["web_fetch"], by_name["web_search"]


def _fake_response(*, text, content_type):
    """A streaming-shaped response: `iter_text()` yields `text` in one chunk."""

    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.has_redirect_location = False
    response.headers = {"content-type": content_type}
    response.iter_text = MagicMock(return_value=iter([text]))
    response.close = MagicMock()

    return response


def _fake_client(fake_response):
    """A patchable httpx.Client whose one streamed GET returns fake_response, no redirect."""

    fake_client = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
    fake_client.send.return_value = fake_response

    return fake_client


class TestWebFetch:
    def test_html_converted_to_markdown(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        fake_client = _fake_client(
            _fake_response(text="<h1>Hello</h1><p>world</p>", content_type="text/html"),
        )

        with (
            patch("httpx.Client", return_value=fake_client),
            patch("socket.getaddrinfo", return_value=_PUBLIC_ADDRINFO),
        ):
            result = web_fetch.invoke({"url": "https://example.com"})

        assert "Hello" in result

    def test_plain_text_passthrough(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        fake_client = _fake_client(
            _fake_response(text="raw text body", content_type="text/plain"),
        )

        with (
            patch("httpx.Client", return_value=fake_client),
            patch("socket.getaddrinfo", return_value=_PUBLIC_ADDRINFO),
        ):
            result = web_fetch.invoke({"url": "https://example.com/raw.txt"})

        assert result == "raw text body"

    def test_truncates_oversize_response(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        oversized = "x" * (200 * 1024)
        fake_client = _fake_client(
            _fake_response(text=oversized, content_type="text/plain"),
        )

        with (
            patch("httpx.Client", return_value=fake_client),
            patch("socket.getaddrinfo", return_value=_PUBLIC_ADDRINFO),
        ):
            result = web_fetch.invoke({"url": "https://example.com/big"})

        assert "truncated at 100 KB" in result
        assert len(result) < 200 * 1024

    def test_stops_reading_once_the_cap_is_reached(self, tool_ctx):
        """Cap engages while bytes arrive, not after a full read; `pulled` proves the read stopped early
        instead of draining `iter_text()` first."""

        web_fetch, _ = _tools(tool_ctx)
        # 4000 doesn't evenly divide the 102400-byte cap, so the crossing chunk overshoots - like a real response.
        chunk = "x" * 4000
        available_chunks = 100  # 400 KB on offer, far past the 100 KB cap
        pulled: list[int] = []

        def _chunks():
            for i in range(available_chunks):
                pulled.append(i)
                yield chunk

        response = _fake_response(text="", content_type="text/plain")
        response.iter_text = MagicMock(return_value=_chunks())
        fake_client = _fake_client(response)

        with (
            patch("httpx.Client", return_value=fake_client),
            patch("socket.getaddrinfo", return_value=_PUBLIC_ADDRINFO),
        ):
            result = web_fetch.invoke({"url": "https://example.com/big"})

        assert "truncated at 100 KB" in result
        # cap / chunk size ~= 26 chunks; well short of the 100 on offer.
        assert len(pulled) < 40

    def test_http_error_raises_tool_exception(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        fake_client = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_client.send.side_effect = httpx.HTTPError("boom")

        with (
            patch("httpx.Client", return_value=fake_client),
            patch("socket.getaddrinfo", return_value=_PUBLIC_ADDRINFO),
            pytest.raises(Exception, match="HTTP error"),
        ):
            web_fetch.invoke({"url": "https://example.com"})

    def test_non_http_scheme_is_rejected_without_any_network_call(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)

        with patch("httpx.Client") as client_cls, pytest.raises(Exception, match="scheme"):
            web_fetch.invoke({"url": "file:///etc/passwd"})

        client_cls.assert_not_called()

    def test_loopback_host_is_blocked(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        loopback = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))]

        with (
            patch("socket.getaddrinfo", return_value=loopback),
            pytest.raises(Exception, match="local/internal"),
        ):
            web_fetch.invoke({"url": "http://localhost:8080/admin"})

    def test_cloud_metadata_endpoint_is_blocked(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        metadata_ip = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 0))]

        with (
            patch("socket.getaddrinfo", return_value=metadata_ip),
            pytest.raises(Exception, match="local/internal"),
        ):
            web_fetch.invoke({"url": "http://169.254.169.254/latest/meta-data/"})

    def test_private_rfc1918_host_is_blocked(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        private_ip = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 0))]

        with (
            patch("socket.getaddrinfo", return_value=private_ip),
            pytest.raises(Exception, match="local/internal"),
        ):
            web_fetch.invoke({"url": "http://10.0.0.5/internal-api"})

    def test_unresolvable_host_is_blocked(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)

        with (
            patch("socket.getaddrinfo", side_effect=OSError("Name or service not known")),
            pytest.raises(Exception, match="could not resolve"),
        ):
            web_fetch.invoke({"url": "http://does-not-resolve.invalid/"})

    def test_redirect_to_a_blocked_host_is_refused(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        redirect_response = MagicMock(
            has_redirect_location=True,
            headers={"location": "http://169.254.169.254/latest/meta-data/"},
        )
        redirect_response.url = httpx.URL("https://example.com/")
        redirect_response.close = MagicMock()
        fake_client = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_client.send.return_value = redirect_response

        def _resolve(hostname, *_args, **_kwargs):
            if hostname == "169.254.169.254":
                return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 0))]

            return _PUBLIC_ADDRINFO

        with (
            patch("httpx.Client", return_value=fake_client),
            patch("socket.getaddrinfo", side_effect=_resolve),
            pytest.raises(Exception, match="local/internal"),
        ):
            web_fetch.invoke({"url": "https://example.com/redirect-me"})


class TestWebSearch:
    def test_duckduckgo_dispatch(self, tool_ctx):
        _, web_search = _tools(tool_ctx)
        fake_results = [
            {"title": "T1", "href": "https://a.com", "body": "snippet1"},
            {"title": "T2", "url": "https://b.com", "body": "snippet2"},
        ]
        fake_ddgs = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_ddgs.text.return_value = fake_results

        with patch("duckduckgo_search.DDGS", return_value=fake_ddgs):
            results = web_search.invoke({"query": "anything"})

        assert results == [
            {"title": "T1", "url": "https://a.com", "snippet": "snippet1"},
            {"title": "T2", "url": "https://b.com", "snippet": "snippet2"},
        ]

    def test_unknown_provider_raises(self, tool_ctx):
        tool_ctx.config.web_search_provider = "wat"
        _, web_search = _tools(tool_ctx)

        with pytest.raises(Exception, match="unknown provider"):
            web_search.invoke({"query": "x"})

    def test_blocked_domains_filter(self, tool_ctx):
        _, web_search = _tools(tool_ctx)
        fake_results = [
            {"title": "T1", "href": "https://blocked.com", "body": "s1"},
            {"title": "T2", "href": "https://allowed.com", "body": "s2"},
        ]
        fake_ddgs = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_ddgs.text.return_value = fake_results

        with patch("duckduckgo_search.DDGS", return_value=fake_ddgs):
            results = web_search.invoke({"query": "x", "blocked_domains": ["blocked.com"]})

        assert len(results) == 1
        assert results[0]["url"] == "https://allowed.com"

    def test_allowed_domains_filter(self, tool_ctx):
        _, web_search = _tools(tool_ctx)
        fake_results = [
            {"title": "T1", "href": "https://allowed.com", "body": "s1"},
            {"title": "T2", "href": "https://other.com", "body": "s2"},
        ]
        fake_ddgs = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_ddgs.text.return_value = fake_results

        with patch("duckduckgo_search.DDGS", return_value=fake_ddgs):
            results = web_search.invoke({"query": "x", "allowed_domains": ["allowed.com"]})

        assert len(results) == 1
        assert results[0]["url"] == "https://allowed.com"
