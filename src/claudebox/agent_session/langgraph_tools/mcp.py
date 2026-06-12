"""MCP resource tools - list_mcp_resources + read_mcp_resource.

Bridges Model Context Protocol servers (configured per workspace under
`[langgraph.mcp.<name>]`) into the LangGraph tool surface. Three pieces:

1. Per-server tool binding lives on the runtime (`runtime_langgraph.connect()`
   defensively fetches `get_tools(server_name=...)` per server and appends to
   the graph's tool list; failures land in `runtime._mcp_failures`).
2. `list_mcp_resources()` (here) aggregates resources across all configured
   servers via the shared MultiServerMCPClient.
3. `read_mcp_resource(uri)` (here) fetches the named resource. URI->server
   routing is best-effort: the tool tries each connected server in turn and
   returns the first match.

Returns an empty list when no MCP servers are configured (the runtime
populates ctx.mcp_client to None in that case) so the model encounters a
no-op rather than a crash.
"""

from typing import Any

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext


def make_mcp_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind list_mcp_resources + read_mcp_resource @tool functions.

    Closes over ctx.mcp_client. When no MCP servers are configured the
    client is None - the tools still bind (uniform make_*_tools signature)
    but raise ToolException when invoked, telling the model
    no servers are configured rather than crashing.
    """

    client = ctx.mcp_client

    @tool
    async def list_mcp_resources() -> list[dict[str, Any]]:
        """List resources exposed by every connected MCP server.

        Returns a flat list of `{server, uri, name, description, mimetype}`
        dicts. The `server` field tags each entry with its source so the
        model can route `read_mcp_resource(uri)` calls deterministically.
        Returns an empty list when no MCP servers are configured.
        """

        if client is None:
            return []

        results: list[dict[str, Any]] = []

        for server_name in client.connections:
            try:
                blobs = await client.get_resources(server_name=server_name)
            except Exception as exc:  # noqa: BLE001 - defensive perimeter
                # One bad server must not poison the others (upstream #492).
                results.append({"server": server_name, "error": str(exc)})
                continue

            for blob in blobs:
                results.append(_project_blob(blob, server_name))

        return results

    @tool
    async def read_mcp_resource(uri: str) -> str:
        """Fetch the MCP resource at `uri` and return its content as text.

        Tries each connected server in turn; returns the first successful
        read. Raises ToolException when no server can resolve the URI.
        """

        if client is None:
            raise ToolException(
                "read_mcp_resource: no MCP servers configured for this workspace; "
                "add `[langgraph.mcp.<name>]` block to settings.toml to enable."
            )

        last_error: str | None = None

        for server_name in client.connections:
            try:
                blobs = await client.get_resources(server_name=server_name, uris=uri)
            except Exception as exc:  # noqa: BLE001 - try the next server
                last_error = f"{server_name}: {exc}"
                continue

            if blobs:
                content = blobs[0].data

                if isinstance(content, bytes):
                    return content.decode("utf-8", errors="replace")
                elif isinstance(content, str):
                    return content
                else:
                    return str(content)

        raise ToolException(
            f"read_mcp_resource: no server resolved {uri!r}; last error: {last_error}"
        )

    return [list_mcp_resources, read_mcp_resource]


def _project_blob(blob: Any, server_name: str) -> dict[str, Any]:
    """Project a langchain_core.documents.base.Blob into the list_mcp_resources shape."""

    metadata = getattr(blob, "metadata", None) or {}

    return {
        "server": server_name,
        "uri": metadata.get("uri") or blob.id or "",
        "name": metadata.get("name") or "",
        "description": metadata.get("description") or "",
        "mimetype": getattr(blob, "mimetype", None) or metadata.get("mimetype") or "",
    }


__all__ = ["make_mcp_tools"]
