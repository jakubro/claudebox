#!/bin/bash
# Container entrypoint
# - Launches agent:           ./entrypoint.sh OR ./entrypoint.sh -- [<arg>...]
# - Launches custom command:  ./entrypoint.sh <cmd> [<arg>...]
set -euo pipefail

# Executes profile hook once container starts
on-container-start-hook() {
  local hook_file=~/.claudebox/profile/hooks/container-start.sh

  if [[ -e $hook_file ]]; then
    source "$hook_file"
  fi
}

# Executes profile hook before container ends
on-container-end-hook() {
  local hook_file=~/.claudebox/profile/hooks/container-end.sh

  if [[ -e $hook_file ]]; then
    source "$hook_file"
  fi
}

main() {
  local cmd=()

  mkdir -p /run/claudebox

  # Hooks
  trap on-container-end-hook EXIT
  on-container-start-hook

  # Agent mode
  if [[ $# == 0 ]] || [[ $1 == "--" ]]; then
    shift || true
    cmd+=(~/.local/bin/claudebox-agent "$CLAUDEBOX_AGENT")
  fi

  # Verbose mode
  if [[ ${CLAUDEBOX_VERBOSE:-0} == 1 ]]; then
    echo "${cmd[@]}" "$@"
  fi

  # Execute command
  "${cmd[@]}" "$@"
}

main "$@"
