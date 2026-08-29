#!/bin/bash
# Installs the agent CLI and LangGraph deps; `build --layer agent` reruns just this layer.
set -euo pipefail

# Install Claude Code CLI
mkdir -p ~/.claude ~/.config/mise/conf.d
cat > ~/.config/mise/conf.d/claude-code.toml <<'EOF'
[tools]
"npm:@anthropic-ai/claude-code" = { version = "latest", allow_builds = ["@anthropic-ai/claude-code"] }
EOF
mise install \
  npm:@anthropic-ai/claude-code

# Installs Python deps + all LangGraph provider packages so switching providers is config-only, no install step.
# Resolved fresh (no --frozen) so the daily agent-layer rebuild picks up upstream updates.
(
  cd /tmp/claudebox-install
  export UV_PROJECT_ENVIRONMENT=/opt/claudebox/.venv
  uv sync --extra langgraph-all
)
