"""Profile session-start hook execution - runtime-neutral.

The Claude Code CLI runs profile hook scripts itself and feeds their `hookSpecificOutput.additionalContext`
into the model's context; a runtime that never spawns that CLI gets none of it, so a workspace's
session-start logic (memory recall, instruction loading, etc.) would otherwise never happen. This
module runs the same script over the same JSON protocol so one hook serves every runtime - it owns
no policy, only resolving the path, running it, and handing back the context string; injecting the
result is the runtime's call.

Hook failure is never fatal: a crash, timeout, or non-JSON response degrades to "no additional
context" rather than taking the session down with it.
"""

import asyncio
from pathlib import Path
from typing import Any

from ..constants import profile_dir
from ..core import serialization
from ..core.logging import get_logger


# Conventional location, mirroring the shell hooks the container entrypoint runs by fixed path; a
# workspace overrides it via `[langgraph.hooks] session_start = "..."`.
CONVENTION_RELATIVE_PATH = "hooks/session_start.py"

# The hook runs during connect, before the session reports ready, so this timeout is the worst-case
# delay on the first turn; exceeding it drops the context and lets the session proceed.
HOOK_TIMEOUT_SECONDS = 15.0

_logger = get_logger(__name__)


def resolve_session_start_hook(configured: str | None) -> Path | None:
    """Resolve the session-start hook path, or None when there is nothing to run.

    An explicit workspace setting wins, resolved against the installed profile directory when
    relative so a workspace can declare `hooks/session_start.py` instead of a machine-specific
    absolute path; with nothing configured, the conventional path is used when it exists.
    """

    if configured:
        candidate = Path(configured).expanduser()

        if not candidate.is_absolute():
            candidate = profile_dir() / candidate
    else:
        candidate = profile_dir() / CONVENTION_RELATIVE_PATH

    return candidate if candidate.is_file() else None


async def run_session_start_hook(
    hook: Path,
    *,
    session_id: str,
    transcript_path: Path,
) -> str | None:
    """Run the hook and return the context it asked to add, or None; feeds the payload shape the
    Claude Code hook SDK parses, so a script written against `@hook`/`HookRequest` runs unmodified."""

    payload = serialization.dumps(
        {
            "session_id": session_id,
            "hook_event_name": "SessionStart",
            "transcript_path": str(transcript_path),
        },
    )

    try:
        stdout = await _execute(hook, payload)
    except (TimeoutError, OSError) as exc:
        _logger.warning("profile_hook_failed", hook=str(hook), error=str(exc))

        return None

    if stdout is None:
        return None

    return _extract_context(stdout, hook)


async def _execute(hook: Path, payload: str) -> str | None:
    """Run the hook with `payload` on stdin; return stdout, or None when it failed."""

    process = await asyncio.create_subprocess_exec(
        str(hook),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        raw_out, raw_err = await asyncio.wait_for(
            process.communicate(payload.encode()),
            timeout=HOOK_TIMEOUT_SECONDS,
        )
    except BaseException:
        # Covers cancellation as well as timeout: connect() runs as a task the session cancels on
        # stop, and an un-killed child would outlive it holding all three pipes.
        process.kill()
        await process.wait()

        raise

    if process.returncode != 0:
        _logger.warning(
            "profile_hook_nonzero_exit",
            hook=str(hook),
            returncode=process.returncode,
            stderr=raw_err.decode(errors="replace")[:500],
        )

        return None

    return raw_out.decode(errors="replace")


def _extract_context(stdout: str, hook: Path) -> str | None:
    """Pull `hookSpecificOutput.additionalContext` out of the hook's JSON response."""

    if not stdout.strip():
        return None

    try:
        response: Any = serialization.loads(stdout)
    except Exception:  # noqa: BLE001 - untrusted hook stdout; any parse failure degrades the same
        _logger.warning("profile_hook_unparseable_output", hook=str(hook))

        return None

    if not isinstance(response, dict):
        return None

    specific = response.get("hookSpecificOutput")

    if not isinstance(specific, dict):
        return None

    context = specific.get("additionalContext")

    return context if isinstance(context, str) and context.strip() else None
