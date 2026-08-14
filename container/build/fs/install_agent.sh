#!/bin/bash
# Installs the agent CLI and LangGraph deps; --update reruns just this layer, skipping a full --rebuild.
set -euo pipefail

# Install Claude Code CLI
mkdir -p ~/.claude
mise install \
  npm:@anthropic-ai/claude-code

# Installs Python deps + all LangGraph provider packages so switching providers is config-only, no install step.
# Resolved fresh (no --frozen) so the daily agent-layer rebuild picks up upstream updates.
(
  cd /tmp/claudebox-install
  export UV_PROJECT_ENVIRONMENT=/opt/claudebox/.venv
  uv sync --extra langgraph-all
)
