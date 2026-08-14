"""MCP resource tools - list_mcp_resources + read_mcp_resource.

Bridges MCP servers (configured per workspace under `[langgraph.mcp.<name>]`) into the LangGraph
tool surface. Per-server tool binding lives on the runtime (`runtime_langgraph.connect()` fetches
`get_tools()` per server; failures land in `runtime._mcp_failures`). The two tools here aggregate
resources across servers via the shared `MultiServerMCPClient`; `read_mcp_resource`'s uri->server
routing is best-effort (see its own docstring). Both return empty/raise rather than crash when no
MCP servers are configured (the runtime leaves `ctx.mcp_client` as None in that case).
"""

from typing import Any

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext


def make_mcp_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind list_mcp_resources + read_mcp_resource @tool functions.

    Closes over `ctx.mcp_client`; when no MCP servers are configured it stays None, so the tools
    still bind (uniform `make_*_tools` signature) but raise `ToolException` when invoked.
    """

    client = ctx.mcp_client

    @tool
    async def list_mcp_resources() -> list[dict[str, Any]]:
        """List resources exposed by every connected MCP server.

        Returns a flat list of `{server, uri, name, description, mimetype}` dicts; `server` tags
        each entry with its source so the model can route `read_mcp_resource(uri)` deterministically.
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

        Tries each connected server in turn and returns the first successful read; raises
        `ToolException` if none resolves the URI.
        """

        if client is None:
            raise ToolException(
                "read_mcp_resource: no MCP servers configured for this workspace; "
                "add `[langgraph.mcp.<name>]` block to settings.toml to enable.",
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
            f"read_mcp_resource: no server resolved {uri!r}; last error: {last_error}",
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
