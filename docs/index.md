# Claudebox

Run AI coding agents in disposable containers - one per session, full agent capabilities, and a
web interface built for conversations long enough to get lost in.

Each session gets its own container. The agent has everything it needs inside it and no reach
outside the workspace you mounted. When you close the tab, the container goes with it.

![claudebox: an agent tracking todos, researching a spec, and fixing a bug end to end](/claudebox/demo.gif)

## I want to run agents in isolation

[**Start here**](start.md) takes you from nothing to a session that answers a message. One
prerequisite the installer will not supply for you: podman or docker.

Then the three things people configure first:

- [Profiles](guide/profiles.md) - the system prompt, hooks, skills and commands your agent runs with
- [Workspaces](guide/workspaces.md) - scoping sessions and credentials per project
- [Configuration](guide/configuration.md) - which settings file wins, and the keys worth knowing

## I want to see what it does

The interface is the reason to use this rather than a terminal.

- [Chat](features/chat.md) - collapsing turns, a minimap instead of a scrollbar, a message queue, a right-hand column carrying every shell command or every tool call of the session, and a single-column layout on a phone
- [Threads](features/threads.md) - quote any sentence, reply beside it, and take that reply into a session of its own without stopping the one you are reading
- [Rendering](features/rendering.md) - markdown, math, word-level diffs, clickable paths, and Mermaid diagrams that say so when they fail
- [Panels](features/panels.md) - todos, tasks, bookmarks, boards, usage and logs, docked around the chat
- [Boards](features/boards.md) - a kanban board backed by files in your repository; drag a ticket into an active column and a session starts on it
- [Nested containers](features/nested-containers.md) - let the agent build images and run services inside its own session
- [Many sessions](features/multi-session.md) - several workspaces, several containers, and agents that start sessions of their own

Not tied to one model: [either runtime](guide/runtimes.md), and through LangGraph any LangChain
provider, including models on your own machine.

## I want the details

- [CLI reference](reference/cli.md) - every verb and flag, generated from the parser
- [Configuration reference](reference/configuration.md) - every key, type and default
- [Keyboard shortcuts](reference/shortcuts.md) - generated from what the app binds
- [Specification](SPEC.md) - the full behavior contract
