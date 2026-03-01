#!/usr/bin/env bash
# Generates plugin directories from shared base + stack-specific overrides.
# Run via: bun run build:plugins
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$SCRIPT_DIR/../plugins"
SRC_DIR="$PLUGINS_DIR/src"
BASE_DIR="$SRC_DIR/base"
STACKS=(typescript expo nestjs cdk rails)

for stack in "${STACKS[@]}"; do
  OUT="$PLUGINS_DIR/lisa-$stack"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -r "$BASE_DIR/." "$OUT/"
  STACK_SRC="$SRC_DIR/$stack"
  if [ -d "$STACK_SRC" ]; then
    cp -r "$STACK_SRC/." "$OUT/"
  fi
  echo "Built plugins/lisa-$stack"
done
