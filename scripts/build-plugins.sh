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

# Build one plugin: copy plugins/src/<src_name> -> plugins/<out_name>, inject the
# release version into its Claude manifest, then derive the Codex artifacts.
build_plugin() {
  local src_name="$1"
  local out_name="$2"
  local src="$SRC_DIR/$src_name"
  if [ ! -d "$src" ]; then
    echo "Skipping plugins/$out_name (no source at plugins/src/$src_name)"
    return 0
  fi
  local out="$PLUGINS_DIR/$out_name"
  rm -rf "$out"
  mkdir -p "$out"
  cp -r "$src/." "$out/"
  inject_version "$out/.claude-plugin/plugin.json"
  node "$ROOT_DIR/scripts/generate-codex-plugin-artifacts.mjs" "$out" "$VERSION"
  echo "Built plugins/$out_name (v$VERSION)"
}

# Base plugin
build_plugin base lisa

# Stack-specific plugins (NO base copy)
STACKS=(typescript expo nestjs cdk harper-fabric rails)
for stack in "${STACKS[@]}"; do
  build_plugin "$stack" "lisa-$stack"
done

# Standalone plugins (not language stacks): each builds plugins/src/<name> -> plugins/lisa-<name>
STANDALONE=(wiki)
for name in "${STANDALONE[@]}"; do
  build_plugin "$name" "lisa-$name"
done
