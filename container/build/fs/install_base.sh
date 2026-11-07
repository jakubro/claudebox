#!/bin/bash
# Installs base system deps, mise, and language runtimes; reruns only on a full --rebuild.
set -euo pipefail

source /tmp/claudebox-install/_pins.sh

# Fix apt-get temp dir — /tmp is symlinked to session dir at runtime, _apt user can't traverse it
echo 'Dir::Etc::TmpDir "/var/tmp";' > /etc/apt/apt.conf.d/99tmpdir

# Locale
apt-get install -y --no-install-recommends \
  locales
locale-gen en_US.UTF-8

# Unminimize
yes | unminimize || true

# Install system dependencies
apt-get install -y --no-install-recommends \
  bubblewrap \
  build-essential \
  ca-certificates \
  curl \
  fd-find \
  gettext \
  git \
  gpg \
  gpg-agent \
  jq \
  less \
  pkg-config \
  tree \
  unzip \
  wget

# Install mise runtime manager
fetch_pinned "$PINS" mise "$PLATFORM" /usr/local/bin/mise
chmod 755 /usr/local/bin/mise
eval "$(mise activate bash)"

# Install core language runtimes and tools
mise use -g \
  "python@$(pin_field "$PINS" python - version)" \
  "node@$(pin_field "$PINS" node - version)" \
  "uv@$(pin_field "$PINS" uv - version)" \
  "rust@$(pin_field "$PINS" rust - version)"

# Install just command runner
PATH=~/.cargo/bin:$PATH cargo install just --version "$(pin_field "$PINS" just - version)" --locked

# Install Github CLI
fetch_pinned "$PINS" gh-keyring '*' /etc/apt/keyrings/githubcli-archive-keyring.gpg
chmod 644 /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  >/etc/apt/sources.list.d/github-cli.list
apt-get update -y
apt-get install -y --no-install-recommends \
  gh
