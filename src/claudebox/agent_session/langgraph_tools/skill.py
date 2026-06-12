"""Skill tool - invoke a workspace skill by name.

Reads the named SKILL.md (or `<commands_dir>/<name>.md`) and returns its body
(post-frontmatter) as the tool result. When `args` is supplied, appends a
trailing `ARGUMENTS: {args}` line so the model sees the user's slash-command
input the same way Claude's slash dispatcher passes it.

Skills are filesystem objects shared with Claude workspaces. Discovery via
`agent_session/_skills.py::walk_skills` is runtime-neutral. The LangGraph
workspace's skills panel + slash-command autocomplete gate on the
`supports_skills` capability flag (True for both runtimes); the UI lights up
automatically with no frontend code changes.
"""

from langchain_core.tools import BaseTool, ToolException, tool

from ._context import ToolContext
from .._skills import extract_body, find_skill_source, walk_skills


def make_skill_tools(ctx: ToolContext) -> list[BaseTool]:
    """Bind the `skill` invocation tool.

    Closes over `ctx` to keep the signature uniform, even
    though this tool reads nothing off the context today; future versions
    may route the catalog through a `ctx.skill_catalog` field on workspaces
    with non-default skill directories.
    """

    _ = ctx  # unused; kept for the uniform make_*_tools(ctx) signature.

    @tool
    def skill(name: str, arguments: str | None = None) -> str:
        """Invoke a workspace skill by name; return its body as turn instructions.

        Reads the named skill's SKILL.md (or `<commands_dir>/<name>.md`) from
        the workspace catalog. The body content (post-frontmatter) is returned
        verbatim - the model treats it as additional turn-level instructions,
        matching Claude's slash-command UX. When `arguments` is provided, a
        trailing `ARGUMENTS: {arguments}` line is appended so the skill can
        react to user input forwarded through the call. The parameter is
        named `arguments` rather than `args` to avoid LangChain's reserved
        `v__args` varargs binding.
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

        body = extract_body(content)

        if arguments:
            body = f"{body.rstrip()}\n\nARGUMENTS: {arguments}\n"

        return body

    return [skill]


__all__ = ["make_skill_tools"]
