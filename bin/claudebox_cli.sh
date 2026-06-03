#!/bin/bash
# Claudebox CLI wrapper
set -euo pipefail

SCRIPT_DIR=$(dirname "$(realpath "$0")")
ROOT_DIR=$(realpath "${SCRIPT_DIR}/..")

unset VIRTUAL_ENV

uv run \
  --project "$ROOT_DIR" \
  "$ROOT_DIR"/src/host_cli.py \
  "$@"
