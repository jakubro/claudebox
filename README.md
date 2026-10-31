# Claudebox

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.7.0-blue.svg)](pyproject.toml)
[![Status](https://img.shields.io/badge/status-actively_developed-green.svg)](#)

A web UI for AI coding agents that runs every session in its own container: kanban boards over the ticket files in your repo, reply threads beside the sentence you answer, agents that start and question sessions of their own, live diagrams and diffs in the chat, a terminal beside the transcript, a message queue, a phone layout, and many more.

Every session gets a disposable container with the workspace mounted at the same path it has on the host: the agent runs with full permissions inside it, and outside the workspace it can write only the workspace's session data, its login and any directory you mount for it. Claude Code runs through the Claude Agent SDK by default, or any LangChain provider (Ollama, OpenAI, Gemini, and more) through LangGraph, and a profile supplies the system prompt, hooks, skills, commands and agents each session starts with.

<img src="./docs/demo.gif" alt="claudebox: an agent tracking todos, researching a spec, and fixing a bug end to end" />

## Why use it

- **Long sessions stay readable.** Turns fold, a minimap stands in for the scrollbar, and the Focused view leaves out the calls that only read, so what the agent changed and said is what you scroll through. [Chat](https://jakubro.github.io/claudebox/features/chat/)
- **Agents say when they need you.** A session blocked on you shows the agent's one-line reason in the sessions list, turns its tab's icon red, and can offer up to five one-click replies. [Chat](https://jakubro.github.io/claudebox/features/chat/)
- **Answer the sentence, not the turn.** Quote any span and reply beside it, ask that reply on its own without touching the conversation, and fork the conversation at any message. [Threads](https://jakubro.github.io/claudebox/features/threads/)
- **The chat draws the answer.** Mermaid diagrams, GeoJSON maps, STL models, GitHub callouts, math and word-level diffs render in place. [Rendering](https://jakubro.github.io/claudebox/features/rendering/), [Diagrams, maps and models](https://jakubro.github.io/claudebox/features/diagrams/)
- **Boards are files in your repo.** A `board.yaml` and its ticket files draw as a kanban board, and dropping a ticket into an active column starts a session on it. [Boards](https://jakubro.github.io/claudebox/features/boards/)
- **Agents work alongside each other.** An agent can start, question and read sessions of its own, and with nested containers build images and run services inside its own. [Many sessions](https://jakubro.github.io/claudebox/features/multi-session/)
- **Named starting points.** A settings bundle starts a session on its own model, effort, session prompt, environment and opening messages. [Configuration](https://jakubro.github.io/claudebox/guide/configuration/)

## Prerequisites

- **Podman** or Docker
- **Git**
- **Bash**
- **Python** 3.13+ (managed via [uv](https://docs.astral.sh/uv/), installed automatically if not present)
- **Node.js** 24+ (managed via [nvm](https://github.com/nvm-sh/nvm), installed automatically if not present)

## Installation

> First install builds the container image from scratch — expect 5-15 minutes on first run depending on network and CPU.

```bash
# Podman (default)
curl -LsSf https://raw.githubusercontent.com/jakubro/claudebox/main/bin/install.sh | bash

# Docker
curl -LsSf https://raw.githubusercontent.com/jakubro/claudebox/main/bin/install.sh | CLAUDEBOX_BACKEND=docker bash

# First run - authenticate via TUI (one-time)
claudebox run

# Then open https://localhost:41820
```

This clones the library, builds the frontend and container image, installs the `claudebox` CLI and `claudeboxd` daemon, registers the daemon as a systemd user service, and installs a daily maintenance timer that updates claudebox, rebuilds the container image and prunes old sessions.

## Quick Start

The first launch (`claudebox run`) opens the Claude Code TUI where you complete authentication. Credentials persist across sessions within the same workspace (or globally when no `.workspace` marker is set). After login, you can use either TUI or web mode. To log in without the TUI, run `claudebox run -- claude auth login`; its code prompt shows nothing as you paste - press Enter and the login completes.

The web UI is served by `claudeboxd`, a daemon installed during setup, at [https://localhost:41820](https://localhost:41820). Caddy fronts the daemon with a self-signed TLS certificate; your browser will show a one-time certificate warning that's safe to accept.

> On systems without systemd (e.g. macOS), the daemon service is not installed automatically. Start it manually with `claudeboxd`.

## Documentation

Full documentation is published at **[jakubro.github.io/claudebox](https://jakubro.github.io/claudebox/)**.

- [Start here](https://jakubro.github.io/claudebox/start/) — install, first session, where the files landed, removing it
- [Features](https://jakubro.github.io/claudebox/features/chat/) — chat, threads, rendering, diagrams, panels, boards, nested containers, many sessions
- [Guides](https://jakubro.github.io/claudebox/guide/profiles/) — profiles, workspaces, configuration, runtimes, security, troubleshooting
- [CLI reference](https://jakubro.github.io/claudebox/reference/cli/) — every verb and flag
- [Configuration reference](https://jakubro.github.io/claudebox/reference/configuration/) — every settings key
- [Keyboard shortcuts](https://jakubro.github.io/claudebox/reference/shortcuts/)
- [Specification](https://jakubro.github.io/claudebox/spec/) — the full user-facing behavior contract

Contributor documents live alongside the source: [ARCHITECTURE.md](docs/ARCHITECTURE.md), [GUIDELINES.md](docs/GUIDELINES.md), [TEST-UI.md](docs/TEST-UI.md).

## Security

The container is the trust boundary: inside it the agent can run anything, and outside it the agent can write only the workspace, the workspace's session data, its login and any directory you mount for it. The daemon's web UI has no authentication and listens on every interface, so on a network you do not control, bind it to localhost, firewall the port, or put an authenticating proxy in front of it. The [security guide](https://jakubro.github.io/claudebox/guide/security/) covers what is mounted, what is published and what is read-only.

Claudebox itself is telemetry-free.

## Contributing

```bash
git clone https://github.com/jakubro/claudebox.git
cd claudebox
just install          # python + frontend + e2e deps
just check            # full pre-commit (lint + test)
just --list           # all recipes, grouped
```

Coding conventions, testing patterns, and the development workflow are documented in [`docs/GUIDELINES.md`](docs/GUIDELINES.md). All development commands run from the repository root via the [justfile](justfile).

## Built With

Claudebox is a thin layer over other people's work.

- **Agent runtimes** — [Claude Code](https://github.com/anthropics/claude-code), [Claude Agent SDK](https://docs.anthropic.com/claude/docs/agent-sdk), [LangGraph](https://langchain-ai.github.io/langgraph/), [LangChain](https://www.langchain.com/), [Model Context Protocol](https://modelcontextprotocol.io/), [Ollama](https://ollama.com/)
- **Interface** — [React](https://react.dev/), [Vite](https://vite.dev/), [Dockview](https://dockview.dev/), [dnd kit](https://dndkit.com/), [Floating UI](https://floating-ui.com/), [TanStack Virtual](https://tanstack.com/virtual), [Lucide](https://lucide.dev/)
- **Typefaces** — [Inter](https://rsms.me/inter/), [JetBrains Mono](https://www.jetbrains.com/lp/mono/), [DejaVu](https://dejavu-fonts.github.io/)
- **Rendering** — [react-markdown](https://github.com/remarkjs/react-markdown), [remark/rehype](https://unifiedjs.com/), [Mermaid](https://mermaid.js.org/), [KaTeX](https://katex.org/), [highlight.js](https://highlightjs.org/), [react-syntax-highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter), [DOMPurify](https://github.com/cure53/DOMPurify), [jsdiff](https://github.com/kpdecker/jsdiff), [Leaflet](https://leafletjs.com/), [three.js](https://threejs.org/)
- **Backend** — [FastAPI](https://fastapi.tiangolo.com/), [Starlette](https://www.starlette.io/), [Uvicorn](https://www.uvicorn.org/), [HTTPX](https://www.python-httpx.org/), [Pydantic](https://docs.pydantic.dev/), [structlog](https://www.structlog.org/), [Rich](https://github.com/Textualize/rich), [ruamel.yaml](https://sourceforge.net/projects/ruamel-yaml/), [tree-sitter](https://tree-sitter.github.io/tree-sitter/)
- **Container and toolchain** — [Podman](https://podman.io/), [Docker](https://www.docker.com/), [Ubuntu](https://ubuntu.com/), [Bubblewrap](https://github.com/containers/bubblewrap), [mise](https://mise.jdx.dev/), [uv](https://docs.astral.sh/uv/), [nvm](https://github.com/nvm-sh/nvm), [Node.js](https://nodejs.org/), [just](https://just.systems/), [Caddy](https://caddyserver.com/)
- **Testing and quality** — [Playwright](https://playwright.dev/), [Vitest](https://vitest.dev/), [pytest](https://docs.pytest.org/), [Biome](https://biomejs.dev/), [Ruff](https://docs.astral.sh/ruff/), [ty](https://github.com/astral-sh/ty), [Knip](https://knip.dev/), [jscpd](https://github.com/kucherenko/jscpd)

## License

Copyright (C) 2025-2026 Jakub Roman. Distributed under the [GNU GPL v3](LICENSE).

Third-party licenses and the notices that must accompany a redistributed build are recorded in [NOTICE.md](NOTICE.md).
