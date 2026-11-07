# Claudebox

Claudebox runs AI coding agents in disposable containers, one per session, with the agent's full capabilities inside the container and a web interface for long conversations.

Each session gets its own container. The agent has everything it needs inside it and writes nothing on the host beyond the workspace, its session data and its login. The container runs until the session is stopped, and a stopped session keeps its whole history.

![claudebox: an agent tracking todos, researching a spec, and fixing a bug end to end](/claudebox/demo.gif)

## Installation and setup

[**Start here**](start.md) goes from installation to a session that answers a message. The installer does not supply one prerequisite: podman or docker.

Setup guides:

- [Profiles](guide/profiles.md) - the system prompt, hooks, skills and commands an agent runs with
- [Workspaces](guide/workspaces.md) - scoping sessions and credentials per project
- [Configuration](guide/configuration.md) - which settings file wins, the most common keys, and named session bundles
- [Security](guide/security.md) - what a session's container can reach, and what reaches it

## Features

- [Chat](features/chat.md) - collapsing turns, a minimap instead of a scrollbar, a Focused view that leaves out the calls that only read, a session that says when it needs you, a message queue, a right-hand column carrying every shell command or every tool call of the session, and a single-column layout on a phone
- [Threads](features/threads.md) - quote any sentence, reply beside it, and take that reply into a session of its own without stopping the one in view
- [Rendering](features/rendering.md) - markdown, math, callouts, colour swatches, word-level diffs, clickable paths and relative links
- [Diagrams, maps and models](features/diagrams.md) - Mermaid diagrams, GeoJSON maps and STL models drawn in place, each saying so when it cannot be drawn
- [Panels](features/panels.md) - todos, tasks, scheduled prompts, bookmarks, boards, usage, logs and more, docked around the chat
- [Boards](features/boards.md) - a kanban board backed by files in the repository; dragging a ticket into an active column starts a session on it
- [Nested containers](features/nested-containers.md) - the agent builds images and runs services inside its own session
- [The container boundary](features/container-boundary.md) - ports the agent opens to this computer once approved, and ports published from the settings
- [Many sessions](features/multi-session.md) - several workspaces, several containers, and agents that start sessions of their own

[Runtimes](guide/runtimes.md): Claude Code through the Claude Agent SDK, or LangGraph with any LangChain provider, local models included.

## Reference

- [CLI reference](reference/cli.md) - every verb and flag, generated from the parser
- [Configuration reference](reference/configuration.md) - every key, type and default
- [Keyboard shortcuts](reference/shortcuts.md) - generated from what the app binds
- [Specification](SPEC.md) - the full behavior contract
