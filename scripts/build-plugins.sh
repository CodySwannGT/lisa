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
  local out="$PLUGINS_DIR/$out_name"
  if [ ! -d "$src" ]; then
    rm -rf "$out"
    echo "Removed plugins/$out_name (no source at plugins/src/$src_name)"
    return 0
  fi
  rm -rf "$out"
  mkdir -p "$out"
  cp -r "$src/." "$out/"
  # Hook scripts are invoked by path from hooks.json, and the marketplace git
  # clone delivers whatever mode is committed — force the exec bit so a source
  # file added without +x can't ship a "Permission denied" hook.
  if [ -d "$out/hooks" ]; then
    find "$out/hooks" -name '*.sh' -exec chmod +x {} +
  fi
  inject_version "$out/.claude-plugin/plugin.json"
  node "$ROOT_DIR/scripts/generate-codex-plugin-artifacts.mjs" "$out" "$VERSION"
  echo "Built plugins/$out_name (v$VERSION)"
}

# Generate a Pattern B per-agent variant for a built plugin.
# Variants are derived from a built Claude artifact at plugins/<src_name>/
# and land at plugins/<out_name>/.
build_per_agent_variant() {
  local agent="$1"
  local src_name="$2"
  local out_name="$3"
  local src="$PLUGINS_DIR/$src_name"
  local out="$PLUGINS_DIR/$out_name"
  if [ ! -d "$src" ]; then
    rm -rf "$out"
    echo "Removed per-agent variant $out_name (no plugins/$src_name source)"
    return 0
  fi
  node "$ROOT_DIR/scripts/generate-${agent}-plugin-artifacts.mjs" "$src" "$out" "$VERSION"
}

# Base plugin
build_plugin base lisa

# Threshold-ratchet comparator: the canonical implementation lives in the base
# plugin's hooks/ (agent-time layer). The pre-commit (husky/lefthook) and CI
# layers in downstream projects run the same file as scripts/
# check-threshold-ratchet.mjs, delivered via the stack templates. Sync the
# copies here so they can never drift; a unit test asserts byte-equality.
if [ -f "$SRC_DIR/base/hooks/threshold-ratchet.mjs" ]; then
  for ratchet_scripts_dir in \
    "$ROOT_DIR/typescript/copy-overwrite/scripts" \
    "$ROOT_DIR/rails/copy-overwrite/scripts"; do
    mkdir -p "$ratchet_scripts_dir"
    # The entry point takes the template check-* naming; its relative imports
    # (threshold-ratchet-*.mjs) keep their canonical names in both trees.
    cp "$SRC_DIR/base/hooks/threshold-ratchet.mjs" \
      "$ratchet_scripts_dir/check-threshold-ratchet.mjs"
    cp "$SRC_DIR/base/hooks/threshold-ratchet-families.mjs" \
      "$SRC_DIR/base/hooks/threshold-ratchet-compare.mjs" \
      "$ratchet_scripts_dir/"
  done
fi

# Stack-specific plugins (NO base copy)
STACKS=(typescript expo nestjs cdk harper-fabric phaser rails)
for stack in "${STACKS[@]}"; do
  build_plugin "$stack" "lisa-$stack"
done

# Standalone plugins (not language stacks): each builds plugins/src/<name> -> plugins/lisa-<name>
STANDALONE=(wiki openclaw)
for name in "${STANDALONE[@]}"; do
  build_plugin "$name" "lisa-$name"
done

# Pattern B per-agent variants. Codex is NOT generated as a separate
# plugins/lisa-codex/ artifact — Codex reads .codex-plugin/plugin.json from the
# Claude artifact directly (the existing dual-pointer pattern, preserved per
# wiki/architecture/pattern-b-fan-out-spec.md).
#
# Fan out EVERY built Claude plugin (base + every stack + standalones) to each
# per-agent runtime so cursor/agy/copilot reach parity with Claude/Codex on
# stack-specific functionality, not just the base governance plugin. The base
# keeps its short name `lisa-<agent>`; every other plugin becomes
# `<plugin>-<agent>` (e.g. lisa-typescript-cursor).
PER_AGENT_VARIANTS=(cursor agy copilot)
FANOUT_SOURCES=(lisa)
for stack in "${STACKS[@]}"; do FANOUT_SOURCES+=("lisa-$stack"); done
for name in "${STANDALONE[@]}"; do FANOUT_SOURCES+=("lisa-$name"); done
for agent in "${PER_AGENT_VARIANTS[@]}"; do
  for src_name in "${FANOUT_SOURCES[@]}"; do
    if [ "$src_name" = "lisa" ]; then
      out_name="lisa-$agent"
    else
      out_name="$src_name-$agent"
    fi
    build_per_agent_variant "$agent" "$src_name" "$out_name"
  done
done
