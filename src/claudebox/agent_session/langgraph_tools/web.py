"""Web tools - web_fetch, web_search.

`web_fetch` converts HTML to markdown (100 KB cap, 30s timeout) and only reaches public http(s)
hosts, see `_guard_url`. `web_search` dispatches by `ctx.config.web_search_provider` (default
duckduckgo; tavily/brave opt-in via the `web-search-tavily` extra) - network reach is in the README.
"""

import ipaddress
import os
import socket
from urllib.parse import urlparse

import httpx
from langchain_core.tools import BaseTool, ToolException, tool
from markdownify import markdownify

from ._context import ToolContext


_FETCH_CAP = 100 * 1024
_FETCH_TIMEOUT = 30
_MAX_REDIRECTS = 5
_SEARCH_MAX_RESULTS = 10
_FETCH_TRUNCATED = "\n... (truncated at 100 KB)\n"
_ALLOWED_FETCH_SCHEMES = {"http", "https"}


def make_web_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind web_fetch + web_search closed over the workspace web-search config."""

    provider = ctx.config.web_search_provider
    api_key_env = ctx.config.web_search_api_key_env

    @tool
    def web_fetch(url: str, prompt: str = "") -> str:
        """Fetch `url`; HTML is converted to markdown and capped at 100 KB.

        `prompt` is accepted for Claude API parity but ignored - the model can summarise the
        returned text itself. Refuses non-http(s) schemes and internal-address hosts, see `_guard_url`.
        """

        del prompt  # accepted for parity; v1 returns raw text for in-context use

        _guard_url(url)

        try:
            with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=False) as client:
                response = _guarded_get(client, url)

                try:
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "")
                    body = _read_capped(response)
                finally:
                    response.close()
        except httpx.HTTPError as exc:
            raise ToolException(f"web_fetch: HTTP error fetching {url}: {exc}") from exc

        text = markdownify(body) if "html" in content_type.lower() else body

        if len(text) > _FETCH_CAP:
            text = text[:_FETCH_CAP] + _FETCH_TRUNCATED

        return text

    @tool
    def web_search(
        query: str,
        allowed_domains: list[str] | None = None,
        blocked_domains: list[str] | None = None,
    ) -> list[dict]:
        """Search the web for `query`; returns up to 10 results, each with `title`, `url`, and
        `snippet`. `allowed_domains`/`blocked_domains` filter results client-side; the backend is
        the workspace's `[langgraph.web_search] provider` (default duckduckgo).
        """

        results = _dispatch_search(query, provider, api_key_env)

        return _filter_domains(results, allowed_domains, blocked_domains)

    return [web_fetch, web_search]


def _guard_url(url: str) -> None:
    """Reject a fetch target that is not a plain http(s) URL to a public host.

    Blocks loopback, private, link-local (incl. the 169.254.169.254 metadata endpoint), and other
    reserved ranges; `web_search`'s domain filters only cover its own results, not `web_fetch`'s
    model-supplied URL - the actual SSRF surface.
    """

    parsed = urlparse(url)

    if parsed.scheme not in _ALLOWED_FETCH_SCHEMES:
        raise ToolException(
            f"web_fetch: scheme {parsed.scheme!r} is not allowed; use http or https.",
        )

    hostname = parsed.hostname

    if not hostname:
        raise ToolException(f"web_fetch: {url!r} has no host to resolve.")

    try:
        resolved = socket.getaddrinfo(hostname, None)
    except OSError as exc:
        raise ToolException(f"web_fetch: could not resolve host {hostname!r}: {exc}") from exc

    for family_and_addr in resolved:
        address = ipaddress.ip_address(family_and_addr[4][0])

        if (
            address.is_loopback
            or address.is_private
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
        ):
            raise ToolException(
                f"web_fetch: host {hostname!r} resolves to {address}, a local/internal "
                "address; fetching it is blocked.",
            )


def _guarded_get(client: httpx.Client, url: str) -> httpx.Response:
    """GET `url`, re-validating the host on every redirect hop (`follow_redirects=True` would skip it)."""

    current = url

    for _ in range(_MAX_REDIRECTS):
        response = client.send(client.build_request("GET", current), stream=True)

        if not response.has_redirect_location:
            return response

        location = response.headers["location"]
        response.close()
        current = str(response.url.join(location))
        _guard_url(current)

    raise ToolException(f"web_fetch: too many redirects fetching {url}.")


def _read_capped(response: httpx.Response) -> str:
    """Read `response` via `iter_text()`, stopping at `_FETCH_CAP` before the body is fully buffered."""

    parts: list[str] = []
    total = 0

    for chunk in response.iter_text():
        parts.append(chunk)
        total += len(chunk)

        if total >= _FETCH_CAP:
            break

    return "".join(parts)


def _dispatch_search(query: str, provider: str, api_key_env: str | None) -> list[dict]:
    """Route the search query to the configured backend."""

    if provider == "duckduckgo":
        return _search_duckduckgo(query)

    if provider == "tavily":
        return _search_tavily(query, api_key_env)

    if provider == "brave":
        return _search_brave(query, api_key_env)

    raise ToolException(
        f"web_search: unknown provider {provider!r}; expected one of duckduckgo, tavily, brave.",
    )


def _search_duckduckgo(query: str) -> list[dict]:
    """Search via the duckduckgo_search package - no API key required."""

    try:
        from duckduckgo_search import DDGS
    except ImportError as exc:
        raise ToolException("web_search: duckduckgo-search package not installed.") from exc

    with DDGS() as ddgs:
        raw = list(ddgs.text(query, max_results=_SEARCH_MAX_RESULTS))

    return [
        {
            "title": item.get("title", ""),
            "url": item.get("href") or item.get("url", ""),
            "snippet": item.get("body", ""),
        }
        for item in raw
    ]


def _search_tavily(query: str, api_key_env: str | None) -> list[dict]:
    """Search via langchain-tavily (opt-in dep). Requires API key in env var."""

    try:
        from langchain_tavily import TavilySearchResults  # ty: ignore[unresolved-import]
    except ImportError as exc:
        raise ToolException(
            "web_search: tavily backend requires the 'web-search-tavily' extra in the agent "
            "image (add it to install_agent.sh, then rebuild: claudebox build --layer agent).",
        ) from exc

    api_key = _api_key(api_key_env, default_env="TAVILY_API_KEY")
    searcher = TavilySearchResults(max_results=_SEARCH_MAX_RESULTS, tavily_api_key=api_key)
    raw = searcher.invoke({"query": query})

    return [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("content", ""),
        }
        for item in raw
    ]


def _search_brave(query: str, api_key_env: str | None) -> list[dict]:
    """Search via Brave Search API. Requires API key in env var."""

    api_key = _api_key(api_key_env, default_env="BRAVE_API_KEY")

    try:
        with httpx.Client(timeout=_FETCH_TIMEOUT) as client:
            response = client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": _SEARCH_MAX_RESULTS},
                headers={"X-Subscription-Token": api_key, "Accept": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise ToolException(f"web_search: Brave API error: {exc}") from exc

    return [
        {
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("description", ""),
        }
        for item in (data.get("web", {}).get("results") or [])
    ]


def _api_key(api_key_env: str | None, *, default_env: str) -> str:
    """Resolve the API key from the configured env var (falling back to provider default)."""

    env_name = api_key_env or default_env
    api_key = os.environ.get(env_name)

    if not api_key:
        raise ToolException(
            f"web_search: env var {env_name} is not set; configure it or change provider.",
        )

    return api_key


def _filter_domains(
    results: list[dict],
    allowed: list[str] | None,
    blocked: list[str] | None,
) -> list[dict]:
    """Apply allowed_domains / blocked_domains filters client-side."""

    if not allowed and not blocked:
        return results

    allowed_set = {d.lower() for d in (allowed or [])}
    blocked_set = {d.lower() for d in (blocked or [])}

    filtered: list[dict] = []

    for item in results:
        host = urlparse(item.get("url", "")).hostname or ""
        host = host.lower()

        if blocked_set and any(host == d or host.endswith("." + d) for d in blocked_set):
            continue

        if allowed_set and not any(host == d or host.endswith("." + d) for d in allowed_set):
            continue

        filtered.append(item)

    return filtered
