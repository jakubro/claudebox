"""LangGraph tool surface - public aggregator over per-subscope tool factories.

Runtime-private sub-package. `runtime_langgraph.connect()` calls
`make_tools(ctx)` exactly once, after the chat model is built and ToolContext
is populated. The aggregator binds every family's `@tool`-decorated functions
into the create_agent tool list.

Modules (extended as later subscopes ship):
- filesystem / search / shell / notebook / web -- simple ports
- _middleware                                  -- ClaudeboxToolHookMiddleware
- subagent                                     -- task dispatcher
- task_mgmt                                    -- agentic task list
- question                                     -- AskUserQuestion via interrupt
- worktree                                     -- git worktree manager
- scheduling                                   -- daemon scheduler client
- skill                                        -- workspace skill catalog
- meta                                         -- tool_search self-discovery
- mcp                                          -- langchain-mcp-adapters bridge
"""

from langchain_core.tools import BaseTool

from ._context import ToolCatalog, ToolContext
from .filesystem import make_filesystem_tools
from .mcp import make_mcp_tools
from .meta import make_meta_tools
from .notebook import make_notebook_tools
from .question import make_question_tools
from .search import make_search_tools
from .shell import make_shell_tools
from .skill import make_skill_tools
from .subagent import make_subagent_tools
from .task_mgmt import make_task_mgmt_tools
from .web import make_web_tools


def make_tools(ctx: ToolContext) -> list[BaseTool]:
    """Aggregate every subscope's tool factories into the bound tool list.

    New families append their `make_*_tools(ctx)` line below as they ship.
    """

    return [
        *make_filesystem_tools(ctx),
        *make_search_tools(ctx),
        *make_shell_tools(ctx),
        *make_notebook_tools(ctx),
        *make_web_tools(ctx),
        *make_subagent_tools(ctx),
        *make_task_mgmt_tools(ctx),
        *make_question_tools(ctx),
        *make_skill_tools(ctx),
        *make_meta_tools(ctx),
        *make_mcp_tools(ctx),
    ]


__all__ = ["ToolCatalog", "ToolContext", "make_tools"]
