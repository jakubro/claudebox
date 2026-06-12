"""Shared test helpers for claudebox.agent_session.orchestration tests."""

from datetime import UTC, datetime

from claudebox.agent_session.orchestration.models import PublishedEvent


def make_published_event(**overrides) -> PublishedEvent:
    """Create a minimal PublishedEvent with sensible defaults.

    Override any field via keyword arguments. Default type is "assistant"
    with subtype "text" - pass type="system" for system events.
    """

    defaults = {
        "type": "assistant",
        "subtype": "text",
        "content": None,
        "primary": False,
        "is_human": False,
        "raw": {},
        "id": "e1",
        "ts": datetime(2026, 3, 8, 12, 0, 0, tzinfo=UTC),
        "turn_id": None,
    }
    defaults.update(overrides)

    return PublishedEvent(**defaults)  # ty: ignore[invalid-argument-type]  # Dynamic kwargs from heterogeneous defaults dict; ty can't narrow per-field types here.
