#!/bin/bash
# Image build hook — installs extra tools into the container image
set -euo pipefail

apt-get install -y --no-install-recommends \
  ripgrep \
  nano
