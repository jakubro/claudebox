"""Tests for etc/profile.sample/ - the shipped profile must load through the same walker every
profile does, or a broken sample ships silently (nothing else exercises this tree)."""

from pathlib import Path

from claudebox.agent_session._skills import walk_skills


_PROFILE_SAMPLE = Path(__file__).resolve().parents[2] / "etc" / "profile.sample"


class TestShippedProfileSample:
    """Every command and skill under etc/profile.sample/ is discovered by walk_skills()."""

    def test_every_shipped_command_and_skill_is_discovered(self):
        commands_dir = _PROFILE_SAMPLE / "commands"
        skills_dir = _PROFILE_SAMPLE / "skills"

        shipped_commands = list(commands_dir.glob("*.md"))
        shipped_skills = [d for d in skills_dir.iterdir() if d.is_dir()]

        discovered = walk_skills(commands_dir, skills_dir)

        assert len(discovered) == len(shipped_commands) + len(shipped_skills), (
            f"shipped {len(shipped_commands)} command(s) and {len(shipped_skills)} skill(s) but "
            f"walk_skills discovered {len(discovered)} - a shipped file failed to load or two "
            f"shipped names collided"
        )
