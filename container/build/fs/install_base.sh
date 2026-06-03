#!/bin/bash
# Installs base system: system dependencies, mise runtime manager, and language runtimes
# - Container layer rebuilt with --rebuild
set -euo pipefail

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
curl -sSfL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise /bin/bash
eval "$(mise activate bash)"

# Install core language runtimes and tools
mise use -g \
  python@3.13 \
  node@24 \
  uv \
  rust

# Install just command runner
PATH=~/.cargo/bin:$PATH cargo install just

# Install Github CLI
curl -sSfL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  >/etc/apt/sources.list.d/github-cli.list
apt-get update -y
apt-get install -y --no-install-recommends \
  gh
