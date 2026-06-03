#!/bin/bash
# Installs agents
# - Container layer rebuilt with --update
set -euo pipefail

# Install Claude Code CLI
mkdir -p ~/.claude
mise install \
  npm:@anthropic-ai/claude-code

# Install Python dependencies
(
  cd /tmp/claudebox-install
  export UV_PROJECT_ENVIRONMENT=/opt/claudebox/.venv
  uv sync
)
