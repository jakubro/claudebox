"""Shared skill catalog walker - filesystem discovery + YAML frontmatter parsing.

Used by both ClaudeRuntime and LangGraphRuntime; the catalog is a filesystem object
(`<commands_dir>/*.md` + `<skills_dir>/<name>/SKILL.md`), so discovery is runtime-neutral.

Returns Skill metadata only (per `catalogs.Skill`); `langgraph_tools/skill.py` owns re-reading
the source file at invoke time to project the body as a tool result.
"""

from pathlib import Path

from ruamel.yaml import YAML

from .catalogs import Skill
from ..constants import claude_commands_dir, claude_skills_dir
from ..core.logging import get_logger


_yaml = YAML(typ="safe")


def walk_skills(
    commands_dir: Path | None = None,
    skills_dir: Path | None = None,
) -> list[Skill]:
    """Walk profile directories for skills and return parsed Skill metadata.

    Defaults to in-container bind-mount paths (`claude_commands_dir()`/`claude_skills_dir()`);
    daemon callers pass profile-relative paths. Resolved at call time so test monkeypatching of
    `Path.home()` takes effect (see GUIDELINES.md "Home-derived paths").

    A `commands_dir` file whose frontmatter fails to parse is dropped and logged with the reason.
    """

    # Resolved here, not at module scope: a module-level get_logger() runs configure_logging()
    # at import time and its once-only guard then blocks the daemon's own console reconfigure.
    logger = get_logger(__name__)

    commands_dir = commands_dir or claude_commands_dir()
    skills_dir = skills_dir or claude_skills_dir()

    metadata: dict[str, Skill] = {}

    if commands_dir.is_dir():
        for md_file in commands_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                skill = parse_frontmatter(content, fallback_name=None)

                if skill:
                    metadata[skill.name] = skill
                else:
                    logger.warning(
                        "command_frontmatter_invalid",
                        path=str(md_file),
                        reason=_frontmatter_failure_reason(content),
                    )
            except OSError:
                continue

    if skills_dir.is_dir():
        for skill_dir in skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_file = skill_dir / "SKILL.md"

            if not skill_file.exists():
                continue

            try:
                content = skill_file.read_text(encoding="utf-8")
                skill = parse_frontmatter(content, fallback_name=skill_dir.name)

                if skill:
                    metadata[skill.name] = skill
            except OSError:
                continue

    return list(metadata.values())


def parse_frontmatter(content: str, fallback_name: str | None) -> Skill | None:
    """Parse YAML frontmatter into a Skill; return None if no frontmatter or name."""

    if not content.startswith("---"):
        return None

    end = content.find("---", 3)

    if end == -1:
        return None

    fm = _yaml.load(content[3:end])

    if not isinstance(fm, dict):
        return None

    name = fm.get("name") or fallback_name

    if not name:
        return None

    argument_hint = fm.get("argument-hint")
    usage = f"/{name} {argument_hint}" if argument_hint else f"/{name}"

    return Skill(
        name=name,
        usage=usage,
        description=fm.get("description"),
        argument_hint=argument_hint,
        allowed_tools=parse_list(fm.get("allowed-tools")),
        model=fm.get("model"),
        effort=fm.get("effort"),
        context=fm.get("context"),
        agent=fm.get("agent"),
        user_invocable=fm.get("user-invocable", True),
        disable_model_invocation=fm.get("disable-model-invocation", False),
        when_to_use=fm.get("when-to-use"),
        paths=parse_list(fm.get("paths")),
        shell=fm.get("shell"),
    )


def parse_list(value) -> list[str] | None:
    """Parse a comma-separated string or YAML list into a list of strings."""

    if isinstance(value, list):
        return [str(item).strip() for item in value]
    elif isinstance(value, str):
        return [item.strip() for item in value.split(",")]
    else:
        return None


def find_skill_source(
    name: str,
    commands_dir: Path | None = None,
    skills_dir: Path | None = None,
) -> Path | None:
    """Resolve `name` to its source `.md` / `SKILL.md` path on disk.

    Mirrors `walk_skills`'s discovery order so the LangGraph `skill` tool can re-read the file at
    invoke time and project its body as the tool result.
    """

    commands_dir = commands_dir or claude_commands_dir()
    skills_dir = skills_dir or claude_skills_dir()

    if commands_dir.is_dir():
        for md_file in commands_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
            except OSError:
                continue

            skill = parse_frontmatter(content, fallback_name=None)

            if skill and skill.name == name:
                return md_file

    if skills_dir.is_dir():
        for skill_dir in skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_file = skill_dir / "SKILL.md"

            if not skill_file.exists():
                continue

            try:
                content = skill_file.read_text(encoding="utf-8")
            except OSError:
                continue

            skill = parse_frontmatter(content, fallback_name=skill_dir.name)

            if skill and skill.name == name:
                return skill_file

    return None


def extract_body(content: str) -> str:
    """Return the post-frontmatter body of a SKILL.md / command .md file.

    The LangGraph `skill` tool projects this as its tool result; the model treats it as turn-level
    instructions identically to Claude's slash-command handling.
    """

    if not content.startswith("---"):
        return content

    end = content.find("---", 3)

    if end == -1:
        return content

    body_start = end + 3

    if body_start < len(content) and content[body_start] == "\n":
        body_start += 1

    return content[body_start:]


def _frontmatter_failure_reason(content: str) -> str:
    """Classify why `parse_frontmatter` rejected `content`, for the discovery-drop log line."""

    if not content.startswith("---"):
        return "no frontmatter"

    end = content.find("---", 3)

    if end == -1:
        return "unterminated frontmatter"

    fm = _yaml.load(content[3:end])

    if not isinstance(fm, dict) or not fm.get("name"):
        return "frontmatter missing 'name'"

    return "unknown"


__all__ = [
    "extract_body",
    "find_skill_source",
    "parse_frontmatter",
    "parse_list",
    "walk_skills",
]
