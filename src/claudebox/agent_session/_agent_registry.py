"""Agent registry - named AgentDefinitions for sub-agent dispatch.

Runtime-neutral catalog the LangGraph `task` tool reads for `agent_type`
lookup; a future change will parse workspace CLAUDE.md / profile-level
definitions for cross-runtime parity. v1 ships one hardcoded
`general-purpose` entry so the surface lights up without yet binding to
workspace fixtures.

The dataclasses are intentionally minimal: a name, a system prompt, and an
optional allowlist of tool names. The allowlist is interpreted by the
caller (LangGraph filters the sub-agent's bound tool list after the
recursive `make_tools(sub_ctx)`); `None` means "every tool the parent has".
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentDefinition:
    """Named sub-agent profile: system prompt + tool allowlist.

    `tools` is an allowlist of tool names. `None` means the sub-agent
    inherits the parent's full toolset; an empty list grants no tools.
    """

    name: str
    system_prompt: str
    tools: tuple[str, ...] | None


GENERAL_PURPOSE = AgentDefinition(
    name="general-purpose",
    system_prompt=(
        "You are a focused sub-agent dispatched by a parent agent for a single "
        "task. Use the tools available to you to complete the work, then return "
        "a concise final report describing what you did and what you found. Do "
        "not ask clarifying questions; if the request is ambiguous, make a "
        "reasonable interpretation and proceed."
    ),
    tools=None,
)


@dataclass(frozen=True)
class AgentRegistry:
    """Read-only lookup of named AgentDefinitions."""

    definitions: dict[str, AgentDefinition]

    def get(self, name: str) -> AgentDefinition | None:
        """Return the AgentDefinition with `name`, or None when unknown."""

        return self.definitions.get(name)

    def names(self) -> list[str]:
        """Return every registered agent name, sorted for stable error rendering."""

        return sorted(self.definitions)


def default_registry() -> AgentRegistry:
    """Construct the shipped registry: just `general-purpose` at v1."""

    return AgentRegistry(definitions={GENERAL_PURPOSE.name: GENERAL_PURPOSE})
