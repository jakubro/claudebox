"""Tests for the container API session registry - lifecycle, primary designation, addressing."""

from collections.abc import Callable
from typing import ClassVar, cast

import pytest

from claudebox import SessionEntryNotFound, SessionNotReady, ValidationError
from claudebox_container_api import session as session_module
from claudebox_container_api.session import SessionRegistry


class _FakeSession:
    """Stand-in for SessionService - records constructor kwargs and start/stop calls."""

    instances: ClassVar[list["_FakeSession"]] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.started_with = None
        self.stopped = False
        self.turn_complete_cancelled = False
        self.settle_turn_complete_called = False
        self.session_id: str | None = None
        # Test hook: a callable a test wires to run once settle_turn_complete is invoked, for
        # simulating the entry removing itself (its own auto-stop) mid-settle.
        self.on_settle: Callable[[], None] | None = None
        type(self).instances.append(self)

    async def start(self, resume_session_id: str | None = None) -> str:
        self.started_with = resume_session_id
        self.session_id = resume_session_id or f"minted-{len(type(self).instances)}"

        return self.session_id

    async def stop(self) -> None:
        self.stopped = True

    def cancel_turn_complete(self) -> None:
        self.turn_complete_cancelled = True

    async def settle_turn_complete(self) -> None:
        self.settle_turn_complete_called = True

        if self.on_settle is not None:
            self.on_settle()


@pytest.fixture(autouse=True)
def _fake_session_service(monkeypatch):
    """Replace SessionService with the recording fake for every test in this module."""

    _FakeSession.instances = []
    monkeypatch.setattr(session_module, "SessionService", _FakeSession)


def _registry(tmp_path) -> SessionRegistry:
    return SessionRegistry(workspace=tmp_path, system_prompt=None, permission_mode=None)


def _fake(registry: SessionRegistry, session_id: str | None = None) -> _FakeSession:
    """Resolve a registry entry back to its fake type - SessionService is monkeypatched at
    runtime, but registry.get()'s static return type doesn't know that."""

    return cast(_FakeSession, registry.get(session_id))


@pytest.mark.anyio
async def test_start_creates_entry_and_designates_primary(tmp_path):
    """A primary start registers the new id as both an entry and the primary."""

    registry = _registry(tmp_path)
    session_id = await registry.start(None, primary=True)

    assert registry.primary_id == session_id
    assert registry.live_ids() == [session_id]


@pytest.mark.anyio
async def test_second_primary_start_stops_first_and_replaces(tmp_path):
    """A second /new-shaped start stops the current primary before starting the new one."""

    registry = _registry(tmp_path)
    first_id = await registry.start(None, primary=True)
    first_entry = _fake(registry, first_id)

    second_id = await registry.start(None, primary=True)

    assert first_entry.stopped is True
    assert registry.primary_id == second_id
    assert registry.live_ids() == [second_id]


@pytest.mark.anyio
async def test_joining_start_never_touches_primary(tmp_path):
    """primary=False adds a member without stopping or redesignating the primary."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)

    member_id = await registry.start("joined-session", primary=False)

    assert registry.primary_id == primary_id
    assert set(registry.live_ids()) == {primary_id, member_id}
    assert _fake(registry, primary_id).stopped is False


@pytest.mark.anyio
async def test_joining_start_on_a_running_id_returns_the_same_entry(tmp_path):
    """A member start naming an id already registered hands back the running entry rather
    than building a second one over it - the resume-while-still-running case."""

    registry = _registry(tmp_path)
    await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)
    first_entry = _fake(registry, member_id)
    instance_count_before = len(_FakeSession.instances)

    second_id = await registry.start("joined-session", primary=False)

    assert second_id == member_id
    assert _fake(registry, member_id) is first_entry
    assert len(_FakeSession.instances) == instance_count_before  # nothing new constructed
    assert first_entry.stopped is False
    assert first_entry.settle_turn_complete_called is True


@pytest.mark.anyio
async def test_joining_start_on_the_primary_id_returns_the_primary_rather_than_orphaning_it(
    tmp_path,
):
    """A member start addressed at the primary's own id must not orphan the primary and arm a
    doomed auto-stop on a replacement - it hands back the primary entry, untouched."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)
    primary_entry = _fake(registry, primary_id)

    returned_id = await registry.start(primary_id, primary=False)

    assert returned_id == primary_id
    assert registry.primary_id == primary_id
    assert _fake(registry, primary_id) is primary_entry
    assert primary_entry.stopped is False
    # Never re-wired as a member - the primary's own on_turn_complete stays None.
    assert primary_entry.kwargs["on_turn_complete"] is None


@pytest.mark.anyio
async def test_joining_start_settles_then_rechecks_membership_before_returning(tmp_path):
    """An entry that auto-stops itself mid-settle is re-checked under the same lock, so the
    start falls through and builds a fresh entry instead of returning a gone one."""

    registry = _registry(tmp_path)
    await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)
    first_entry = _fake(registry, member_id)

    def _vanish() -> None:
        del registry._entries[member_id]

    first_entry.on_settle = _vanish

    returned_id = await registry.start("joined-session", primary=False)

    assert returned_id == "joined-session"
    assert _fake(registry, "joined-session") is not first_entry  # a fresh entry was built
    assert first_entry.settle_turn_complete_called is True


@pytest.mark.anyio
async def test_remaps_tmp_follows_the_primary_flag(tmp_path):
    """Only a primary start maps /tmp - a joining session's runtime must never call ensure_tmp."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)

    assert _fake(registry, primary_id).kwargs["remaps_tmp"] is True
    assert _fake(registry, member_id).kwargs["remaps_tmp"] is False


@pytest.mark.anyio
async def test_joining_start_wires_the_member_turn_complete_callback(tmp_path):
    """A member's SessionService gets the registry's own stop as its on_turn_complete."""

    registry = _registry(tmp_path)
    await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)

    # Bound-method access creates a fresh wrapper each time - compare by equality, not identity.
    assert (
        _fake(registry, member_id).kwargs["on_turn_complete"] == registry._on_member_turn_complete
    )


@pytest.mark.anyio
async def test_primary_start_never_wires_turn_complete(tmp_path):
    """A primary's session never stops itself on turn completion - only a container-lifecycle
    decision (the daemon's stop/kill/delete) may end the owning session."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)

    assert _fake(registry, primary_id).kwargs["on_turn_complete"] is None


@pytest.mark.anyio
async def test_member_turn_complete_callback_stops_the_session(tmp_path):
    registry = _registry(tmp_path)
    await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)
    member_entry = _fake(registry, member_id)

    await registry._on_member_turn_complete(member_id)

    assert member_entry.stopped is True
    assert member_id not in registry.live_ids()


@pytest.mark.anyio
async def test_member_turn_complete_callback_tolerates_already_gone(tmp_path):
    """A concurrent explicit stop can remove the entry first - the callback must not raise
    into the background task scheduling it."""

    registry = _registry(tmp_path)
    await registry.start(None, primary=True)

    await registry._on_member_turn_complete("never-registered")


@pytest.mark.anyio
async def test_stop_session_removes_non_primary_entry(tmp_path):
    """Stopping a member removes only that entry; the primary is untouched."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)
    member_entry = _fake(registry, member_id)

    await registry.stop_session(member_id)

    assert member_entry.stopped is True
    assert registry.live_ids() == [primary_id]
    assert registry.primary_id == primary_id


@pytest.mark.anyio
async def test_stop_session_refuses_the_primary(tmp_path):
    """The session-scoped stop route must never end the container's owning session."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)

    with pytest.raises(ValidationError):
        await registry.stop_session(primary_id)

    assert registry.primary_id == primary_id
    assert _fake(registry, primary_id).stopped is False


@pytest.mark.anyio
async def test_stop_session_unknown_id_raises_not_found(tmp_path):
    """Stopping an id with no registry entry is a 404, not a silent no-op."""

    registry = _registry(tmp_path)
    await registry.start(None, primary=True)

    with pytest.raises(SessionEntryNotFound):
        await registry.stop_session("never-registered")


@pytest.mark.anyio
async def test_promote_session_cancels_turn_complete(tmp_path):
    """Promoting a member cancels its auto-stop disposition without touching the entry itself."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)

    registry.promote_session(member_id)

    assert _fake(registry, member_id).turn_complete_cancelled is True
    assert _fake(registry, primary_id).turn_complete_cancelled is False
    assert registry.live_ids() == [primary_id, member_id]


@pytest.mark.anyio
async def test_promote_session_unknown_id_raises_not_found(tmp_path):
    """Promoting an id with no registry entry is a 404, not a silent no-op."""

    registry = _registry(tmp_path)
    await registry.start(None, primary=True)

    with pytest.raises(SessionEntryNotFound):
        registry.promote_session("never-registered")


@pytest.mark.anyio
async def test_stop_all_stops_every_entry(tmp_path):
    """The lifespan's shutdown contract: every remaining entry stops, not just the primary."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)
    primary_entry = _fake(registry, primary_id)
    member_entry = _fake(registry, member_id)

    await registry.stop_all()

    assert primary_entry.stopped is True
    assert member_entry.stopped is True
    assert registry.live_ids() == []
    assert registry.primary_id is None


@pytest.mark.anyio
async def test_get_resolves_unaddressed_to_primary(tmp_path):
    """No session_id given resolves to whichever entry is primary."""

    registry = _registry(tmp_path)
    primary_id = await registry.start(None, primary=True)
    await registry.start("joined-session", primary=False)

    assert registry.get() is registry.get(primary_id)


@pytest.mark.anyio
async def test_get_resolves_addressed_member(tmp_path):
    """An explicit session_id resolves that entry even when it is not the primary."""

    registry = _registry(tmp_path)
    await registry.start(None, primary=True)
    member_id = await registry.start("joined-session", primary=False)

    assert _fake(registry, member_id).session_id == member_id


def test_get_raises_before_any_session_started(tmp_path):
    """An empty registry has no primary to fall back to."""

    registry = _registry(tmp_path)

    with pytest.raises(SessionNotReady):
        registry.get()


@pytest.mark.anyio
async def test_managed_constructs_and_tears_down_the_registry(monkeypatch, tmp_path):
    """managed() builds the registry once and stops every entry on exit."""

    logging_calls: list[str] = []
    monkeypatch.setattr(session_module, "start_logging", lambda path: logging_calls.append("start"))
    monkeypatch.setattr(session_module, "stop_logging", lambda: logging_calls.append("stop"))

    handler = session_module.managed(workspace=str(tmp_path))

    async with handler(app=None):
        assert session_module.registry is not None
        session_id = await session_module.registry.start(None, primary=True)
        entry = _fake(session_module.registry, session_id)

    assert entry.stopped is True
    assert session_module.registry is None
    assert logging_calls == ["start", "stop"]
