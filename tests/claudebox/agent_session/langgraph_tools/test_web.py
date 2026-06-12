"""web.py @tool tests - web_fetch, web_search."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from claudebox.agent_session.langgraph_tools.web import make_web_tools


def _tools(tool_ctx):
    by_name = {tool_obj.name: tool_obj for tool_obj in make_web_tools(tool_ctx)}

    return by_name["web_fetch"], by_name["web_search"]


class TestWebFetch:
    def test_html_converted_to_markdown(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        fake_response = MagicMock(
            text="<h1>Hello</h1><p>world</p>",
            headers={"content-type": "text/html"},
        )
        fake_response.raise_for_status = MagicMock()
        fake_client = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_client.get.return_value = fake_response

        with patch("httpx.Client", return_value=fake_client):
            result = web_fetch.invoke({"url": "https://example.com"})

        assert "Hello" in result

    def test_plain_text_passthrough(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        fake_response = MagicMock(
            text="raw text body",
            headers={"content-type": "text/plain"},
        )
        fake_response.raise_for_status = MagicMock()
        fake_client = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_client.get.return_value = fake_response

        with patch("httpx.Client", return_value=fake_client):
            result = web_fetch.invoke({"url": "https://example.com/raw.txt"})

        assert result == "raw text body"

    def test_truncates_oversize_response(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        oversized = "x" * (200 * 1024)
        fake_response = MagicMock(text=oversized, headers={"content-type": "text/plain"})
        fake_response.raise_for_status = MagicMock()
        fake_client = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_client.get.return_value = fake_response

        with patch("httpx.Client", return_value=fake_client):
            result = web_fetch.invoke({"url": "https://example.com/big"})

        assert "truncated at 100 KB" in result
        assert len(result) < 200 * 1024

    def test_http_error_raises_tool_exception(self, tool_ctx):
        web_fetch, _ = _tools(tool_ctx)
        fake_client = MagicMock(__enter__=lambda s: s, __exit__=lambda *a: None)
        fake_client.get.side_effect = httpx.HTTPError("boom")

        with patch("httpx.Client", return_value=fake_client):
            with pytest.raises(Exception, match="HTTP error"):
                web_fetch.invoke({"url": "https://example.com"})


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
