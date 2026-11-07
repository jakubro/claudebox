"""Stale session and temp directory cleanup."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .config import Config
from .constants import (
    HOST_TEMP_BUILD_DIR,
    HOST_TEMP_ROOT,
    HOST_TEMP_RUN_DIR,
    LABEL_RUN,
    LABEL_WORKSPACE,
    SESSIONS_DIR_NAME,
    SESSION_MAX_AGE,
    SESSION_METADATA_FILE,
    SESSION_RUN_ID_FILE,
    UI_STATE_FILE,
    UI_STATE_VERSION,
    daemon_base_url,
    daemon_config_path,
)
from .containers.backend import ContainerBackend
from .core.fs import remove_path
from .core.io import read_json
from .core.logging import get_logger
from .core.time import days_before
from .paths import parse_session_dir_name, parse_timestamped_dir_name


# Prune runs unattended on a daily timer; a hung or slow daemon must not hang it in turn.
_LIVENESS_HTTP_TIMEOUT_SECONDS = 2.0

_STOPPED_RUNTIME_STATES = frozenset(
    {"created", "configured", "exited", "stopped", "dead", "removing"},
)


@dataclass
class SweepReport:
    """Removed dirs, emptied tmp/ folders with the bytes each freed, missing workspaces, failures."""

    removed: list[Path] = field(default_factory=list)
    emptied: dict[Path, int] = field(default_factory=dict)
    missing: list[Path] = field(default_factory=list)
    failed: dict[Path, str] = field(default_factory=dict)


def cleanup_stale_dirs(config: Config) -> SweepReport:
    """Remove sessions unused past [prune] session_days and empty the tmp/ of those past tmp_days.

    Last use decides, not creation; a pinned session or one a container holds is never touched.
    Temp build/run dirs older than SESSION_MAX_AGE by creation are removed whatever else fails.
    Sweeps every registered workspace, the home directory and the workspace `config` belongs to.
    A workspace whose pins, settings or running sessions cannot be read is left whole, in `failed`.
    An unreadable registry sweeps no session at all.
    """

    report = SweepReport()

    try:
        _sweep_workspaces(config, report)
    finally:
        cutoff = datetime.now(UTC).replace(tzinfo=None) - SESSION_MAX_AGE
        report.removed.extend(_cleanup_stale_temp_dirs(cutoff))

    return report


def _sweep_workspaces(config: Config, report: SweepReport) -> None:
    try:
        registered = _registered_workspaces()
    except OSError as exc:
        report.failed[daemon_config_path()] = str(exc)

        return

    roots = [*registered, Path.home().resolve(), config.config_dir.parent.resolve()]
    listings: dict[str, list[dict]] = {}

    for root in dict.fromkeys(roots):
        if not root.is_dir():
            report.missing.append(root)
            continue

        try:
            removed, emptied = _sweep_sessions(Config.load(root), registered.get(root), listings)
        except Exception as exc:  # noqa: BLE001 - one workspace's failure must not stop the others
            report.failed[root] = str(exc)
        else:
            report.removed.extend(removed)
            report.emptied.update(emptied)


def _sweep_sessions(
    config: Config,
    workspace_id: str | None,
    listings: dict[str, list[dict]],
) -> tuple[list[Path], dict[Path, int]]:
    now = datetime.now(UTC).replace(tzinfo=None)
    session_cutoff = days_before(now, config.prune_session_days)
    tmp_cutoff = days_before(now, config.prune_tmp_days)
    pinned_ids = _pinned_session_ids(config.config_dir)

    try:
        paths = list((config.config_dir / SESSIONS_DIR_NAME).iterdir())
    except OSError:
        return [], {}

    sessions = [
        (session_id, path)
        for path in paths
        if (session_id := parse_session_dir_name(path)[1]) is not None
    ]
    held_ids = _held_session_ids(config, workspace_id, sessions, listings)
    removed: list[Path] = []
    emptied: dict[Path, int] = {}

    for session_id, path in sessions:
        if session_id in held_ids or session_id in pinned_ids:
            continue

        last_used = _session_last_used(path)

        if last_used is None:
            continue
        elif last_used < session_cutoff:
            remove_path(path)
            removed.append(path)
        elif last_used < tmp_cutoff and (freed := _empty_tmp(path)) is not None:
            emptied[path / "tmp"] = freed

    return removed, emptied


def _cleanup_stale_temp_dirs(cutoff: datetime) -> list[Path]:
    """Remove build/run temp directories older than cutoff - creation time only."""

    removed: list[Path] = []

    for root in (HOST_TEMP_BUILD_DIR, HOST_TEMP_RUN_DIR):
        if _reached_through_symlink(root):
            get_logger(__name__).warning(
                "Skipped a temp root reached through a symlink",
                root=str(root),
            )

            continue

        try:
            for path in root.iterdir():
                timestamp = parse_timestamped_dir_name(path)

                if timestamp and timestamp < cutoff:
                    remove_path(path)
                    removed.append(path)
        except OSError:
            continue

    return removed


def _session_last_used(path: Path) -> datetime | None:
    """Naive UTC last-use timestamp: the record's updated_at if readable, else the newest mtime of the
    directory and the files directly in it - a hook's log line or a new run id counts as use.
    """

    try:
        data = read_json(path / SESSION_METADATA_FILE, default=None)
    except ValueError:
        data = None

    updated_at = data.get("updated_at") if data else None

    if updated_at:
        try:
            return datetime.fromisoformat(updated_at).replace(tzinfo=None)
        except ValueError:
            pass

    try:
        with os.scandir(path) as entries:
            mtimes = [
                entry.stat(follow_symlinks=False).st_mtime
                for entry in entries
                if entry.is_file(follow_symlinks=False)
            ]

        newest = max([path.stat().st_mtime, *mtimes])
    except OSError:
        return None

    return datetime.fromtimestamp(newest, tz=UTC).replace(tzinfo=None)


def _pinned_session_ids(config_dir: Path) -> set[str]:
    """Session ids pinned in the workspace's UI state - none when the file is missing or of a version
    the daemon discards; OSError when it exists but cannot be read.
    """

    path = config_dir / UI_STATE_FILE

    try:
        data = read_json(path, default={})
    except ValueError as exc:
        raise OSError(f"cannot read the pinned sessions in {path}: {exc}") from exc

    if not isinstance(data, dict) or not isinstance(version := data.get("version", 0), int | float):
        pinned = None
    elif version < UI_STATE_VERSION:
        return set()
    else:
        global_state = data.get("global", {})
        pinned = global_state.get("pinnedSessions", []) if isinstance(global_state, dict) else None

    if not (isinstance(pinned, list) and all(isinstance(item, str) for item in pinned)):
        raise OSError(f"cannot read the pinned sessions in {path}: not the shape the app writes")

    return set(pinned)


def _held_session_ids(
    config: Config,
    workspace_id: str | None,
    sessions: list[tuple[str, Path]],
    listings: dict[str, list[dict]],
) -> set[str]:
    """Sessions a container may still hold in this workspace - OSError when that cannot be told."""

    held: set[str] = set()

    if workspace_id is not None:
        try:
            held |= _daemon_held_session_ids(workspace_id)
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            # Only the daemon knows a local session; a podman or docker one carries its workspace.
            if config.backend == "local" or any(
                labels.get(LABEL_WORKSPACE) == workspace_id
                for labels in _running_labels(config.backend, listings)
            ):
                raise OSError(
                    f"cannot tell which sessions are running in {config.work_dir}: "
                    f"the daemon did not answer ({exc})",
                ) from exc

    run_ids = {session_id: run_id for session_id, path in sessions if (run_id := _run_id(path))}

    if run_ids and config.backend != "local":
        running = {labels.get(LABEL_RUN) for labels in _running_labels(config.backend, listings)}
        held |= {session_id for session_id, run_id in run_ids.items() if run_id in running}

    return held


def _daemon_held_session_ids(workspace_id: str) -> set[str]:
    """Owner and every side conversation, live or not, of each container the daemon has not seen stop."""

    response = httpx.get(
        f"{daemon_base_url()}/api/workspaces/{workspace_id}/containers",
        verify=False,
        timeout=_LIVENESS_HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    held: set[str] = set()

    for container in response.json()["containers"]:
        if container["status"] != "stopped":
            held.update(filter(None, [container["session_id"], *container["members"]]))

    return held


def _running_labels(backend: str, listings: dict[str, list[dict]]) -> list[dict]:
    if backend not in listings:
        try:
            containers = ContainerBackend(backend).list_containers()
        except (subprocess.SubprocessError, OSError, ValueError) as exc:
            raise OSError(f"cannot list the {backend} containers: {exc}") from exc

        if not (
            isinstance(containers, list)
            and all(
                isinstance(container, dict) and isinstance(container.get("Labels") or {}, dict)
                for container in containers
            )
        ):
            raise OSError(
                f"cannot read the {backend} container listing: not the shape podman writes",
            )

        listings[backend] = [
            container.get("Labels") or {}
            for container in containers
            if container.get("State") not in _STOPPED_RUNTIME_STATES
        ]

    return listings[backend]


def _run_id(session: Path) -> str | None:
    try:
        return (session / SESSION_RUN_ID_FILE).read_text(encoding="utf-8").strip() or None
    except (FileNotFoundError, NotADirectoryError):
        return None


def _empty_tmp(session: Path) -> int | None:
    """Empty the session's tmp/ but keep it; return the bytes freed, or None when it held nothing.

    A link is never followed: the session's own container can write it.
    """

    tmp = session / "tmp"

    if session.is_symlink() or tmp.is_symlink():
        return None

    try:
        entries = list(tmp.iterdir())
    except OSError:
        return None

    if not entries:
        return None

    before = _disk_usage(tmp)

    for entry in entries:
        remove_path(entry)

    return before - _disk_usage(tmp)


def _disk_usage(root: Path) -> int:
    seen: set[tuple[int, int]] = set()
    total = 0

    for directory, dirnames, filenames in root.walk():
        for name in (*dirnames, *filenames):
            try:
                stat = (directory / name).lstat()
            except OSError:
                continue

            if (stat.st_dev, stat.st_ino) not in seen:
                seen.add((stat.st_dev, stat.st_ino))
                total += stat.st_blocks * 512

    return total


def _registered_workspaces() -> dict[Path, str]:
    """Registered workspaces by resolved path to id; empty with no registry, OSError when unreadable."""

    path = daemon_config_path()

    try:
        data = read_json(path, default={})
    except ValueError as exc:
        raise OSError(f"cannot read the registered workspaces in {path}: {exc}") from exc

    workspaces = data.get("workspaces", []) if isinstance(data, dict) else None

    if not (
        isinstance(workspaces, list)
        and all(
            isinstance(entry, dict)
            and isinstance(entry.get("path"), str)
            and isinstance(entry.get("id"), str)
            for entry in workspaces
        )
    ):
        raise OSError(
            f"cannot read the registered workspaces in {path}: not the shape the daemon writes",
        )

    return {Path(entry["path"]).resolve(): entry["id"] for entry in workspaces}


def _reached_through_symlink(root: Path) -> bool:
    # Anyone on the host can create /tmp/claudebox first; a followed link aims the prune at them.
    tmp = HOST_TEMP_ROOT.parent
    between = [root, *(p for p in root.parents if tmp in p.parents)]

    return any(path.is_symlink() for path in between)
