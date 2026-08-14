"""ToolContext + ToolCatalog - dependency-injection bundle threaded through every tool factory.

`ToolContext` is built once in `runtime_langgraph.connect()` after the chat model materialises;
tool factories receive it via `make_*_tools(ctx)` and close over it.

`ToolCatalog` wraps the bound-tool list in a mutable container, populated after `make_tools()` returns.
A self-discovery tool reads the full catalog at invoke time without a second registration pass.
Mutability is contained here; the enclosing `ToolContext` stays frozen.

Subscope-owned fields (agent_registry, daemon_services, mcp_client, ...) land on `ToolContext`
extensions as later families ship, each with a safe default so no family needs to know about the others.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool

from .._agent_registry import AgentRegistry
from .._daemon_services import DaemonServiceBundle
from ..config import LangGraphAgentSessionConfig
from ..hooks import HookCallbacks


if TYPE_CHECKING:
    from langchain_mcp_adapters.client import MultiServerMCPClient


@dataclass
class ToolCatalog:
    """Mutable wrapper around the bound-tool list."""

    tools: list[BaseTool] = field(default_factory=list)


@dataclass(frozen=True)
class ToolContext:
    """Frozen DI bundle. Universal fields always populated."""

    workspace_path: Path
    session_id: str
    session_dir: Path
    config: LangGraphAgentSessionConfig
    hooks: HookCallbacks
    logger: Any
    tool_catalog: ToolCatalog

    # Per-tool-family fields, alphabetical order to avoid conflicts on parallel adds.
    agent_registry: AgentRegistry | None = None
    chat_model_factory: Callable[[], BaseChatModel] | None = None
    daemon_services: DaemonServiceBundle | None = None
    mcp_client: "MultiServerMCPClient | None" = None
    record_subagent_usage: Callable[[int, int], None] | None = None
    subagent_depth: int = 0
