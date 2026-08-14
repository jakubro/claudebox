"""Self-discovery meta-tool - tool_search ranks the bound registry by keyword.

LangGraph binds every tool at graph construction (no deferred-loading like Claude's ToolSearch),
so tool_search is a discovery aid: the model queries it, then calls the found tool directly.
ARCHITECTURE.md A1.4 records this divergence for future implementers.

The catalog populates after make_tools() returns, so the closure sees the full bound set lazily,
including tool_search itself - letting the model rediscover it.
"""

from langchain_core.tools import BaseTool, tool

from ._context import ToolContext


_DESCRIPTION_CAP = 200


def make_meta_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the tool_search self-discovery meta-tool.

    Closes over ctx.tool_catalog so .tools is read at invoke time, not closure-build time - the
    catalog is empty until make_tools(ctx) returns.
    """

    catalog = ctx.tool_catalog

    @tool
    def tool_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
        """Search the workspace tool registry by keyword (case-insensitive).

        Returns up to `max_results` tools whose name or description contains `query`; name
        matches score 3x description matches. Listed tools are already bound - call by name.
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
                    ),
                )

        hits.sort(key=lambda entry: -entry[0])

        return [record for _, record in hits[:max_results]]

    return [tool_search]


__all__ = ["make_meta_tools"]
