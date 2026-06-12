"""Projection sources skill metadata from the active runtime, not ClaudeRuntime."""

from typing import cast

from claudebox.agent_session.catalogs import Skill
from claudebox.agent_session.orchestration.projection import Projection
from claudebox.agent_session.protocol import AgentSession
from claudebox.workspace import Workspace


class _StubRuntime:
    """Minimal AgentSession stub returning a configurable Skill list."""

    runtime_name = "Stub"

    def __init__(self, skills: list[Skill]):
        self._skills = skills

    def get_skills(self) -> list[Skill]:
        return self._skills


def _projection(session_id: str, tmp_workspace, monkeypatch, runtime=None) -> Projection:
    monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

    return Projection(
        session_id=session_id,
        workspace=Workspace(start_dir=tmp_workspace),
        runtime=runtime,
    )


def test_categorize_commands_uses_active_runtime_skills(tmp_workspace, monkeypatch):
    skills = [Skill(name="foo", usage="run foo"), Skill(name="bar")]
    runtime = cast(AgentSession, _StubRuntime(skills))
    projection = _projection("sess-1", tmp_workspace, monkeypatch, runtime=runtime)

    commands = projection._categorize_commands(["foo", "baz", "compact", "mcp__ctx7__resolve"])

    custom_names = [entry["name"] for entry in commands["custom"]]
    builtin_names = [entry["name"] for entry in commands["builtin"]]
    mcp_names = [entry["name"] for entry in commands["mcp"]]

    # foo matched runtime metadata - entry carries the Skill fields (name + usage at least).
    foo_entry = next(entry for entry in commands["custom"] if entry["name"] == "foo")
    assert foo_entry.get("usage") == "run foo"
    # baz had no match -> name-only fallback.
    baz_entry = next(entry for entry in commands["custom"] if entry["name"] == "baz")
    assert baz_entry == {"name": "baz"}
    assert "baz" in custom_names
    assert "compact" in builtin_names
    assert "mcp__ctx7__resolve" in mcp_names


def test_categorize_commands_with_empty_runtime_skills(tmp_workspace, monkeypatch):
    """Runtime returning no skills (e.g. LangGraphRuntime) must not bleed Claude skill metadata."""

    runtime = cast(AgentSession, _StubRuntime(skills=[]))
    projection = _projection("sess-2", tmp_workspace, monkeypatch, runtime=runtime)

    commands = projection._categorize_commands(["foo", "compact", "mcp__ctx7__list"])

    # Every categorized entry should be name-only - runtime returned no metadata.
    for bucket in ("custom", "builtin", "mcp"):
        for entry in commands[bucket]:
            assert set(entry.keys()) == {"name"}, entry


def test_categorize_commands_without_runtime_degrades_gracefully(tmp_workspace, monkeypatch):
    """Throwaway projection (no runtime) categorizes by bucket with name-only entries."""

    projection = _projection("sess-3", tmp_workspace, monkeypatch)

    commands = projection._categorize_commands(["foo", "compact", "mcp__ctx7__resolve"])

    # Categorization still works - buckets populated, entries name-only (no runtime metadata).
    assert {entry["name"] for entry in commands["custom"]} == {"foo"}
    assert {entry["name"] for entry in commands["builtin"]} == {"compact"}
    assert {entry["name"] for entry in commands["mcp"]} == {"mcp__ctx7__resolve"}

    for bucket in ("custom", "builtin", "mcp"):
        for entry in commands[bucket]:
            assert set(entry.keys()) == {"name"}, entry
