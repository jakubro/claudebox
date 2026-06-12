"""Self-discovery meta-tool - tool_search ranks the bound registry by keyword.

LangGraph binds every tool at graph construction (no deferred-loading like
Claude's ToolSearch), so tool_search is purely a discovery aid: the model
queries it to find tools whose name or description matches a keyword, then
invokes the discovered tool directly. ARCHITECTURE.md A1.4 captures the
semantic divergence so future implementers do not graft deferred-loading on
top.

Reads `ctx.tool_catalog.tools` at INVOKE time (the catalog-after-
aggregation pattern). The runtime populates the catalog AFTER make_tools()
returns, so the closure sees the full bound set lazily - including
tool_search itself, which is correct (the model can rediscover the meta-tool).
"""

from langchain_core.tools import BaseTool, tool

from ._context import ToolContext


_DESCRIPTION_CAP = 200


def make_meta_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the tool_search self-discovery meta-tool.

    Closes over ctx.tool_catalog so .tools is read at invoke time. The
    runtime populates the catalog after make_tools(ctx) returns; reading
    at closure-build time would see an empty list.
    """

    catalog = ctx.tool_catalog

    @tool
    def tool_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
        """Search the workspace tool registry by keyword (case-insensitive).

        Returns up to `max_results` tools whose name or description contains
        `query`. Name matches score 3x description matches. All listed tools
        are already bound - call them directly by name. Returns an empty list
        when nothing matches.
        """

        q = query.lower()

        if not q:
            return []

        hits: list[tuple[int, dict[str, str]]] = []

        for tool_obj in catalog.tools:
            name = (tool_obj.name or "").lower()
            description = tool_obj.description or ""
            score = 3 * name.count(q) + description.lower().count(q)

            if score:
                hits.append(
                    (
                        score,
                        {
                            "name": tool_obj.name or "",
                            "description": description[:_DESCRIPTION_CAP],
                        },
                    )
                )

        hits.sort(key=lambda entry: -entry[0])

        return [record for _, record in hits[:max_results]]

    return [tool_search]


__all__ = ["make_meta_tools"]
