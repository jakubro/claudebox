"""skill.py @tool tests - workspace skill lookup + body return + ARGUMENTS appending."""

from pathlib import Path

import pytest
from langchain_core.tools import ToolException

from claudebox.agent_session.langgraph_tools.skill import make_skill_tools


def _seed_skill(skills_dir: Path, name: str, body: str) -> None:
    """Drop a SKILL.md under `skills_dir/<name>/`."""

    target = skills_dir / name / "SKILL.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"---\ndescription: {name}-desc\n---\n{body}", encoding="utf-8")


def _seed_command(commands_dir: Path, name: str, body: str) -> None:
    """Drop a `<name>.md` under `commands_dir/`."""

    commands_dir.mkdir(parents=True, exist_ok=True)
    (commands_dir / f"{name}.md").write_text(f"---\nname: {name}\n---\n{body}", encoding="utf-8")


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


class TestMakeSkillTools:
    def test_returns_single_skill_tool(self, tool_ctx):
        tools = make_skill_tools(tool_ctx)

        assert [t.name for t in tools] == ["skill"]


class TestSkillInvocation:
    def test_returns_body_post_frontmatter(self, tool_ctx, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "refine", "refine body content\nmore lines")

        skill_tool = make_skill_tools(tool_ctx)[0]

        result = skill_tool.invoke({"name": "refine"})

        assert result == "refine body content\nmore lines"

    def test_appends_arguments_line_when_args_given(self, tool_ctx, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "scope", "the body")

        skill_tool = make_skill_tools(tool_ctx)[0]

        result = skill_tool.invoke({"name": "scope", "arguments": "claudebox"})

        assert result == "the body\n\nARGUMENTS: claudebox\n"

    def test_omits_arguments_line_when_args_none(self, tool_ctx, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "scope", "the body")

        skill_tool = make_skill_tools(tool_ctx)[0]

        result = skill_tool.invoke({"name": "scope"})

        assert "ARGUMENTS:" not in result

    def test_omits_arguments_line_when_args_empty(self, tool_ctx, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "scope", "the body")

        skill_tool = make_skill_tools(tool_ctx)[0]

        result = skill_tool.invoke({"name": "scope", "arguments": ""})

        assert "ARGUMENTS:" not in result

    def test_reads_skill_from_commands_dir(self, tool_ctx, monkeypatch, tmp_path):
        commands_dir, _skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_command(commands_dir, "audit", "audit cmd body")

        skill_tool = make_skill_tools(tool_ctx)[0]

        result = skill_tool.invoke({"name": "audit"})

        assert result == "audit cmd body"


class TestUnknownName:
    def test_raises_tool_exception_with_available_list(self, tool_ctx, monkeypatch, tmp_path):
        _commands_dir, skills_dir = _patch_default_dirs(monkeypatch, tmp_path)
        _seed_skill(skills_dir, "alpha", "a body")
        _seed_skill(skills_dir, "bravo", "b body")

        skill_tool = make_skill_tools(tool_ctx)[0]

        with pytest.raises(ToolException) as exc:
            skill_tool.invoke({"name": "missing"})

        message = str(exc.value)
        assert "skill: unknown name 'missing'" in message
        assert "alpha" in message
        assert "bravo" in message

    def test_raises_with_none_marker_when_catalog_empty(self, tool_ctx, monkeypatch, tmp_path):
        _patch_default_dirs(monkeypatch, tmp_path)

        skill_tool = make_skill_tools(tool_ctx)[0]

        with pytest.raises(ToolException) as exc:
            skill_tool.invoke({"name": "missing"})

        assert "<none>" in str(exc.value)


class TestCapabilityFlip:
    def test_langgraph_runtime_now_supports_skills(self):
        from claudebox.agent_session.runtime_langgraph import LangGraphRuntime

        assert LangGraphRuntime.CAPABILITIES.supports_skills is True
