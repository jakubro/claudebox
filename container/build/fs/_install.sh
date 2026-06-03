#!/bin/bash
set -euo pipefail

# Prepare
mkdir -p /tmp/claudebox-install
cd /tmp/claudebox-install
apt-get update -y

if command -v mise &>/dev/null; then
  eval "$(mise activate bash)"
fi

# Execute
"$1"

# Cleanup
apt-get clean -y
rm -rf /tmp/claudebox-install
