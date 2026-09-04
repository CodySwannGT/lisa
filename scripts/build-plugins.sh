#!/usr/bin/env bash
# Generates layered, composable plugin directories from source.
# Each plugin is built standalone — no base content is merged into stack plugins.
# Run via: bun run build:plugins
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Resolved rather than left as `$SCRIPT_DIR/..`, so every destination this
# script writes begins with a literal prefix the manifest below can strip to
# get a repository-relative path. With the `..` left in, that strip produces
# paths that no `git status` pathspec matches.
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGINS_DIR="$ROOT_DIR/plugins"
SRC_DIR="$PLUGINS_DIR/src"

# Read version from package.json so plugins stay in sync with Lisa releases
VERSION=$(node -e "console.log(require('$ROOT_DIR/package.json').version)")

# Materialize a Lisa-owned source file into a copy-overwrite/ template tree.
#
# Never a plain `cp`. These destinations are `copy-overwrite` assets, and a
# `copy-overwrite` asset that reads as editable silently loses downstream
# hardening on the next sync — already observed on block-no-verify.sh. They are
# also the only assets that cannot carry a hand-typed ownership header, because
# this script would erase it on the next build (#2547). So the header is stamped
# here, as the file is generated: the authored source stays honest about being
# editable, the shipped copy states that it is replaced, and the two cannot
# disagree because one produces the other.
#
# Every call is RECORDED, into plugins/materialized-artifacts.json. That file is
# how `check-plugins-sync.sh` knows which paths outside plugins/ this build
# owns. It is a record of what this run actually wrote, not a list anyone
# maintains — a second list is precisely how those destinations went unchecked
# for as long as they did (#3064), and a fix that restated them would be the
# same defect with fresh paint.
materialize() {
  node "$ROOT_DIR/scripts/materialize-copy-overwrite.mjs" "$1" "$2"
  MATERIALIZED_PATHS="${MATERIALIZED_PATHS}${2#"$ROOT_DIR"/}
"
}

MATERIALIZED_PATHS=""
MATERIALIZED_MANIFEST="$PLUGINS_DIR/materialized-artifacts.json"

# Write the manifest of everything `materialize` wrote this run.
#
# On EXIT rather than at the end of the script, so the record covers every call
# no matter where the last one is added. A materialize call appended below the
# final line — the natural place to add one — would otherwise write a file the
# manifest never mentions, which is the reintroduction of the gap.
#
# Only on success: a build that died halfway wrote only some of its
# destinations, and recording that partial set as the truth would turn one
# failed build into a spurious sync failure on the next run.
write_materialized_manifest() {
  local status="$1"
  [ "$status" -eq 0 ] || return 0
  mkdir -p "$PLUGINS_DIR"
  printf '%s' "$MATERIALIZED_PATHS" | node -e '
    const fs = require("node:fs");
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { raw += chunk; });
    process.stdin.on("end", () => {
      const paths = [...new Set(raw.split("\n").filter(Boolean))].sort();
      fs.writeFileSync(process.argv[1], `${JSON.stringify(paths, null, 2)}\n`);
    });
  ' "$MATERIALIZED_MANIFEST"
}

trap 'write_materialized_manifest $?' EXIT

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
    materialize "$SRC_DIR/base/hooks/threshold-ratchet.mjs" \
      "$ratchet_scripts_dir/check-threshold-ratchet.mjs"
    for ratchet_module in threshold-ratchet-families threshold-ratchet-compare; do
      materialize "$SRC_DIR/base/hooks/$ratchet_module.mjs" \
        "$ratchet_scripts_dir/$ratchet_module.mjs"
    done
  done
fi

# Enforcement guards for host projects.
#
# These three are declared in the Lisa plugin, so a container whose plugin
# install fails runs with no PreToolUse enforcement at all — silently. Lisa
# closes that with a repository hook, which reaches a cloud session because it
# is part of the clone; a host project needs the same thing, and has no
# plugins/ directory to fall back on.
#
# Synced rather than hand-copied, for the same reason the ratchet above is: a
# unit test asserts byte-equality, so the shipped guard can never drift from the
# reviewed one.
HOST_GUARD_DIR="$ROOT_DIR/all/copy-overwrite/scripts/lisa-hooks"
if [ -d "$SRC_DIR/base/hooks" ]; then
  mkdir -p "$HOST_GUARD_DIR"
fi
for guard in block-no-verify parity-safety-net block-shell-json-parsing \
  block-instruction-file-edits block-direct-issue-create \
  block-managed-file-edits block-blind-automerge; do
  if [ -f "$SRC_DIR/base/hooks/$guard.sh" ]; then
    materialize "$SRC_DIR/base/hooks/$guard.sh" "$HOST_GUARD_DIR/$guard.sh"
    chmod +x "$HOST_GUARD_DIR/$guard.sh"
  fi
done
# Companions: files a guard resolves as a SIBLING OF ITSELF at run time.
#
# The loop above appends `.sh` to every roster entry, so it can only ever
# deliver a guard's shell half. `parity-safety-net.sh` resolves its heredoc
# classifier at `$(dirname "${BASH_SOURCE[0]}")/parity-safety-net-heredoc.py`,
# and that literal `.sh` was an extension filter no roster entry could get past:
# the plugin trees all carry the classifier, the host tree carried seven `.sh`
# files and nothing else, and the sibling lookup in an applied host checkout
# therefore failed on every machine. The guard fails closed, correctly, so the
# consequence was that EVERY heredoc was blocked in every host project that had
# taken these hooks — permanently, and not fixable by installing anything
# (issue #3483).
#
# Enumerated rather than globbed, for the reason the roster itself is: a file
# appearing in `plugins/src/base/hooks/` is not by itself a decision to ship it
# to hosts. What makes this list safe is that it is not the only thing holding
# the property — `tests/unit/hooks/shipped-hook-companions.test.ts` reads the
# sibling references back out of the shipped scripts, so a companion added to a
# guard and not added here fails as a missing dependency rather than waiting to
# be discovered as a permanent block downstream.
for companion in parity-safety-net-heredoc.py; do
  if [ -f "$SRC_DIR/base/hooks/$companion" ]; then
    materialize "$SRC_DIR/base/hooks/$companion" "$HOST_GUARD_DIR/$companion"
  fi
done
# The Sonar hook wrapper, which ships alongside the guards but is not one.
#
# The guards above are dispatched by lisa-enforcement-fallback.sh and take a tool
# payload with no arguments. This one is invoked by the shim that
# `sonar integrate <agent>` generates, takes the vendor's event name as its only
# argument, and must therefore stay out of that dispatcher's list — it is copied
# here because a host project needs it in its checkout for the same reason the
# guards are, not because it is dispatched the same way.
if [ -f "$SRC_DIR/base/hooks/sonar-secrets.sh" ]; then
  mkdir -p "$HOST_GUARD_DIR"
  materialize "$SRC_DIR/base/hooks/sonar-secrets.sh" \
    "$HOST_GUARD_DIR/sonar-secrets.sh"
  chmod +x "$HOST_GUARD_DIR/sonar-secrets.sh"
fi

# The dispatcher itself, so a host project gets the identical entry point.
# Guarded like the ratchet above: this script is also run against isolated
# fixtures that carry a source tree but none of the repository's own scripts,
# and an unconditional copy fails the whole build there.
if [ -f "$ROOT_DIR/scripts/lisa-enforcement-fallback.sh" ]; then
  mkdir -p "$ROOT_DIR/all/copy-overwrite/scripts"
  materialize "$ROOT_DIR/scripts/lisa-enforcement-fallback.sh" \
    "$ROOT_DIR/all/copy-overwrite/scripts/lisa-enforcement-fallback.sh"
  chmod +x "$ROOT_DIR/all/copy-overwrite/scripts/lisa-enforcement-fallback.sh"
fi

# The shared ESM entry guard, into every lane that has a consumer of it.
#
# Downstream, all of these land flat in one `scripts/` directory, so a single
# `scripts/lib/invoked-as-script.mjs` serves every lane and `./lib/...` resolves
# from each. Inside THIS repo the lanes are separate trees and Lisa's own unit
# tests import the lane copies directly, so each lane that imports the helper
# must carry it or those imports fail to resolve. Synced from one canonical
# source rather than hand-copied, for the same reason the ratchet above is: a
# unit test asserts byte-equality, so the three copies can never drift.
#
# `all` is applied to every project type before the stack lanes, so the copies
# in `typescript` and `expo` are redundant at apply time — they exist for
# in-repo resolution and are byte-identical, so whichever lane writes last
# writes the same bytes.
#
# Guarded on the GENERATOR as well as the source. This script is run against
# isolated fixtures that vendor `scripts/lib/` but not the repository's own
# `scripts/*.mjs`, so testing the source alone would find it present and then
# fail the whole build on a missing materializer.
if [ -f "$ROOT_DIR/scripts/lib/invoked-as-script.mjs" ] &&
  [ -f "$ROOT_DIR/scripts/materialize-copy-overwrite.mjs" ]; then
  for guard_lane in all typescript expo; do
    guard_lib_dir="$ROOT_DIR/$guard_lane/copy-overwrite/scripts/lib"
    mkdir -p "$guard_lib_dir"
    materialize "$ROOT_DIR/scripts/lib/invoked-as-script.mjs" \
      "$guard_lib_dir/invoked-as-script.mjs"
  done
fi

# The shared child-start deadline, into the same lanes, for the same reason.
#
# A guard that starts a child and never bounds it does not hang loudly — it
# returns a VERDICT. `spawnSync` hands back empty streams and a null status when
# it kills a child at its deadline, which is indistinguishable from a program
# that ran and said no, so `status === 0 ? out : null` reads a busy machine as a
# clean negative and the guard says "allow" (#2980).
#
# Materialized rather than hand-copied on exactly the `invoked-as-script`
# reasoning above: downstream every lane lands flat in one `scripts/`, so a
# single `scripts/lib/bounded-spawn.mjs` serves them all and `./lib/...`
# resolves from each, while inside THIS repo the lanes are separate trees whose
# unit tests import the lane copies directly. One canonical source, a
# byte-equality test, and the copies cannot drift.
#
# Guarded on the GENERATOR as well as the source, again for the fixture reason:
# this script runs against isolated fixtures that vendor `scripts/lib/` without
# the repository's own `scripts/*.mjs`.
if [ -f "$ROOT_DIR/scripts/lib/bounded-spawn.mjs" ] &&
  [ -f "$ROOT_DIR/scripts/materialize-copy-overwrite.mjs" ]; then
  for spawn_lane in all typescript expo; do
    spawn_lib_dir="$ROOT_DIR/$spawn_lane/copy-overwrite/scripts/lib"
    mkdir -p "$spawn_lib_dir"
    materialize "$ROOT_DIR/scripts/lib/bounded-spawn.mjs" \
      "$spawn_lib_dir/bounded-spawn.mjs"
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
