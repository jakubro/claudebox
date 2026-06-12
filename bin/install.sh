#!/bin/bash
# Claudebox installation script
#
# Usage:
#   curl -LsSf https://raw.githubusercontent.com/jakubro/claudebox/main/bin/install.sh | bash
#
set -euo pipefail

LOCK_FILE="$HOME/.claudebox/update.lock"
LOCK_INFO="$HOME/.claudebox/update.lock.info"

# --------------------------------------------------------------------------------------------------
# Core
# --------------------------------------------------------------------------------------------------

# Routes to remote or local installation based on execution context
install_lib() {
  mkdir -p ~/.claudebox

  if [[ -z ${BASH_SOURCE[0]} ]]; then
    # Remote installation via git
    install_lib_remote "$REMOTE_SOURCE_PATH"
  else
    # Local installation via symlink
    local script_dir
    script_dir=$(dirname "$(realpath "${BASH_SOURCE[0]}")")

    local local_source_path
    local_source_path=$(realpath "$script_dir"/..) # root of this repo

    install_lib_symlink "$local_source_path"
  fi
}

# Clones or updates library from remote git repository
install_lib_remote() {
  local source=$1

  print_header "📦 Installing library from $source to ~/.claudebox/lib"

  (
    cd ~/.claudebox

    if [[ -L lib ]]; then
      print_step "Removing previous local installation..."
      unlink lib
      print_success "Removed"
    elif [[ -e lib ]]; then
      print_step "Updating existing installation..."
      if (cd lib && git pull --depth 1); then
        print_success "Updated"
        return
      else
        print_fail "git pull failed"
        print_step "Falling back to full clone..."
        rm -rf lib
      fi
    fi

    git clone --depth 1 "$source" lib
    print_success "Installed"
  )
}

# Creates symlink to local library source for development
install_lib_symlink() {
  local source=$1

  print_header "🔗 Installing library from $source to ~/.claudebox/lib"

  (
    cd ~/.claudebox

    if [[ -L lib ]]; then
      unlink lib
    elif [[ -e lib ]]; then
      print_step "Removing previous remote installation..."
      rm -rf lib
      print_success "Removed"
    fi

    ln -sf "$source" lib
    print_success "Installed"
  )
}

# --------------------------------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------------------------------

# Copies sample configuration to user home directory
install_config() {
  print_header "💾 Installing configuration to ~/.claudebox/settings.toml"

  if [[ -e ~/.claudebox/settings.toml ]]; then
    print_skip "configuration already exists"
    return
  fi
  cp -n ~/.claudebox/lib/etc/settings.sample.toml ~/.claudebox/settings.toml
  print_success "Installed"
}

# Resolves backend: env var > settings.toml > default, persists to config
resolve_backend() {
  if [[ -z $CLAUDEBOX_BACKEND ]]; then
    local backend
    backend=$(read_config_backend)
    CLAUDEBOX_BACKEND=${backend:-podman}
  fi

  write_config_backend "$CLAUDEBOX_BACKEND"
}

# Reads backend value from settings.toml, empty if commented or absent
read_config_backend() {
  local settings=~/.claudebox/settings.toml
  if [[ -f $settings ]]; then
    grep -oP '^\s*backend\s*=\s*"\K[^"]+' "$settings" | head -1
  fi
}

# Writes or updates backend value in settings.toml
write_config_backend() {
  local value=$1
  local settings=~/.claudebox/settings.toml

  local pattern='^#*\s*backend\s*='
  if grep -qP "$pattern" "$settings" 2>/dev/null; then
    sed -i -E "s/$pattern.*/backend = \"$value\"/" "$settings"
  else
    # Insert before first [section] line
    sed -i '/^\[/i backend = "'"$value"'"' "$settings"
  fi
}

# --------------------------------------------------------------------------------------------------
# Apps
# --------------------------------------------------------------------------------------------------

# Installs CLI and daemon wrappers, ensures uv is available, updates PATH if needed
install_cli() {
  print_header "🔧 Installing CLI to ~/.local/bin/claudebox"

  mkdir -p ~/.local/bin

  # Create symlinks to wrapper scripts
  (
    cd ~/.local/bin

    if [[ -L claudebox ]]; then
      unlink claudebox
    elif [[ -e claudebox ]]; then
      print_step "Removing claudebox from ~/.local/bin..."
      rm -rf claudebox
      print_success "Removed"
    fi

    ln -sf ~/.claudebox/lib/bin/claudebox_cli.sh claudebox
    ln -sf ~/.claudebox/lib/bin/claudebox_daemon.sh claudeboxd
  )
  print_success "Installed"

  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    export PATH="$HOME/.local/bin:$PATH"

    # shellcheck disable=SC2016
    echo 'export PATH="$HOME/.local/bin:$PATH"' >>~/.bashrc

    print_warn "~/.local/bin added to PATH in ~/.bashrc"
    print_hint "Run 'source ~/.bashrc' to apply changes in current shell"
  fi
}

# Builds the frontend for host-side daemon serving
build_frontend() {
  print_header "🌐 Building frontend"

  local frontend_dir=~/.claudebox/lib/src/claudebox_frontend

  (
    cd "$frontend_dir"
    npm ci --no-audit --no-fund
    npm run build
  )

  print_success "Built"
}

# Installs systemd service for the daemon process
install_daemon_service() {
  print_header "🔧 Installing daemon service to ~/.config/systemd/user/"

  if ! command -v systemctl &>/dev/null; then
    print_warn "systemd not available — skipping daemon service"
    print_hint "Start manually: claudeboxd"
    return
  fi

  mkdir -p ~/.config/systemd/user

  ln -sf ~/.claudebox/lib/etc/systemd/claudebox-daemon.service ~/.config/systemd/user/

  systemctl --user daemon-reload
  systemctl --user enable claudebox-daemon.service
  systemctl --user restart claudebox-daemon.service

  print_success "Installed"
}

# Installs systemd timer for daily automatic maintenance
install_maintenance_timer() {
  print_header "⌚️ Installing maintenance timer to ~/.config/systemd/user/"

  if ! command -v systemctl &>/dev/null; then
    print_warn "systemd not available — skipping automatic maintenance"
    print_hint "Use '~/.claudebox/lib/bin/install.sh' for manual updates"
    return
  fi

  mkdir -p ~/.config/systemd/user

  ln -sf ~/.claudebox/lib/etc/systemd/claudebox-maintenance.service ~/.config/systemd/user/
  ln -sf ~/.claudebox/lib/etc/systemd/claudebox-maintenance.timer ~/.config/systemd/user/

  systemctl --user daemon-reload
  systemctl --user enable --now claudebox-maintenance.timer

  print_success "Installed"
}

# --------------------------------------------------------------------------------------------------
# Containers
# --------------------------------------------------------------------------------------------------

# Builds container image via claudebox CLI in a temporary directory
build_image() {
  print_header "🐳 Building container image"

  local build_dir="$TMP_DIR"/build
  mkdir -p "$build_dir"

  (
    cd "$build_dir"
    ~/.local/bin/claudebox build --layer agent --verbose "$@"
  )

  print_success "Built"
}

run_prune() {
  print_header "🧹 Pruning resources"

  ~/.local/bin/claudebox prune --verbose
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    print_warn "claudebox prune partial failures (rc=$rc); continuing"
  fi

  print_success "Pruned"
}

# --------------------------------------------------------------------------------------------------
# Runtimes
# --------------------------------------------------------------------------------------------------

# Ensures uv is available
ensure_uv() {
  print_header "📦 Installing uv"

  if command -v uv &>/dev/null; then
    print_skip "already installed"
    return
  fi

  curl -LsSf https://astral.sh/uv/install.sh | /bin/bash
  print_success "Installed"
}

# Ensures Node.js is available
ensure_nodejs() {
  local node_version
  node_version=$(cat ~/.claudebox/lib/.nvmrc)

  ensure_nvm

  print_header "📦 Installing Node.js"

  if nvm ls | grep -q "$node_version"; then
    print_skip "already installed"
  else
    nvm install "$node_version"
    print_success "Installed"
  fi
  nvm use "$node_version"
}

# Ensures nvm is available
ensure_nvm() {
  print_header "📦 Installing nvm"

  if source_nvm; then
    print_skip "already installed"
    return
  fi

  curl -LsSf https://raw.githubusercontent.com/nvm-sh/nvm/master/install | /bin/bash
  source_nvm
  print_success "Installed"
}

# Loads nvm as a shell function
source_nvm() {
  if type nvm &>/dev/null; then
    return 0
  fi

  local nvm_dir="${NVM_DIR:-~/.nvm}"
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    source "$nvm_dir/nvm.sh"
    return 0
  fi

  return 1
}

# Ensures Caddy reverse proxy binary is available
ensure_caddy() {
  print_header "📦 Installing Caddy"

  local caddy_dir=~/.claudebox/bin
  local caddy_bin="$caddy_dir/caddy"

  if [[ -x $caddy_bin ]]; then
    print_skip "already installed"
    return
  fi

  mkdir -p "$caddy_dir"

  # Resolve latest version via GitHub redirect (no API, no rate limits)
  local version
  version=$(
    curl -sSI https://github.com/caddyserver/caddy/releases/latest \
      | grep -i '^location:' \
      | grep -oP 'v\K[0-9.]+'
  )

  local url="https://github.com/caddyserver/caddy/releases/download/v${version}/caddy_${version}_${PLATFORM_OS}_${PLATFORM_ARCH}.tar.gz"

  (
    cd "$TMP_DIR"
    curl -LsSf "$url" -o caddy.tar.gz
    tar xzf caddy.tar.gz caddy
    mv caddy "$caddy_bin"
    chmod +x "$caddy_bin"
  )

  print_success "Installed"
}

# --------------------------------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------------------------------

# Prints a banner box with title, subtitle, and optional footer text (dimmed)
print_banner() {
  local title=$1
  local subtitle=$2
  local footer=${3:-}

  local border
  border=$(printf '─%.0s' $(seq 1 $((COLS - 2))))

  echo "┌${border}┐"
  printf '│ \033[1m%s\033[0m \033[%dG│\n' "$title" "$COLS"
  printf '│ %s \033[%dG│\n' "$subtitle" "$COLS"
  if [[ -n $footer ]]; then
    printf '│ \033[%dG│\n' "$COLS"
    while IFS= read -r line; do
      printf '│ \033[90m%s\033[0m \033[%dG│\n' "$line" "$COLS"
    done <<<"$footer"
  fi
  echo "└${border}┘"
}

# Prints a two-line result box in green
print_result() {
  local border
  border=$(printf '\033[92m─\033[0m%.0s' $(seq 1 $((COLS - 2))))

  echo -e "\033[92m┌\033[0m${border}\033[92m┐\033[0m"
  printf '\033[92m│\033[0m \033[1;92m%s\033[0m \033[%dG\033[92m│\033[0m\n' "$1" "$COLS"
  printf '\033[92m│\033[0m %s \033[%dG\033[92m│\033[0m\n' "$2" "$COLS"
  echo -e "\033[92m└\033[0m${border}\033[92m┘\033[0m"
}

# Prints a header with a horizontal rule and bold title
print_header() {
  local border
  border=$(printf '─%.0s' $(seq 1 "$COLS"))

  echo "$border"
  printf '  \033[1m%s\033[0m\n' "$1"
}

# Prints a 3-space-indented progress line
print_step() {
  echo "   $1"
}

# Prints a 3-space-indented "skipped" line with the ○ glyph
print_skip() {
  echo "   ○ Skipped — $1"
}

# Prints a 3-space-indented success line with the ✓ glyph in light green
print_success() {
  echo -e "   \033[92m✓\033[0m $1"
}

# Prints a 3-space-indented warning line (lowercase 'warning:', ⚠ glyph in yellow)
print_warn() {
  echo -e "   \033[93m⚠\033[0m warning: $1"
}

# Prints a 3-space-indented failure line (lowercase 'error:', ✗ glyph in red)
print_fail() {
  echo -e "   \033[91m✗\033[0m error: $1"
}

# Prints a 3-space-indented follow-up hint (dim → glyph)
print_hint() {
  echo -e "   \033[2m→\033[0m $1"
}

# Prints a top-level abort message (0-space indent, lowercase 'error:', stderr)
print_error_top() {
  echo "error: $1" >&2
}

# --------------------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------------------

# Acquires a non-blocking update lock; on contention, prints caller/timestamp/pid from update.lock.info
acquire_update_lock() {
  mkdir -p "$(dirname "$LOCK_FILE")"
  exec 200>"$LOCK_FILE"

  if ! flock -n 200; then
    if [[ -r $LOCK_INFO ]]; then
      local caller timestamp pid
      caller=$(grep -oP '^caller=\K.*' "$LOCK_INFO" 2>/dev/null || echo "unknown")
      timestamp=$(grep -oP '^timestamp=\K.*' "$LOCK_INFO" 2>/dev/null || echo "unknown")
      pid=$(grep -oP '^pid=\K.*' "$LOCK_INFO" 2>/dev/null || echo "unknown")
      print_error_top "another update is in progress (started by $caller at $timestamp, pid $pid)"
    else
      print_error_top "another update is in progress (lock file held but no info available)"
    fi
    exit 1
  fi

  local caller="manual"
  if [[ -n ${INVOCATION_ID:-} ]]; then
    caller="maintenance-timer"
  fi

  {
    echo "caller=$caller"
    echo "timestamp=$(date -u +%FT%TZ)"
    echo "pid=$$"
  } >"$LOCK_INFO"
}

cleanup() {
  if [[ -n $TMP_DIR ]]; then
    rm -rf "$TMP_DIR"
  fi
  rm -f "$LOCK_INFO"
}

main() {
  REMOTE_SOURCE_PATH=https://github.com/jakubro/claudebox
  TMP_DIR=$(mktemp -d --suffix=.claudebox)
  CLAUDEBOX_BACKEND=${CLAUDEBOX_BACKEND:-}
  COLS=150

  trap cleanup EXIT
  acquire_update_lock

  local license
  license=$(
    cat <<'BANNER'
Copyright (C) 2025-2026  Jakub Roman

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
BANNER
  )

  print_banner \
    "CLAUDEBOX" \
    "Containerized isolation, customizable agent profiles, and a visual web UI — for AI coding agents" \
    "$license"
  echo ""

  PLATFORM_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  PLATFORM_ARCH=$(uname -m)
  case "$PLATFORM_ARCH" in
    x86_64) PLATFORM_ARCH="amd64" ;;
    aarch64) PLATFORM_ARCH="arm64" ;;
    arm64) PLATFORM_ARCH="arm64" ;;
    *)
      print_error_top "unsupported architecture: $PLATFORM_ARCH"
      exit 1
      ;;
  esac

  install_lib
  install_config
  resolve_backend

  ensure_uv
  ensure_nodejs
  ensure_caddy

  install_cli
  build_frontend
  install_daemon_service
  install_maintenance_timer

  build_image "$@"
  run_prune

  echo ""
  print_result "✓ Installation complete" "Claudebox running on https://localhost:41820"
}

main "$@"
