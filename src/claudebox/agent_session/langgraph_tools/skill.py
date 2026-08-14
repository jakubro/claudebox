"""Skill tool - invoke a workspace skill by name.

Skills are filesystem objects shared with Claude workspaces; discovery via
`agent_session/_skills.py::walk_skills` is runtime-neutral. The LangGraph workspace's skills
panel and slash-command autocomplete gate on the `supports_skills` flag (true for both
runtimes), so the UI lights up with no frontend changes.

`user-invocable` is enforced in `runtime_langgraph._resolve_slash_skill`, not here - a typed
`/<name>` never reaches this tool. `allowed-tools`/`model`/`effort` are unenforced.
"""

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext
from .._skills import extract_body, find_skill_source, parse_frontmatter, walk_skills


def make_skill_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the `skill` invocation tool.

    Closes over `ctx` to keep the make_*_tools(ctx) signature uniform, though unused today;
    a future `ctx.skill_catalog` field could route non-default skill directories through it.
    """

    _ = ctx  # unused; kept for the uniform make_*_tools(ctx) signature.

    @tool
    def skill(name: str, arguments: str | None = None) -> str:
        """Invoke a workspace skill by name; return its body as turn instructions.

        Reads the named skill's SKILL.md (or `<commands_dir>/<name>.md`) and returns the body
        (post-frontmatter) verbatim as turn-level instructions, matching Claude's slash-command
        UX. When `arguments` is given, a trailing `ARGUMENTS: {arguments}` line is appended.
        Named `arguments` rather than `args` to avoid LangChain's reserved `v__args` binding.
        """

        source = find_skill_source(name)

        if source is None:
            available = sorted(s.name for s in walk_skills())
            available_str = ", ".join(available) or "<none>"

            raise ToolException(f"skill: unknown name {name!r}; available: {available_str}")

        try:
            content = source.read_text(encoding="utf-8")
        except OSError as exc:
            raise ToolException(f"skill: failed to read {source}: {exc}") from exc

        parsed = parse_frontmatter(content, fallback_name=name)

        if parsed is not None and parsed.disable_model_invocation:
            raise ToolException(
                f"skill: {name!r} has disable-model-invocation set; it can only be run by "
                "the user typing the command directly, not by the model calling this tool.",
            )

        body = extract_body(content)

        if arguments:
            body = f"{body.rstrip()}\n\nARGUMENTS: {arguments}\n"

        return body

    return [skill]


__all__ = ["make_skill_tools"]
