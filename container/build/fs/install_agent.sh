#!/bin/bash
# Installs agents
# - Container layer rebuilt with --update
set -euo pipefail

# Install Claude Code CLI
mkdir -p ~/.claude
mise install \
  npm:@anthropic-ai/claude-code

# Install Python dependencies + all LangGraph provider packages, so switching to
# any provider is config-only with no in-container install step. Resolved fresh
# (no --frozen) so the daily agent-layer rebuild picks up upstream updates.
(
  cd /tmp/claudebox-install
  export UV_PROJECT_ENVIRONMENT=/opt/claudebox/.venv
  uv sync --extra langgraph-all
)
