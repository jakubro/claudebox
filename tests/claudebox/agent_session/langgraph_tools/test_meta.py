"""meta.py @tool tests - tool_search keyword discovery over ctx.tool_catalog."""

from dataclasses import replace

from langchain_core.tools import BaseTool, tool

from claudebox.agent_session.langgraph_tools import ToolCatalog
from claudebox.agent_session.langgraph_tools.meta import make_meta_tools


def _stub(name: str, description: str) -> BaseTool:
    """Build a minimal @tool-decorated function with the given name + description."""

    @tool(name, description=description)
    def _impl() -> str:
        return ""

    return _impl


def _ctx_with_catalog(tool_ctx, tools: list[BaseTool]):
    """Return tool_ctx with a populated ToolCatalog so tool_search reads non-empty."""

    catalog = ToolCatalog()
    catalog.tools.extend(tools)

    return replace(tool_ctx, tool_catalog=catalog)


class TestMakeMetaTools:
    def test_returns_single_tool_search_tool(self, tool_ctx):
        tools = make_meta_tools(tool_ctx)

        assert [t.name for t in tools] == ["tool_search"]


class TestToolSearch:
    def test_matches_by_name(self, tool_ctx):
        ctx = _ctx_with_catalog(
            tool_ctx,
            [
                _stub("read_file", "Read a text file"),
                _stub("write_file", "Write a text file"),
                _stub("bash", "Run a shell command"),
            ],
        )
        tool_search = make_meta_tools(ctx)[0]

        results = tool_search.invoke({"query": "file"})

        names = [r["name"] for r in results]
        assert "read_file" in names
        assert "write_file" in names
        # name matches outrank description matches; file appears 1x in name (score 3 each)
        # and 1x in description (score 1) so combined score is 4 for both file tools.

    def test_matches_by_description(self, tool_ctx):
        ctx = _ctx_with_catalog(
            tool_ctx,
            [
                _stub("bash", "Run a shell command via /bin/bash -c"),
                _stub("notebook_edit", "Edit a Jupyter notebook cell"),
            ],
        )
        tool_search = make_meta_tools(ctx)[0]

        results = tool_search.invoke({"query": "jupyter"})

        assert [r["name"] for r in results] == ["notebook_edit"]

    def test_no_match_returns_empty_list(self, tool_ctx):
        ctx = _ctx_with_catalog(
            tool_ctx,
            [_stub("bash", "Run a shell command")],
        )
        tool_search = make_meta_tools(ctx)[0]

        results = tool_search.invoke({"query": "nonexistent-keyword-zzz"})

        assert results == []

    def test_empty_query_returns_empty_list(self, tool_ctx):
        ctx = _ctx_with_catalog(
            tool_ctx,
            [_stub("read_file", "Read a file")],
        )
        tool_search = make_meta_tools(ctx)[0]

        assert tool_search.invoke({"query": ""}) == []

    def test_max_results_caps_output(self, tool_ctx):
        tools = [_stub(f"tool_{i:02d}", f"description {i} keyword") for i in range(10)]
        ctx = _ctx_with_catalog(tool_ctx, tools)
        tool_search = make_meta_tools(ctx)[0]

        results = tool_search.invoke({"query": "keyword", "max_results": 3})

        assert len(results) == 3

    def test_returns_truncated_description(self, tool_ctx):
        ctx = _ctx_with_catalog(
            tool_ctx,
            [_stub("bigtool", "match " + "x" * 500)],
        )
        tool_search = make_meta_tools(ctx)[0]

        results = tool_search.invoke({"query": "match"})

        assert len(results[0]["description"]) == 200

    def test_name_match_outranks_description_match(self, tool_ctx):
        ctx = _ctx_with_catalog(
            tool_ctx,
            [
                _stub("file_handler", "Generic operation"),
                _stub("bash", "Run a file utility"),
            ],
        )
        tool_search = make_meta_tools(ctx)[0]

        results = tool_search.invoke({"query": "file"})

        # name-match (score 3) outranks description-match (score 1).
        assert results[0]["name"] == "file_handler"

    def test_case_insensitive_match(self, tool_ctx):
        ctx = _ctx_with_catalog(
            tool_ctx,
            [_stub("READ_FILE", "Read a TEXT file")],
        )
        tool_search = make_meta_tools(ctx)[0]

        # Query in different case still hits.
        assert tool_search.invoke({"query": "read"})[0]["name"] == "READ_FILE"
        assert tool_search.invoke({"query": "text"})[0]["name"] == "READ_FILE"
