"""Tests for ClaudeRuntime catalog accessors + Skill parser."""

import textwrap

from claudebox.agent_session.catalogs import EffortLevel, Model, PermissionMode, Skill
from claudebox.agent_session.runtime_claude import ClaudeRuntime


class TestModels:
    """Model catalog + default + context-window lookup."""

    def test_get_models_returns_list(self):
        models = ClaudeRuntime.get_models()
        assert isinstance(models, list)
        assert len(models) > 0
        assert all(isinstance(m, Model) for m in models)

    def test_default_model_id_is_known(self):
        ids = [m.id for m in ClaudeRuntime.get_models()]
        assert ClaudeRuntime.get_default_model() in ids

    def test_get_model_context_window_known(self):
        assert ClaudeRuntime.get_model_context_window("claude-opus-5") == 1_000_000

    def test_get_model_context_window_unknown_falls_back_to_default(self):
        assert ClaudeRuntime.get_model_context_window("nonexistent-model-xyz") == (
            ClaudeRuntime.DEFAULT_CONTEXT_WINDOW
        )

    def test_models_have_distinct_ids(self):
        ids = [m.id for m in ClaudeRuntime.get_models()]
        assert len(ids) == len(set(ids))

    def test_opus_4_8_present_and_default(self):
        ids = [m.id for m in ClaudeRuntime.get_models()]
        assert "claude-opus-5" in ids
        assert ClaudeRuntime.get_default_model() == "claude-opus-5"

    def test_fable_5_present(self):
        ids = {m.id for m in ClaudeRuntime.get_models()}
        assert {"claude-fable-5"} <= ids
        assert ClaudeRuntime.get_model_context_window("claude-fable-5") == 1_000_000

    def test_no_explicit_1m_variant_ids(self):
        ids = [m.id for m in ClaudeRuntime.get_models()]
        assert not any(model_id.endswith("[1m]") for model_id in ids)


class TestPermissionAndEffortCatalogs:
    """Permission mode + effort level catalogs."""

    def test_get_permission_modes_returns_dataclasses(self):
        modes = ClaudeRuntime.get_permission_modes()
        assert all(isinstance(m, PermissionMode) for m in modes)
        assert any(m.id == "default" for m in modes)

    def test_get_effort_levels_returns_dataclasses(self):
        levels = ClaudeRuntime.get_effort_levels()
        assert all(isinstance(level, EffortLevel) for level in levels)
        assert any(level.id == "xhigh" for level in levels)

    def test_defaults_are_in_catalogs(self):
        pmode_ids = [m.id for m in ClaudeRuntime.get_permission_modes()]
        eff_ids = [e.id for e in ClaudeRuntime.get_effort_levels()]
        assert ClaudeRuntime.get_default_permission_mode() in pmode_ids
        assert ClaudeRuntime.get_default_effort_level() in eff_ids


class TestSkillParser:
    """Skill frontmatter parsing via ClaudeRuntime.get_skills; walker/parser unit tests live in test_skills.py."""

    def test_get_skills_returns_skill_instances(self, tmp_path):
        skill_dir = tmp_path / "skills" / "alpha"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            textwrap.dedent("""\
                ---
                name: alpha
                description: first
                ---
                """),
        )

        skills = ClaudeRuntime.get_skills(
            commands_dir=tmp_path / "commands",
            skills_dir=tmp_path / "skills",
        )

        assert all(isinstance(s, Skill) for s in skills)
        names = [s.name for s in skills]
        assert "alpha" in names

    def test_get_skills_handles_missing_dirs(self, tmp_path):
        # Neither dir exists - get_skills returns empty list, not error
        skills = ClaudeRuntime.get_skills(
            commands_dir=tmp_path / "missing-cmds",
            skills_dir=tmp_path / "missing-skills",
        )
        assert skills == []
