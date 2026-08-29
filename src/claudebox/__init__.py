"""Claudebox runtime library - shared utilities for hooks, sessions, and I/O.

Re-exports resolve lazily (PEP 562): eager ones pulled the agent SDK, the web-server stack
and the container runtime into every CLI invocation. See ARCHITECTURE.md, "CLI cold path".
"""

from importlib import import_module
from typing import TYPE_CHECKING


if TYPE_CHECKING:
    from . import constants
    from .agent_session._registry import resolve_runtime_class
    from .agent_session.catalogs import (
        ContextUsage,
        EffortLevel,
        EffortLevelId,
        Model,
        PermissionMode,
        PermissionModeId,
        Skill,
    )
    from .agent_session.config import (
        AgentSessionConfig,
        ClaudeAgentSessionConfig,
        RuntimeCapabilities,
    )
    from .agent_session.errors import UnknownRuntime
    from .agent_session.events import AgentEvent
    from .agent_session.hooks import HookCallbacks
    from .agent_session.orchestration.conversion import serialize_event
    from .agent_session.orchestration.errors import (
        SessionEntryNotFound,
        SessionNotReady,
        ValidationError,
    )
    from .agent_session.orchestration.models import EventSubtype, EventType
    from .agent_session.orchestration.persistence import EventLog
    from .agent_session.orchestration.session import SessionService
    from .agent_session.protocol import AgentSession
    from .agent_session.rate_limits import RateLimitStore
    from .agent_session.runtime_claude import ClaudeRuntime
    from .agent_session.session import make_agent_session
    from .cleanup import cleanup_stale_dirs
    from .config import Config
    from .containers import create_runtime
    from .containers.models import ImageBuildMode
    from .containers.runtime import ContainerRuntime
    from .core import serialization
    from .core.broadcaster import Broadcaster
    from .core.cli import (
        HelpFormatter,
        LazyEpilogParser,
        cli,
        console,
        print_command,
        print_error,
    )
    from .core.concurrency import SingleFlight, maybe_awaitable
    from .core.file_cache import FileCache
    from .core.fs import (
        find_files,
        make_temp_dir,
        remove_path,
        resolve_path,
        touch_dir,
        touch_file,
        walk_filtered,
        walk_up,
    )
    from .core.http import (
        AsyncBroadcastEventSource,
        BroadcastEventSource,
        BroadcastEventSourceResponse,
        JSONResponse,
        ProxyBufferedResponse,
        ProxyClient,
        ProxyStreamingResponse,
        http_serve,
    )
    from .core.io import (
        append_json,
        append_text,
        calculate_hash,
        count_lines,
        read_json,
        read_jsonl,
        read_toml,
        write_json,
        write_text,
    )
    from .core.log_rendering import render_event
    from .core.logging import (
        configure_logging,
        get_logger,
        use_log_file,
        use_rotating_log_file,
    )
    from .core.polling import AsyncPoller, MtimeWatcher
    from .core.string import wrap_box
    from .core.structures import DataClass, invert, merge
    from .core.time import TIMESTAMP_FORMAT, get_timestamp, parse_timestamp
    from .env import is_dev_mode, set_dev_mode
    from .errors import ApiError
    from .install import epilog, format_install_info, get_install_info
    from .paths import make_timestamped_dir_prefix
    from .session.models import SessionMetadata, SessionNotFound
    from .session.repository import SessionRepository
    from .session.session import Session
    from .temp import ensure_tmp
    from .user.hook import HookRequest, HookResponse, hook
    from .user.request import Request
    from .user.statusline import StatuslineRequest, statusline
    from .workspace import Workspace


# Submodules re-exported under a shorter name.
_SUBMODULES = {
    "constants": "constants",
    "serialization": "core.serialization",
}

# Defining module (relative to this package) for each re-exported name.
_EXPORTS_BY_MODULE = {
    "agent_session._registry": ("resolve_runtime_class",),
    "agent_session.catalogs": (
        "ContextUsage",
        "EffortLevel",
        "EffortLevelId",
        "Model",
        "PermissionMode",
        "PermissionModeId",
        "Skill",
    ),
    "agent_session.config": (
        "AgentSessionConfig",
        "ClaudeAgentSessionConfig",
        "RuntimeCapabilities",
    ),
    "agent_session.errors": ("UnknownRuntime",),
    "agent_session.events": ("AgentEvent",),
    "agent_session.hooks": ("HookCallbacks",),
    "agent_session.orchestration.conversion": ("serialize_event",),
    "agent_session.orchestration.errors": (
        "SessionEntryNotFound",
        "SessionNotReady",
        "ValidationError",
    ),
    "agent_session.orchestration.models": ("EventSubtype", "EventType"),
    "agent_session.orchestration.persistence": ("EventLog",),
    "agent_session.orchestration.session": ("SessionService",),
    "agent_session.protocol": ("AgentSession",),
    "agent_session.rate_limits": ("RateLimitStore",),
    "agent_session.runtime_claude": ("ClaudeRuntime",),
    "agent_session.session": ("make_agent_session",),
    "cleanup": ("cleanup_stale_dirs",),
    "install": ("epilog", "format_install_info", "get_install_info"),
    "config": ("Config",),
    "containers": ("create_runtime",),
    "containers.models": ("ImageBuildMode",),
    "containers.runtime": ("ContainerRuntime",),
    "core.broadcaster": ("Broadcaster",),
    "core.cli": (
        "HelpFormatter",
        "LazyEpilogParser",
        "cli",
        "console",
        "print_command",
        "print_error",
    ),
    "core.concurrency": ("SingleFlight", "maybe_awaitable"),
    "core.file_cache": ("FileCache",),
    "core.fs": (
        "find_files",
        "make_temp_dir",
        "remove_path",
        "resolve_path",
        "touch_dir",
        "touch_file",
        "walk_filtered",
        "walk_up",
    ),
    "core.http": (
        "AsyncBroadcastEventSource",
        "BroadcastEventSource",
        "BroadcastEventSourceResponse",
        "JSONResponse",
        "ProxyBufferedResponse",
        "ProxyClient",
        "ProxyStreamingResponse",
        "http_serve",
    ),
    "core.io": (
        "append_json",
        "append_text",
        "calculate_hash",
        "count_lines",
        "read_json",
        "read_jsonl",
        "read_toml",
        "write_json",
        "write_text",
    ),
    "core.log_rendering": ("render_event",),
    "core.logging": (
        "configure_logging",
        "get_logger",
        "use_log_file",
        "use_rotating_log_file",
    ),
    "core.polling": ("AsyncPoller", "MtimeWatcher"),
    "core.string": ("wrap_box",),
    "core.structures": ("DataClass", "invert", "merge"),
    "core.time": ("TIMESTAMP_FORMAT", "get_timestamp", "parse_timestamp"),
    "env": ("is_dev_mode", "set_dev_mode"),
    "errors": ("ApiError",),
    "paths": ("make_timestamped_dir_prefix",),
    "session.models": ("SessionMetadata", "SessionNotFound"),
    "session.repository": ("SessionRepository",),
    "session.session": ("Session",),
    "temp": ("ensure_tmp",),
    "user.hook": ("HookRequest", "HookResponse", "hook"),
    "user.request": ("Request",),
    "user.statusline": ("StatuslineRequest", "statusline"),
    "workspace": ("Workspace",),
}

_EXPORTS = {name: module for module, names in _EXPORTS_BY_MODULE.items() for name in names}

__all__ = [*_SUBMODULES, *_EXPORTS.keys()]  # noqa: PLE0604 - both dicts are keyed by str literals


def __getattr__(name: str):
    """Import the defining submodule on first access and cache the result (PEP 562)."""

    if submodule := _SUBMODULES.get(name):
        value = import_module(f".{submodule}", __name__)
    elif module := _EXPORTS.get(name):
        value = getattr(import_module(f".{module}", __name__), name)
    else:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

    globals()[name] = value

    return value


def __dir__() -> list[str]:
    return sorted(__all__)
