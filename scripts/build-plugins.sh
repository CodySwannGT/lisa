#!/usr/bin/env bash
# Generates layered, composable plugin directories from source.
# Each plugin is built standalone — no base content is merged into stack plugins.
# Run via: bun run build:plugins
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
PLUGINS_DIR="$ROOT_DIR/plugins"
SRC_DIR="$PLUGINS_DIR/src"

# Read version from package.json so plugins stay in sync with Lisa releases
VERSION=$(node -e "console.log(require('$ROOT_DIR/package.json').version)")

inject_version() {
  local manifest="$1"
  if [ -f "$manifest" ]; then
    node -e "
      const fs = require('fs');
      const m = JSON.parse(fs.readFileSync('$manifest', 'utf8'));
      m.version = '$VERSION';
      fs.writeFileSync('$manifest', JSON.stringify(m, null, 2) + '\n');
    "
  fi
}

# Build base plugin
BASE_OUT="$PLUGINS_DIR/lisa"
rm -rf "$BASE_OUT"
mkdir -p "$BASE_OUT"
cp -r "$SRC_DIR/base/." "$BASE_OUT/"
inject_version "$BASE_OUT/.claude-plugin/plugin.json"
echo "Built plugins/lisa (v$VERSION)"

# Build stack-specific plugins (NO base copy)
STACKS=(typescript expo nestjs cdk rails)
for stack in "${STACKS[@]}"; do
  STACK_SRC="$SRC_DIR/$stack"
  if [ ! -d "$STACK_SRC" ]; then
    echo "Skipping plugins/lisa-$stack (no source)"
    continue
  fi
  OUT="$PLUGINS_DIR/lisa-$stack"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -r "$STACK_SRC/." "$OUT/"
  inject_version "$OUT/.claude-plugin/plugin.json"
  echo "Built plugins/lisa-$stack (v$VERSION)"
done
