"""Constants and paths for the claudebox runtime."""

import os
from datetime import timedelta
from pathlib import Path


# Project
# -------------------------------------

REPOSITORY_URL = "https://github.com/jakubro/claudebox"

LICENSE = """\
Copyright (C) 2025-2026  Jakub Roman

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
"""


# Paths: Config
# -------------------------------------
#
# Home-derived paths are accessor functions, not module-level constants -
# evaluating Path.home() at import time freezes the resolved path and silently
# defeats Path.home monkeypatching in tests. See GUIDELINES.md "Home-derived
# paths" for the contract.

CONFIG_DIR_NAME = ".claudebox"  # per-workspace and home config directory
CLAUDEBOX_SETTINGS_FILE = f"{CONFIG_DIR_NAME}/settings.toml"  # relative to workspace or home
PROFILE_BUILD_HOOK_PATH = "hooks/image-build.sh"  # profile hook for container builds


def global_config_dir() -> Path:
    """Per-user claudebox config directory: ~/.claudebox/"""

    return Path.home() / CONFIG_DIR_NAME


def profile_dir() -> Path:
    """Installed Claude Code profile directory: ~/.claudebox/profile/"""

    return global_config_dir() / "profile"


def daemon_config_path() -> Path:
    """Daemon config file: ~/.claudebox/daemon.json"""

    return global_config_dir() / "daemon.json"


def caddy_binary_path() -> Path:
    """Caddy reverse-proxy binary: ~/.claudebox/bin/caddy"""

    return global_config_dir() / "bin" / "caddy"


# Paths: SDK
# -------------------------------------


def claude_config_dir() -> Path:
    """Claude SDK config directory: ~/.claude/"""

    return Path.home() / ".claude"


def claude_settings_file() -> Path:
    """Claude SDK user settings file: ~/.claude/settings.json"""

    return claude_config_dir() / "settings.json"


def claude_commands_dir() -> Path:
    """User-defined slash commands directory: ~/.claude/commands/"""

    return claude_config_dir() / "commands"


def claude_skills_dir() -> Path:
    """User-defined skills directory: ~/.claude/skills/"""

    return claude_config_dir() / "skills"


# Paths: Workspace
# -------------------------------------

WORKSPACE_MARKER = ".workspace"  # walk-up marker for workspace root
HOST_CLAUDE_DIR_SUBPATH = "fs/root/.claude"  # Claude config dir under config_dir
HOST_CLAUDE_JSON_SUBPATH = "fs/root/.claude.json"  # Claude config file under config_dir


# Paths: Lib
# -------------------------------------

_SCRIPT_PATH = Path(__file__).resolve()

LIB_ROOT = _SCRIPT_PATH.parent.parent.parent
LIB_BUILD_DIR = LIB_ROOT / "container/build"  # Containerfile + build context
LIB_RUN_DIR = LIB_ROOT / "container/run"  # runtime overlay mounts

CORE_DIR = LIB_ROOT / "src/claudebox"
CONTAINER_API_DIR = LIB_ROOT / "src/claudebox_container_api"
DAEMON_DIR = LIB_ROOT / "src/claudebox_daemon"
FRONTEND_DIR = LIB_ROOT / "src/claudebox_frontend"

FRONTEND_DIST_DIR = FRONTEND_DIR / "dist"


# Paths: Temp
# -------------------------------------

HOST_TEMP_ROOT = Path("/tmp/claudebox")
HOST_TEMP_BUILD_DIR = HOST_TEMP_ROOT / "build"
HOST_TEMP_RUN_DIR = HOST_TEMP_ROOT / "run"


# Paths: Container
# -------------------------------------

CONTAINER_CLAUDEBOX_ROOT = Path("/root/.claudebox")
CONTAINER_LIB_MOUNT = CONTAINER_CLAUDEBOX_ROOT / "lib"
CONTAINER_PROFILE_MOUNT = CONTAINER_CLAUDEBOX_ROOT / "profile"
CONTAINER_SESSIONS_MOUNT = CONTAINER_CLAUDEBOX_ROOT / "sessions"
CONTAINER_CLAUDE_DIR_MOUNT = Path("/root/.claude")
CONTAINER_CLAUDE_JSON_MOUNT = Path("/root/.claude.json")


# Container image
# -------------------------------------

CONTAINER_IMAGE_NAME = "claudebox"

DEFAULT_LABELS = {"app": "claudebox"}
LABEL_DAEMON_MANAGED = "claudebox-daemon-managed"
LABEL_ID = "claudebox-id"
LABEL_WORKSPACE = "claudebox-workspace"

NETWORK_NAME_TEMPLATE = "claudebox-{workspace_id}-net"


# Defaults
# -------------------------------------

DEFAULT_AGENT = "claude"
DEFAULT_BACKEND = "podman"
WEB_CONTAINER_PORT = 8080
DAEMON_PORT = 41820
DAEMON_DEV_PORT = 41920
GIT_SUBPROCESS_TIMEOUT = timedelta(seconds=5)


def daemon_base_url() -> str:
    """Daemon HTTP base URL - honors CLAUDEBOX_DAEMON_URL env override.

    Called at handler time so test fixtures can mutate the env before the
    CLI binds the URL. Empty env value falls back to the canonical default.
    """

    return os.environ.get("CLAUDEBOX_DAEMON_URL") or f"https://localhost:{DAEMON_PORT}"


# Session
# -------------------------------------

SESSION_MAX_AGE = timedelta(days=365)  # stale threshold for cleanup
SESSIONS_DIR_NAME = "sessions"  # subdirectory under config_dir
SESSION_METADATA_FILE = "session.json"  # per-session metadata file
SESSION_EVENTS_FILE = "events.jsonl"  # per-session event log
SESSION_ATTACHMENTS_DIR = "attachments"  # per-session attachment files

# Size limits
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB per attachment
MAX_TOOL_OUTPUT_SIZE = 100 * 1024  # 100 KB per tool output payload
SDK_PROCESS_BUFFER_SIZE = 1024 * 1024 * 1024  # 1 GB stdio buffer for the SDK subprocess


# Logging
# -------------------------------------

USER_LOG_FILENAME = "user.log"  # per-session log file name


def daemon_log_dir() -> Path:
    """Daemon log directory: ~/.claudebox/logs/"""

    return global_config_dir() / "logs"
