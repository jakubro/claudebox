"""Shared skill walker - walk_skills + parse helpers + body extraction + source lookup."""

import textwrap
from pathlib import Path

from claudebox.agent_session._skills import (
    extract_body,
    find_skill_source,
    parse_frontmatter,
    parse_list,
    walk_skills,
)


def _write(path: Path, content: str) -> None:
    """Write `content` to `path`, creating parent dirs as needed."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")


class TestParseFrontmatter:
    def test_returns_none_when_no_frontmatter(self):
        assert parse_frontmatter("plain body, no fences", fallback_name=None) is None

    def test_returns_none_when_closing_fence_missing(self):
        assert parse_frontmatter("---\nname: x\n", fallback_name=None) is None

    def test_returns_none_when_no_name_and_no_fallback(self):
        assert parse_frontmatter("---\ndescription: x\n---\nbody", fallback_name=None) is None

    def test_uses_fallback_name_when_frontmatter_omits_name(self):
        skill = parse_frontmatter("---\ndescription: a\n---\nbody", fallback_name="from-dir")

        assert skill is not None
        assert skill.name == "from-dir"
        assert skill.description == "a"

    def test_usage_includes_argument_hint_when_present(self):
        skill = parse_frontmatter(
            "---\nname: foo\nargument-hint: <topic>\n---\nbody", fallback_name=None
        )

        assert skill is not None
        assert skill.usage == "/foo <topic>"

    def test_usage_omits_argument_hint_when_absent(self):
        skill = parse_frontmatter("---\nname: foo\n---\nbody", fallback_name=None)

        assert skill is not None
        assert skill.usage == "/foo"


class TestParseList:
    def test_returns_none_for_none(self):
        assert parse_list(None) is None

    def test_passes_through_lists_as_strings(self):
        assert parse_list(["a", "b", 1]) == ["a", "b", "1"]

    def test_splits_comma_separated_string(self):
        assert parse_list(" a, b ,c ") == ["a", "b", "c"]


class TestExtractBody:
    def test_returns_content_unchanged_when_no_frontmatter(self):
        assert extract_body("plain body\nmore") == "plain body\nmore"

    def test_strips_frontmatter_and_trailing_newline(self):
        content = "---\nname: x\n---\nthe body\n"

        assert extract_body(content) == "the body\n"

    def test_returns_content_when_closing_fence_missing(self):
        assert extract_body("---\nname: x\nno-close") == "---\nname: x\nno-close"


class TestWalkSkills:
    def test_returns_empty_when_directories_absent(self, tmp_path):
        assert walk_skills(tmp_path / "missing-cmds", tmp_path / "missing-skills") == []

    def test_walks_commands_dir(self, tmp_path):
        cmds = tmp_path / "commands"
        _write(cmds / "foo.md", "---\nname: foo\ndescription: f\n---\nbody")

        skills = walk_skills(cmds, tmp_path / "no-skills")

        assert [s.name for s in skills] == ["foo"]
        assert skills[0].description == "f"

    def test_walks_skills_dir_with_dirname_fallback(self, tmp_path):
        skills_dir = tmp_path / "skills"
        _write(skills_dir / "implement" / "SKILL.md", "---\ndescription: d\n---\nbody")

        skills = walk_skills(tmp_path / "no-cmds", skills_dir)

        assert [s.name for s in skills] == ["implement"]
        assert skills[0].description == "d"

    def test_skills_dir_overrides_commands_dir_on_name_collision(self, tmp_path):
        cmds = tmp_path / "commands"
        skills_dir = tmp_path / "skills"
        _write(cmds / "foo.md", "---\nname: foo\ndescription: from-commands\n---\nbody")
        _write(skills_dir / "foo" / "SKILL.md", "---\ndescription: from-skills\n---\nbody")

        skills = walk_skills(cmds, skills_dir)

        assert len(skills) == 1
        assert skills[0].description == "from-skills"


class TestFindSkillSource:
    def test_returns_none_when_name_unknown(self, tmp_path):
        cmds = tmp_path / "commands"
        skills_dir = tmp_path / "skills"
        _write(cmds / "foo.md", "---\nname: foo\n---\nbody")

        assert find_skill_source("bar", cmds, skills_dir) is None

    def test_returns_path_for_commands_match(self, tmp_path):
        cmds = tmp_path / "commands"
        skills_dir = tmp_path / "skills"
        _write(cmds / "foo.md", "---\nname: foo\n---\nbody")

        source = find_skill_source("foo", cmds, skills_dir)

        assert source == cmds / "foo.md"

    def test_returns_path_for_skills_dir_match(self, tmp_path):
        cmds = tmp_path / "commands"
        skills_dir = tmp_path / "skills"
        _write(skills_dir / "implement" / "SKILL.md", "---\ndescription: d\n---\nbody")

        source = find_skill_source("implement", cmds, skills_dir)

        assert source == skills_dir / "implement" / "SKILL.md"
