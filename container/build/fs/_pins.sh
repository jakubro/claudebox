#!/bin/bash
# Pin manifest readers for the image build; sourced by the install scripts, as bin/install.sh defines them.
# Note: No 'set -euo pipefail' - this file is sourced and must not leak strict mode to caller

PINS=/tmp/claudebox-install/image-pins.txt
PLATFORM="linux_$(dpkg --print-architecture)"

# Print one field of the manifest row for name and platform; a `*` row matches any platform
pin_field() {
  local manifest=$1 name=$2 platform=$3 field=$4

  awk -v name="$name" -v platform="$platform" -v field="$field" '
    { sub(/#.*/, "") }
    NF == 5 && $1 == name && ($3 == platform || $3 == "*") {
      value = field == "version" ? $2 : field == "sha256" ? $4 : field == "url" ? $5 : ""
      if (field == "url") gsub(/\{version\}/, $2, value)
      print value
      found = 1
      exit
    }
    END { exit found ? 0 : 1 }
  ' "$manifest"
}

# Download a manifest row's file to dest, refusing it unless its sha256 is the pinned one
fetch_pinned() {
  local manifest=$1 name=$2 platform=$3 dest=$4
  local version url expected actual download

  version=$(pin_field "$manifest" "$name" "$platform" version)
  url=$(pin_field "$manifest" "$name" "$platform" url)
  expected=$(pin_field "$manifest" "$name" "$platform" sha256)
  download=$(mktemp)

  curl -fsSL "$url" -o "$download"
  actual=$(sha256sum "$download" | cut -d' ' -f1)

  if [[ $actual != "$expected" ]]; then
    rm -f "$download"
    echo "error: $name $version: $url has sha256 $actual, the manifest pins $expected" >&2
    exit 1
  fi

  mv "$download" "$dest"
}
