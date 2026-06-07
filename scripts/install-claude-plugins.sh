#!/usr/bin/env bash
# Registers the Lisa marketplace and installs required Claude Code plugins.
# Runs as Lisa's postinstall lifecycle script.
set -euo pipefail

PROJECT_ROOT="${npm_config_local_prefix:-${INIT_CWD:-}}"
if [ -z "$PROJECT_ROOT" ]; then exit 0; fi

LISA_DIR="$PROJECT_ROOT/node_modules/@codyswann/lisa"
if [ ! -d "$LISA_DIR" ]; then exit 0; fi

# Skip running Lisa on itself — the Lisa repo IS the template source.
# Self-running causes chicken-and-egg issues (npm package deletes source files).
PACKAGE_NAME=$(node -e "console.log(require('$PROJECT_ROOT/package.json').name || '')" 2>/dev/null || true)
if [ "$PACKAGE_NAME" = "@codyswann/lisa" ]; then exit 0; fi

cd "$PROJECT_ROOT"

# Apply Lisa templates non-interactively (init when missing, update when present),
# EXCEPT in CI. --skip-git-check bypasses the dirty working directory check since
# package.json and the lockfile are always uncommitted during postinstall.
#
# CI skip: matches the established Lisa philosophy (see ensure-lisa-postinstall
# migration and tests/unit/config/postinstall-ci-guard.test.ts) — in CI the
# committed tree is the source of truth and the PR diff is the drift detector, so
# silently re-applying templates during `bun install --frozen-lockfile` would
# churn package.json/lockfile and mask drift. Local installs self-heal; CI does not.
#
# Crash safety (local path): pre-#318 this could leave a half-applied tree — the
# TypeScript phase wrote tsconfig.json/eslint.config.ts and a child stack
# (expo/cdk/nestjs) phase was expected to overwrite them; if the package manager
# killed the lifecycle process between those phases, the child stack was left with
# the TypeScript versions. The apply now pre-resolves copy-overwrite ownership so
# each path is written exactly once by its most-specific stack — there is no
# intermediate clobbered state to be interrupted in. See src/core/lisa.ts
# loadCopyOverwriteOwnership.
if [ -z "${CI:-}" ]; then
  if ! node "$LISA_DIR/dist/index.js" --yes --skip-git-check "$PROJECT_ROOT"; then
    echo "⚠️  Warning: Lisa template application failed. Migration may be incomplete." >&2
  fi
fi

# Strip only hook entries that reference deleted .claude/hooks/*.sh scripts
# (hooks moved to plugin.json; file-path hooks would produce "No such file or directory" errors).
# Preserve inline command hooks (e.g. `command -v entire ...`, `echo ...`) and stack-template hooks
# from rails/merge/.claude/settings.json.
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
if [ -f "$SETTINGS_FILE" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$SETTINGS_FILE" <<'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    d = json.load(f)

hooks = d.get("hooks")
if not isinstance(hooks, dict):
    sys.exit(0)

def is_stale(entry):
    # Stale = hook entry whose command references the deleted .claude/hooks/ dir.
    if not isinstance(entry, dict):
        return False
    cmd = entry.get("command", "")
    return isinstance(cmd, str) and "$CLAUDE_PROJECT_DIR/.claude/hooks/" in cmd

changed = False
new_hooks = {}
for category, matchers in hooks.items():
    if not isinstance(matchers, list):
        new_hooks[category] = matchers
        continue
    new_matchers = []
    for matcher in matchers:
        if not isinstance(matcher, dict):
            new_matchers.append(matcher)
            continue
        if "hooks" not in matcher:
            new_matchers.append(matcher)
            continue

        entries = matcher.get("hooks")
        if isinstance(entries, list):
            kept = [e for e in entries if not is_stale(e)]
            if len(kept) != len(entries):
                changed = True
            if kept:
                new_matcher = dict(matcher)
                new_matcher["hooks"] = kept
                new_matchers.append(new_matcher)
            elif entries:
                # drop matcher only when pruning emptied a previously non-empty hooks list
                changed = True
            else:
                # preserve pre-existing empty matcher blocks unchanged
                new_matchers.append(matcher)
        else:
            new_matchers.append(matcher)
    if new_matchers:
        new_hooks[category] = new_matchers
    else:
        # drop empty category
        changed = True

if changed:
    if new_hooks:
        d["hooks"] = new_hooks
    else:
        del d["hooks"]
    with open(path, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
PYEOF
fi

# Remove the legacy cc-safety-net inline rules file (self-heal existing projects).
#
# Lisa historically shipped a project-root `.safety-net.json` (the cc-safety-net
# <=0.9.0 inline-rules format) via all/copy-overwrite/. cc-safety-net 1.0.1
# dropped that format entirely: its PreToolUse Bash guard now treats a
# project-level `.safety-net.json` as a "legacy rules config location" and FAILS
# CLOSED — denying EVERY Bash command (even `echo`/`ls`) with "legacy rules
# config location is no longer used; ask the user to run `npx -y cc-safety-net
# rule migrate`" — while `rule migrate` cannot convert it (it only looks for a
# global ~/.cc-safety-net/config.json). The result bricks the agent, and on an
# unattended/scheduled run there is no human to intervene.
#
# 1.0.1 runs fine on its built-in rules with no config file, and Lisa's own
# block-no-verify.sh + parity-safety-net.sh hooks already enforce --no-verify and
# destructive-command guards across every agent, so the file is now dead weight.
# Lisa no longer ships it (removed from all/copy-overwrite/), but copy-overwrite
# never deletes, so already-provisioned projects keep a stale copy. Remove it
# here — but ONLY the Lisa-shipped file (identified by its marker rule name), so a
# project's own hand-authored `.safety-net.json` is never touched.
LEGACY_SAFETY_NET="$PROJECT_ROOT/.safety-net.json"
if [ -f "$LEGACY_SAFETY_NET" ] && command -v jq >/dev/null 2>&1; then
  if jq -e '
    (.rules | type == "array")
    and ([.rules[]?.name] | index("block-git-commit-no-verify") != null)
    and ([.rules[]?.name] | index("block-git-push-no-verify") != null)
  ' "$LEGACY_SAFETY_NET" >/dev/null 2>&1; then
    rm -f "$LEGACY_SAFETY_NET" \
      && echo "Removed legacy .safety-net.json (incompatible with cc-safety-net >=1.0.0; using built-in + Lisa-native guards)."
  fi
fi

# Install plugins only when claude CLI is available
if ! command -v claude &>/dev/null; then exit 0; fi

# The Lisa marketplace is registered via extraKnownMarketplaces in .claude/settings.json
# pointing to the GitHub repo (CodySwannGT/lisa). Built plugins are committed to the repo
# so relative paths in marketplace.json resolve correctly.

# Heal stale local registrations of the "lisa" marketplace.
# Earlier Lisa versions (pre-2.0) registered node_modules/@codyswann/lisa as a
# *local* marketplace named "lisa" via `claude marketplace add "$LISA_DIR"`.
# That registration persists in the host project's claude state across upgrades
# and shadows the github source declared in extraKnownMarketplaces, which makes
# Claude Code's plugin UI mark the lisa plugin as a local plugin and refuse the
# "Update now" action with: "Local plugins cannot be updated remotely."
# If we detect a non-github marketplace named "lisa", uninstall the plugins
# sourced from it and remove the registration so the github source can take over.
if command -v jq >/dev/null 2>&1; then
  STALE_LISA_SOURCE=$(claude plugin marketplace list --json 2>/dev/null \
    | jq -r '.[] | select(.name == "lisa" and .source != "github") | .source' 2>/dev/null \
    | head -n 1)
  if [ -n "${STALE_LISA_SOURCE:-}" ]; then
    for stale_plugin in "lisa@lisa" "lisa-typescript@lisa" "lisa-expo@lisa" "lisa-nestjs@lisa" "lisa-cdk@lisa" "lisa-harper-fabric@lisa" "lisa-rails@lisa"; do
      claude plugin uninstall "$stale_plugin" --scope project </dev/null >/dev/null 2>&1 || true
    done
    claude plugin marketplace remove lisa </dev/null >/dev/null 2>&1 || true
  fi
fi

# Heal stale "local plugin" classification (heal-v2).
#
# Lisa marketplace v2.9+ switched plugin source declarations from bare
# relative-path strings (e.g. "source": "./plugins/lisa-expo") to object-form
# `git-subdir` sources. The relative-path form caused Claude Code's /plugin UI
# to classify each plugin as local — the UI showed "Local plugins cannot be
# updated remotely. To update, modify the source at: ./plugins/lisa-expo" and
# disabled the "Update now" action even though the marketplace itself was
# github-sourced.
#
# Plugins installed against the old marketplace.json schema retain that local
# classification until they're reinstalled. This block refreshes the cached
# marketplace.json, detects the new schema, and force-reinstalls already-
# installed lisa-* plugins so they get re-resolved as remote. Worktrees under
# .claude/worktrees/ have their own per-cwd plugin install state and are
# healed in the same pass. A marker file gates one-time execution per cwd.
LISA_PLUGINS=("lisa@lisa" "lisa-typescript@lisa" "lisa-expo@lisa" "lisa-nestjs@lisa" "lisa-cdk@lisa" "lisa-harper-fabric@lisa" "lisa-rails@lisa")
HEAL_V2_MARKER_NAME=".lisa-marketplace-heal-v2"

heal_local_classification() {
  local cwd="$1"
  local installed_for_cwd="$2"
  local marker="$cwd/.claude/$HEAL_V2_MARKER_NAME"
  [ -f "$marker" ] && return 0

  # Important: do ALL uninstalls before ANY reinstall.
  # Interleaved uninstall/install across sibling lisa-* plugins wipes other
  # plugins' cache directories under ~/.claude/plugins/cache/lisa/, leaving
  # later reinstalls with phantom installPaths and the /plugin UI hiding the
  # base lisa plugin entirely. Batched ordering keeps all caches intact.
  local to_heal=()
  local plugin
  for plugin in "${LISA_PLUGINS[@]}"; do
    if printf '%s\n' "$installed_for_cwd" | grep -qx "$plugin"; then
      to_heal+=("$plugin")
    fi
  done

  if [ "${#to_heal[@]}" -gt 0 ]; then
    (
      cd "$cwd" || exit 0
      for plugin in "${to_heal[@]}"; do
        claude plugin uninstall "$plugin" --scope project </dev/null >/dev/null 2>&1 || true
      done
      for plugin in "${to_heal[@]}"; do
        claude plugin install "$plugin" --scope project </dev/null >/dev/null 2>&1 || true
      done
    )
  fi
  mkdir -p "$cwd/.claude"
  touch "$marker"
}

if command -v jq >/dev/null 2>&1; then
  # Refresh the cached marketplace.json so we're reading the latest schema.
  claude plugin marketplace update lisa </dev/null >/dev/null 2>&1 || true

  MARKETPLACE_JSON_PATH="$HOME/.claude/plugins/marketplaces/lisa/.claude-plugin/marketplace.json"
  NEW_SCHEMA="false"
  if [ -f "$MARKETPLACE_JSON_PATH" ]; then
    NEW_SCHEMA=$(jq -r '[.plugins[]? | select((.source | type) == "object")] | length > 0' "$MARKETPLACE_JSON_PATH" 2>/dev/null || echo "false")
  fi

  if [ "$NEW_SCHEMA" = "true" ]; then
    PLUGIN_LIST_JSON=$(claude plugin list --json 2>/dev/null || echo "[]")

    INSTALLED_FOR_PROJECT=$(printf '%s' "$PLUGIN_LIST_JSON" | jq -r --arg cwd "$PROJECT_ROOT" '.[] | select(.projectPath == $cwd) | .id' 2>/dev/null || true)
    heal_local_classification "$PROJECT_ROOT" "$INSTALLED_FOR_PROJECT"

    if [ -d "$PROJECT_ROOT/.claude/worktrees" ]; then
      for worktree_dir in "$PROJECT_ROOT/.claude/worktrees"/*/; do
        worktree_dir="${worktree_dir%/}"
        [ -d "$worktree_dir" ] || continue
        INSTALLED_FOR_WORKTREE=$(printf '%s' "$PLUGIN_LIST_JSON" | jq -r --arg cwd "$worktree_dir" '.[] | select(.projectPath == $cwd) | .id' 2>/dev/null || true)
        heal_local_classification "$worktree_dir" "$INSTALLED_FOR_WORKTREE"
      done
    fi
  fi
fi

# Always install the base plugin (universal governance for all projects)
claude plugin install "lisa@lisa" --scope project </dev/null 2>&1 || true

# Detect which stack plugin to install from .claude/settings.json
LISA_STACK=""
if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
  for stack in expo nestjs cdk harper-fabric rails; do
    if jq -e "(.enabledPlugins // {}) | has(\"lisa-${stack}@lisa\")" "$SETTINGS_FILE" >/dev/null 2>&1; then
      LISA_STACK="$stack"
      break
    fi
  done
fi

# Install typescript layer for all TS-based stacks (everything except rails)
case "$LISA_STACK" in
  rails) ;; # Rails doesn't get typescript plugin
  *)
    claude plugin install "lisa-typescript@lisa" --scope project </dev/null 2>&1 || true
    ;;
esac

# Install stack-specific plugin if not plain typescript
if [ -n "$LISA_STACK" ]; then
  claude plugin install "lisa-${LISA_STACK}@lisa" --scope project </dev/null 2>&1 || true
fi

# Uninstall old monolithic plugins during migration
for old_plugin in "lisa-typescript@lisa" "lisa-expo@lisa" "lisa-nestjs@lisa" "lisa-cdk@lisa" "lisa-harper-fabric@lisa" "lisa-rails@lisa"; do
  # Skip if it's the same as what we just installed
  case "$LISA_STACK" in
    "") [ "$old_plugin" = "lisa-typescript@lisa" ] && continue ;;
    *) [ "$old_plugin" = "lisa-${LISA_STACK}@lisa" ] && continue
       [ "$old_plugin" = "lisa-typescript@lisa" ] && [ "$LISA_STACK" != "rails" ] && continue ;;
  esac
done

# Install third-party plugins required by all Lisa stacks
for plugin in \
  "typescript-lsp@claude-plugins-official" \
  "code-simplifier@claude-plugins-official" \
  "code-review@claude-plugins-official" \
  "coderabbit@claude-plugins-official" \
  "sentry@claude-plugins-official" \
  "skill-creator@claude-plugins-official" \
  "atlassian@claude-plugins-official" \
  "safety-net@cc-marketplace"; do
  claude plugin install "$plugin" --scope project </dev/null 2>&1 || true
done

# Install stack-specific third-party plugins
if [ "$LISA_STACK" = "expo" ] || [ "$LISA_STACK" = "harper-fabric" ]; then
  for plugin in \
    "playwright@claude-plugins-official" \
    "posthog@claude-plugins-official"; do
    claude plugin install "$plugin" --scope project </dev/null 2>&1 || true
  done
fi
