#!/bin/bash
# Container start hook — symlinks profile configs into the container
set -euo pipefail

# Link git config from profile to container home
ln -sf ~/.claudebox/profile/config/.gitconfig ~/

# Link Claude Code extensions from profile
for dir in agents commands skills; do
  if [[ -d ~/.claudebox/profile/$dir ]]; then
    ln -sf ~/.claudebox/profile/"$dir" ~/.claude/
  fi
done

# Copy claude.json as settings (avoids runtime changes propagating to host)
if [[ -f ~/.claudebox/profile/config/claude.json ]]; then
  cp -f ~/.claudebox/profile/config/claude.json ~/.claude/settings.json
fi
