#!/usr/bin/env bash
# Generates plugin directories from shared base + stack-specific overrides.
# Run via: bun run build:plugins
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
PLUGINS_DIR="$ROOT_DIR/plugins"
SRC_DIR="$PLUGINS_DIR/src"
BASE_DIR="$SRC_DIR/base"
STACKS=(typescript expo nestjs cdk rails)

# Read version from package.json so plugins stay in sync with Lisa releases
VERSION=$(node -e "console.log(require('$ROOT_DIR/package.json').version)")

for stack in "${STACKS[@]}"; do
  OUT="$PLUGINS_DIR/lisa-$stack"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -r "$BASE_DIR/." "$OUT/"
  STACK_SRC="$SRC_DIR/$stack"
  if [ -d "$STACK_SRC" ]; then
    cp -r "$STACK_SRC/." "$OUT/"
  fi
  # Inject Lisa version into the built plugin manifest
  MANIFEST="$OUT/.claude-plugin/plugin.json"
  if [ -f "$MANIFEST" ]; then
    node -e "
      const fs = require('fs');
      const m = JSON.parse(fs.readFileSync('$MANIFEST', 'utf8'));
      m.version = '$VERSION';
      fs.writeFileSync('$MANIFEST', JSON.stringify(m, null, 2) + '\n');
    "
  fi
  echo "Built plugins/lisa-$stack (v$VERSION)"
done
