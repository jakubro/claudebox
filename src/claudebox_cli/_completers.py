"""argcomplete completers for the claudebox CLI - workspace ids and container targets.

Must stay exception-safe (return what was resolved, never raise) and never write to
stdout/stderr - stray output corrupts argcomplete's fd-8 completion stream.
"""

import json
import logging

from claudebox.constants import daemon_base_url, daemon_config_path


# Stdlib logging: no deep-import of claudebox internals (scripts/python-guidelines-audit.py).
# Handlerless, so INFO is absorbed - stray output would corrupt argcomplete's fd-8 stream.
_logger = logging.getLogger(__name__)


# Short, fixed timeout: a TAB press must stay responsive even when the daemon is down.
_COMPLETION_HTTP_TIMEOUT_SECONDS = 1.5


def complete_workspace_id(prefix: str = "", **kwargs) -> list[str]:
    """Complete a registered workspace id from the local registry (no daemon call)."""

    try:
        return [ws_id for ws_id in registered_workspace_ids() if ws_id.startswith(prefix)]
    except Exception:  # noqa: BLE001 - argcomplete contract: never raise
        return []


def complete_container_target(prefix: str = "", **kwargs) -> list[str]:
    """Complete a container target: 12-char short ids across workspaces plus the literal ``all``.

    Degrades to ``all`` only when the daemon is unreachable or slow (short timeout).
    """

    candidates = ["all"]

    try:
        candidates.extend(_container_short_ids())
    except Exception as exc:  # noqa: BLE001 - argcomplete contract: never raise
        _logger.info("container completion failed: %s", exc)

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
    """Aggregate 12-char container short ids across registered workspaces via a sync daemon query.

    ``httpx`` is deferred: workspace-id completion needs no network, and every keypress re-executes the program.
    """

    workspace_ids = registered_workspace_ids()

    if not workspace_ids:
        return []

    import httpx

    short_ids: list[str] = []

    with httpx.Client(
        verify=False,
        timeout=httpx.Timeout(_COMPLETION_HTTP_TIMEOUT_SECONDS),
    ) as client:
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
