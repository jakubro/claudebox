"""Tests for `_resolve_slash_skill`/`_tag_slash_command`, LangGraph's answer to Claude's native slash handling."""

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import HumanMessage

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.events import UserMessagePayload
from claudebox.agent_session.runtime_langgraph import (
    LangGraphRuntime,
    _resolve_slash_skill,
    _tag_slash_command,
)


def _seed_skill(skills_dir: Path, name: str, body: str, *, user_invocable: bool = True) -> None:
    """Drop a SKILL.md under `skills_dir/<name>/`, with an explicit user-invocable flag."""

    target = skills_dir / name / "SKILL.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    fm = f"description: {name}-desc\nuser-invocable: {str(user_invocable).lower()}\n"
    target.write_text(f"---\n{fm}---\n{body}", encoding="utf-8")


def _patch_default_dirs(monkeypatch, tmp_path: Path) -> tuple[Path, Path]:
    """Redirect the skill module's default commands_dir/skills_dir into tmp_path."""

    commands_dir = tmp_path / "commands"
    skills_dir = tmp_path / "skills"
    monkeypatch.setattr(
        "claudebox.agent_session._skills.claude_commands_dir",
        lambda: commands_dir,
    )
    monkeypatch.setattr(
        "claudebox.agent_session._skills.claude_skills_dir",
        lambda: skills_dir,
    )

    return commands_dir, skills_dir


class TestResolveSlashSkill:
    def test_expands_a_user_invocable_skill(self, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "refine", "refine body content")

        assert _resolve_slash_skill("/refine") == "refine body content"

    def test_appends_arguments_when_trailing_text_given(self, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "refine", "the body")

        result = _resolve_slash_skill("/refine claudebox")

        assert result == "the body\n\nARGUMENTS: claudebox\n"

    def test_returns_none_for_a_non_invocable_skill(self, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "scope", "scope body", user_invocable=False)

        assert _resolve_slash_skill("/scope") is None

    def test_returns_none_for_an_unknown_skill(self, monkeypatch, tmp_path):
        _patch_default_dirs(monkeypatch, tmp_path)

        assert _resolve_slash_skill("/nope") is None

    def test_returns_none_for_plain_text(self, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "refine", "refine body")

        assert _resolve_slash_skill("no leading slash") is None

    def test_returns_none_for_text_with_an_internal_slash(self, monkeypatch, tmp_path):
        _patch_default_dirs(monkeypatch, tmp_path)

        assert _resolve_slash_skill("check /var/log for errors") is None


class TestTagSlashCommand:
    def test_tags_a_bare_command(self):
        assert _tag_slash_command("/refine") == (
            "<command-message>refine</command-message>"
            "<command-name>/refine</command-name>"
            "<command-args></command-args>"
        )

    def test_tags_a_command_with_arguments(self):
        assert _tag_slash_command("/refine claudebox") == (
            "<command-message>refine</command-message>"
            "<command-name>/refine</command-name>"
            "<command-args>claudebox</command-args>"
        )

    def test_tags_regardless_of_whether_the_name_is_a_real_skill(self):
        """Tagging is syntactic - Claude tags unrecognized commands too; the frontend decides styling."""

        assert _tag_slash_command("/nope do something") == (
            "<command-message>nope</command-message>"
            "<command-name>/nope</command-name>"
            "<command-args>do something</command-args>"
        )

    def test_leaves_plain_text_unchanged(self):
        assert _tag_slash_command("no leading slash") == "no leading slash"

    def test_leaves_text_with_an_internal_slash_unchanged(self):
        assert _tag_slash_command("check /var/log for errors") == "check /var/log for errors"


def _config(tmp_path: Path) -> LangGraphAgentSessionConfig:
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model="ollama:llama3.2:3b",
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-slash",
        resume_session_id=None,
        session_dir=tmp_path,
    )


def _stub_graph_capturing(captured: dict[str, Any]) -> Any:
    """Graph stub whose astream_events records graph_input and yields nothing."""

    async def _capture(graph_input, config=None, version=None):
        captured["graph_input"] = graph_input

        if False:  # pragma: no cover - empty async generator
            yield None

    graph: Any = MagicMock()
    graph.astream_events = _capture
    graph.aget_state = AsyncMock(return_value=MagicMock(tasks=()))

    return graph


class TestDriveTurnRoutesSlashSkill:
    @pytest.mark.anyio
    async def test_recognized_command_sends_the_skill_body(self, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "refine", "refine body content")

        captured: dict[str, Any] = {}
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph_capturing(captured)

        async for _ in runtime._drive_turn("/refine"):
            pass

        first_message = captured["graph_input"]["messages"][0]
        assert isinstance(first_message, HumanMessage)
        assert first_message.content == "refine body content"

    @pytest.mark.anyio
    async def test_unrecognized_command_falls_back_to_literal_text(self, monkeypatch, tmp_path):
        _patch_default_dirs(monkeypatch, tmp_path)

        captured: dict[str, Any] = {}
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph_capturing(captured)

        async for _ in runtime._drive_turn("/nope do something"):
            pass

        first_message = captured["graph_input"]["messages"][0]
        assert first_message.content == "/nope do something"

    @pytest.mark.anyio
    async def test_non_invocable_skill_falls_back_to_literal_text(self, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "scope", "scope body", user_invocable=False)

        captured: dict[str, Any] = {}
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph_capturing(captured)

        async for _ in runtime._drive_turn("/scope claudebox"):
            pass

        first_message = captured["graph_input"]["messages"][0]
        assert first_message.content == "/scope claudebox"

    @pytest.mark.anyio
    async def test_ordinary_prose_is_unaffected(self, monkeypatch, tmp_path):
        _patch_default_dirs(monkeypatch, tmp_path)

        captured: dict[str, Any] = {}
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph_capturing(captured)

        async for _ in runtime._drive_turn("what does this function do?"):
            pass

        first_message = captured["graph_input"]["messages"][0]
        assert first_message.content == "what does this function do?"


class TestDriveTurnTagsDisplayEcho:
    """Display tagging is independent of routing - the model never sees the tags."""

    @pytest.mark.anyio
    async def test_recognized_command_display_is_tagged_but_model_gets_the_body(
        self,
        monkeypatch,
        tmp_path,
    ):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "refine", "refine body content")

        captured: dict[str, Any] = {}
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph_capturing(captured)

        events = [event async for event in runtime._drive_turn("/refine claudebox")]

        display_event = events[0]
        assert isinstance(display_event.payload, UserMessagePayload)
        assert display_event.payload.content == (
            "<command-message>refine</command-message>"
            "<command-name>/refine</command-name>"
            "<command-args>claudebox</command-args>"
        )
        first_message = captured["graph_input"]["messages"][0]
        assert first_message.content == "refine body content\n\nARGUMENTS: claudebox\n"

    @pytest.mark.anyio
    async def test_unrecognized_command_display_is_tagged_too(self, monkeypatch, tmp_path):
        _patch_default_dirs(monkeypatch, tmp_path)

        captured: dict[str, Any] = {}
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph_capturing(captured)

        events = [event async for event in runtime._drive_turn("/nope do something")]

        display_event = events[0]
        assert isinstance(display_event.payload, UserMessagePayload)
        assert display_event.payload.content == (
            "<command-message>nope</command-message>"
            "<command-name>/nope</command-name>"
            "<command-args>do something</command-args>"
        )

    @pytest.mark.anyio
    async def test_ordinary_prose_display_is_untagged(self, monkeypatch, tmp_path):
        _patch_default_dirs(monkeypatch, tmp_path)

        captured: dict[str, Any] = {}
        runtime = LangGraphRuntime(_config(tmp_path))
        runtime._graph = _stub_graph_capturing(captured)

        events = [event async for event in runtime._drive_turn("what does this function do?")]

        assert isinstance(events[0].payload, UserMessagePayload)
        assert events[0].payload.content == "what does this function do?"
