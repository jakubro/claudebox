"""Link-carried message allowlist matching - pure, no I/O beyond logging a bad pattern."""

import re

from claudebox import get_logger


logger = get_logger(__name__)


def resolve_link_messages(
    messages: list[str],
    patterns: list[str],
) -> tuple[list[str], list[str]]:
    """Split link-carried messages into (delivered, blocked) against a workspace's allowlist.

    All-or-nothing: one surviving message failing to fullmatch any pattern blocks the whole set.
    """

    survivors = [message for message in messages if message.strip()]

    if not survivors:
        return [], []

    compiled = []

    for pattern in patterns:
        try:
            compiled.append(re.compile(pattern))
        except re.error:
            logger.warning("Invalid link allowlist pattern - skipping", pattern=pattern)

    if all(any(rx.fullmatch(message) for rx in compiled) for message in survivors):
        return survivors, []

    return [], survivors
