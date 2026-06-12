"""Web tools - web_fetch, web_search.

web_fetch converts HTML to markdown via markdownify with a 100 KB cap and a
30s timeout. web_search dispatches by `ctx.config.web_search_provider`
(default duckduckgo; tavily/brave opt-in via
`[project.optional-dependencies] web-search-tavily`). Network reach is
documented in the README.
"""

import os
from urllib.parse import urlparse

import httpx
from langchain_core.tools import BaseTool, ToolException, tool
from markdownify import markdownify

from ._context import ToolContext


_FETCH_CAP = 100 * 1024
_FETCH_TIMEOUT = 30
_SEARCH_MAX_RESULTS = 10
_FETCH_TRUNCATED = "\n... (truncated at 100 KB)\n"


def make_web_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind web_fetch + web_search closed over the workspace web-search config."""

    provider = ctx.config.web_search_provider
    api_key_env = ctx.config.web_search_api_key_env

    @tool
    def web_fetch(url: str, prompt: str = "") -> str:
        """Fetch `url`; HTML is converted to plain text and capped at 100 KB.

        `prompt` is accepted for Claude API parity but ignored - the model can
        summarise the returned text in-context.
        """

        del prompt  # accepted for parity; v1 returns raw text for in-context use

        try:
            with httpx.Client(timeout=_FETCH_TIMEOUT, follow_redirects=True) as client:
                response = client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ToolException(f"web_fetch: HTTP error fetching {url}: {exc}") from exc

        content_type = response.headers.get("content-type", "")
        body = response.text
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
        """Search the web for `query`. Returns up to 10 results.

        Each result has `title`, `url`, and `snippet`. Optional
        `allowed_domains` / `blocked_domains` filter results client-side.
        Backend is the workspace's `[langgraph.web_search] provider` (default
        duckduckgo).
        """

        results = _dispatch_search(query, provider, api_key_env)

        return _filter_domains(results, allowed_domains, blocked_domains)

    return [web_fetch, web_search]


def _dispatch_search(query: str, provider: str, api_key_env: str | None) -> list[dict]:
    """Route the search query to the configured backend."""

    if provider == "duckduckgo":
        return _search_duckduckgo(query)

    if provider == "tavily":
        return _search_tavily(query, api_key_env)

    if provider == "brave":
        return _search_brave(query, api_key_env)

    raise ToolException(
        f"web_search: unknown provider {provider!r}; expected one of duckduckgo, tavily, brave."
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
            "image (add it to install_agent.sh, then rebuild: claudebox build --layer agent)."
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
            f"web_search: env var {env_name} is not set; configure it or change provider."
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
