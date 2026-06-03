"""Claudebox runtime library — shared utilities for hooks, sessions, and I/O."""

from . import constants
from .agent_session.catalogs import (
    ContextUsage,
    EffortLevel,
    EffortLevelId,
    Model,
    PermissionMode,
    PermissionModeId,
    Skill,
)
from .agent_session.config import AgentSessionConfig, ClaudeAgentSessionConfig, RuntimeCapabilities
from .agent_session.errors import UnknownRuntime
from .agent_session.events import AgentEvent
from .agent_session.hooks import HookCallbacks
from .agent_session.orchestration.errors import SessionNotReady
from .agent_session.orchestration.session import SessionService
from .agent_session.protocol import AgentSession
from .agent_session.runtime_claude import ClaudeRuntime
from .agent_session.session import make_agent_session
from .cleanup import cleanup_stale_dirs
from .cli import epilog, format_install_info, get_install_info
from .config import Config
from .containers import create_runtime
from .containers.models import ImageBuildMode
from .containers.runtime import ContainerRuntime
from .core import serialization
from .core.broadcaster import Broadcaster
from .core.cli import HelpFormatter, cli, console, print_command, print_error
from .core.concurrency import maybe_awaitable
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
from .core.logging import (
    close_log_file,
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
from .paths import make_timestamped_dir_prefix
from .session.models import SessionMetadata, SessionNotFound
from .session.repository import SessionRepository
from .session.session import Session
from .temp import ensure_tmp, restore_tmp
from .user.hook import HookRequest, HookResponse, hook
from .user.request import Request
from .user.statusline import StatuslineRequest, statusline
from .workspace import Workspace
