"""argcomplete completers for the claudebox CLI - workspace ids and container targets.

Completers run inside argcomplete's completion subprocess. They MUST be
exception-safe (return whatever was resolved, never raise) and MUST NOT write to
stdout/stderr - any stray output corrupts argcomplete's fd-8 completion stream.
"""

import json

import httpx

from claudebox.constants import daemon_base_url, daemon_config_path


# Short, fixed timeout: a TAB press must stay responsive even when the daemon is down.
_COMPLETION_HTTP_TIMEOUT = httpx.Timeout(1.5)


def complete_workspace_id(prefix: str = "", **kwargs) -> list[str]:
    """Complete a registered workspace id from the local registry (no daemon call)."""

    try:
        return [ws_id for ws_id in registered_workspace_ids() if ws_id.startswith(prefix)]
    except Exception:
        # argcomplete contract: never raise out of the completion subprocess.
        return []


def complete_container_target(prefix: str = "", **kwargs) -> list[str]:
    """Complete a container target: 12-char short ids across workspaces plus the literal ``all``.

    Degrades to ``all`` only when the daemon is unreachable or slow (short timeout).
    """

    candidates = ["all"]

    try:
        candidates.extend(_container_short_ids())
    except Exception:
        # argcomplete contract: never raise out of the completion subprocess.
        pass

    return [c for c in candidates if c.startswith(prefix)]


def registered_workspace_ids() -> list[str]:
    """Return registered workspace ids from ``~/.claudebox/daemon.json`` (empty if absent)."""

    config_path = daemon_config_path()

    if not config_path.exists():
        return []

    try:
        data = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError):
        return []

    return [entry["id"] for entry in data.get("workspaces", []) if entry.get("id")]


def _container_short_ids() -> list[str]:
    """Aggregate 12-char container short ids across registered workspaces via a sync daemon query."""

    workspace_ids = registered_workspace_ids()

    if not workspace_ids:
        return []

    short_ids: list[str] = []

    with httpx.Client(verify=False, timeout=_COMPLETION_HTTP_TIMEOUT) as client:
        for ws_id in workspace_ids:
            try:
                response = client.get(f"{daemon_base_url()}/api/workspaces/{ws_id}/containers")
                response.raise_for_status()
            except (httpx.RequestError, httpx.HTTPStatusError):
                continue

            for container in response.json().get("containers", []):
                container_id = container.get("id")

                if container_id:
                    short_ids.append(container_id[:12])

    return short_ids
