#!/usr/bin/env bash
# Applies Lisa project configuration and installs required Claude Code plugins.
# Runs as Lisa's postinstall lifecycle script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PACKAGE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

case "$PACKAGE_ROOT" in
  */node_modules/.pnpm/*/node_modules/@codyswann/lisa)
    PROJECT_ROOT="${PACKAGE_ROOT%%/node_modules/.pnpm/*}"
    ;;
  */node_modules/@codyswann/lisa)
    PROJECT_ROOT="$(cd "$PACKAGE_ROOT/../../.." && pwd -P)"
    ;;
  *)
    PROJECT_ROOT="$PACKAGE_ROOT"
    ;;
esac

sanitize_package_manager_env() {
  local env_name
  while IFS='=' read -r env_name _; do
    case "$env_name" in
      npm_config_*|npm_package_*|npm_lifecycle_*)
        # bash cannot unset names that are not valid identifiers (e.g.
        # npm_package_bin_setup-deploy-key, exported when a package's bin map
        # has hyphenated keys — Lisa's own does); under `set -e` that failure
        # aborts the whole postinstall. Skip them: they cannot be referenced
        # by child scripts either, so leaving them is inert.
        if [[ "$env_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
          unset "$env_name"
        fi
        ;;
    esac
  done < <(env)

  unset INIT_CWD npm_node_execpath npm_execpath PROJECT_CWD BUN_INSTALL_CACHE_DIR
}

sanitize_package_manager_env

SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"

detect_lisa_stack() {
  local settings_file="$1"
  [ -f "$settings_file" ] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  local stack
  for stack in expo nestjs cdk harper-fabric rails; do
    if jq -e "(.enabledPlugins // {}) | has(\"lisa-${stack}@lisa\")" "$settings_file" >/dev/null 2>&1; then
      printf '%s\n' "$stack"
      return 0
    fi
  done
}

# One-time migration marker: once the user-wide Codex registrations are
# confirmed retired, skip the `codex plugin marketplace list` probe (a codex
# CLI spawn) on every subsequent install.
CODEX_RETIRE_MARKER="$HOME/.codex/.lisa-legacy-plugins-retired"

write_codex_retire_marker() {
  mkdir -p "$HOME/.codex" 2>/dev/null && touch "$CODEX_RETIRE_MARKER" 2>/dev/null || true
}

remove_user_wide_codex_lisa_plugins() {
  command -v codex >/dev/null 2>&1 || return 0

  # The marker is written only after the cleanup actually ran or was confirmed
  # unnecessary — never on the CODEX_THREAD_ID deferral below, which must
  # retry on a later install (see fix/defer-codex-retirement-postinstall).
  [ -f "$CODEX_RETIRE_MARKER" ] && return 0

  # Removing a plugin relocates its cache directory. A running Codex session
  # has already captured absolute hook paths, so removal inside that session
  # turns every later hook invocation into an EPIPE/broken-pipe failure. Defer
  # the one-time cleanup until the install runs outside an active Codex thread.
  if [ -n "${CODEX_THREAD_ID:-}" ]; then
    echo "Lisa legacy Codex plugin cleanup deferred; restart Codex and rerun bun install." >&2
    return 0
  fi

  # Lisa used to register Codex plugins in the user config from a dependency
  # postinstall. Project-local `lisa apply` now owns every Codex artifact. Only
  # run this migration while the known user-wide marketplace still exists.
  local marketplaces
  marketplaces="$(codex plugin marketplace list --json </dev/null 2>/dev/null || true)"
  if ! printf '%s' "$marketplaces" | node -e '
    const chunks = [];
    process.stdin.on("data", chunk => chunks.push(chunk));
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        process.exit(parsed.marketplaces?.some(item => item?.name === "lisa") ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  '; then
    write_codex_retire_marker
    return 0
  fi

  local plugin
  for plugin in \
    lisa \
    lisa-typescript \
    lisa-expo \
    lisa-nestjs \
    lisa-cdk \
    lisa-harper-fabric \
    lisa-phaser \
    lisa-rails \
    lisa-wiki \
    lisa-openclaw; do
    codex plugin remove "${plugin}@lisa" </dev/null >/dev/null 2>&1 || true
  done
  codex plugin marketplace remove lisa </dev/null >/dev/null 2>&1 || true
  write_codex_retire_marker
}

# Skip running Lisa's full template engine on itself — the Lisa repo IS the
# template source. The self path reconciles only the project Codex overlay and
# retires legacy user-wide Codex registrations when no Codex thread is active.
PACKAGE_NAME=$(node -e "console.log(require('$PROJECT_ROOT/package.json').name || '')" 2>/dev/null || true)
IS_LISA_SELF=false
if [ "$PACKAGE_NAME" = "@codyswann/lisa" ]; then
  IS_LISA_SELF=true
  LISA_DIR="$PROJECT_ROOT"
else
  LISA_DIR="$PROJECT_ROOT/node_modules/@codyswann/lisa"
  if [ ! -d "$LISA_DIR" ]; then exit 0; fi
fi

cd "$PROJECT_ROOT"

if [ "$IS_LISA_SELF" = "true" ]; then
  remove_user_wide_codex_lisa_plugins
  if ! node "$LISA_DIR/dist/codex/project-overlay.js" "$PROJECT_ROOT"; then
    echo "Warning: Lisa's project-local Codex overlay reconciliation failed." >&2
  fi
fi

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
# Dedup guard: when the host's own package.json postinstall already invokes
# Lisa (wired by the ensure-lisa-postinstall migration), the package manager
# will run that root lifecycle script in this same install — running the full
# apply here too doubles the work for no benefit. The package-side apply
# exists for the bootstrap chicken-and-egg (#1017: a never-applied project
# has no postinstall to wire itself), so it still runs whenever the marker is
# absent. Detection matches LISA_MARKER in ensure-lisa-postinstall.ts.
HOST_HAS_LISA_POSTINSTALL="$(node -e "
  const scripts = require('$PROJECT_ROOT/package.json').scripts || {};
  const postinstall = scripts.postinstall || '';
  process.stdout.write(postinstall.includes('node_modules/@codyswann/lisa/dist/index.js') ? 'true' : 'false');
" 2>/dev/null || echo false)"

if [ "$IS_LISA_SELF" != "true" ] && [ -z "${CI:-}" ]; then
  if [ "$HOST_HAS_LISA_POSTINSTALL" = "true" ]; then
    echo "Lisa apply deferred to the host project's own postinstall script."
  elif ! LISA_BOOTSTRAP=1 node "$LISA_DIR/dist/index.js" --yes --skip-git-check "$PROJECT_ROOT"; then
    echo "⚠️  Warning: Lisa template application failed. Migration may be incomplete." >&2
  fi
fi

if [ "$IS_LISA_SELF" != "true" ]; then
  remove_user_wide_codex_lisa_plugins
fi

# Strip only hook entries that reference deleted .claude/hooks/*.sh scripts
# (hooks moved to plugin.json; file-path hooks would produce "No such file or directory" errors).
# Preserve inline command hooks (e.g. `command -v entire ...`, `echo ...`) and stack-template hooks
# from rails/merge/.claude/settings.json.
if [ "$IS_LISA_SELF" != "true" ] && [ -f "$SETTINGS_FILE" ] && command -v python3 >/dev/null 2>&1; then
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
if [ "$IS_LISA_SELF" != "true" ] && [ -f "$LEGACY_SAFETY_NET" ] && command -v jq >/dev/null 2>&1; then
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

# Version-gated plugin sync (perf). `claude plugin marketplace update` is a
# network git pull of the whole Lisa repo and every `claude plugin install`
# spawns the Claude CLI (seconds each); re-running all of it on every install
# made a single `bun add` cost minutes. A full sync still runs whenever the
# installed Lisa version differs from the .claude/.lisa-plugins-synced marker
# (shared with Lisa.apply's registerPlugins); between version changes only
# plugins missing for this project are installed, so the self-heal property
# (a removed plugin comes back on the next install) survives at the cost of a
# single `claude plugin list` call.
LISA_VERSION="$(node -e "console.log(require('$LISA_DIR/package.json').version || '')" 2>/dev/null || true)"

# Linked worktrees inherit the primary checkout's sync state. The marker is
# gitignored on purpose (it records THIS machine's ~/.claude plugin state, so
# it must not travel to other machines via git) — but that means every fresh
# agent worktree (.claude/worktrees/<ticket>, ~/.codex/worktrees/<ticket>)
# starts marker-less and paid the full sync: marketplace pulls plus a dozen
# Claude CLI spawns per ticket. Derive the primary checkout from
# --git-common-dir (the same defended pattern install-pkgs.sh uses to link
# node_modules, add08b409) and read its marker instead. Worktrees never WRITE
# the primary marker: a full sync run from a worktree reinstalls plugins for
# the worktree's own projectPath only, so recording it as the primary's synced
# state would let the primary skip the forced reinstall it still needs after a
# version bump.
IS_LINKED_WORKTREE=false
PRIMARY_ROOT=""
GIT_COMMON_DIR="$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -n "$GIT_COMMON_DIR" ]; then
  PRIMARY_ROOT="$(dirname "$GIT_COMMON_DIR")"
  if [ "$PRIMARY_ROOT" != "$PROJECT_ROOT" ] && [ -d "$PRIMARY_ROOT/.claude" ]; then
    IS_LINKED_WORKTREE=true
  else
    PRIMARY_ROOT=""
  fi
fi

PLUGIN_SYNC_MARKER="$PROJECT_ROOT/.claude/.lisa-plugins-synced"

marker_current() {
  [ -n "$LISA_VERSION" ] && [ -f "$1" ] \
    && [ "$(cat "$1" 2>/dev/null)" = "$LISA_VERSION" ]
}

FORCE_PLUGIN_SYNC=true
if marker_current "$PLUGIN_SYNC_MARKER"; then
  FORCE_PLUGIN_SYNC=false
elif [ "$IS_LINKED_WORKTREE" = "true" ] \
  && marker_current "$PRIMARY_ROOT/.claude/.lisa-plugins-synced"; then
  FORCE_PLUGIN_SYNC=false
fi

# In a linked worktree whose sync state is already settled (its own marker or
# the primary checkout's marker is current for this Lisa version) there is
# nothing left for this script to do: the marketplace cache is machine-global
# (already refreshed when the primary synced), the heal migrations are gated
# behind the same synced state, and per-worktree plugin registration is
# handled by the coding agent's own startup — Claude Code auto-installs the
# committed .claude/settings.json enabledPlugins for a new projectPath, and
# Codex consumes the project-local .codex-plugin pointer, not Claude
# project-scope registrations. Skipping here removes every Claude CLI spawn
# from the fresh-worktree postinstall path. The #320 defense (refresh
# marketplace whenever installs happened) is preserved: this path performs no
# installs. Self-heal for the primary checkout is untouched. The worktree's
# own marker is recorded so repeat installs (and health's root-confined
# marker probe) see the settled state without reaching outside the project.
if [ "$IS_LINKED_WORKTREE" = "true" ] && [ "$FORCE_PLUGIN_SYNC" != "true" ]; then
  mkdir -p "$PROJECT_ROOT/.claude" 2>/dev/null \
    && printf '%s' "$LISA_VERSION" > "$PLUGIN_SYNC_MARKER" 2>/dev/null \
    || true
  echo "Lisa plugins already in sync for ${LISA_VERSION} (primary checkout: ${PRIMARY_ROOT}); deferring worktree plugin registration to the coding agent's startup."
  exit 0
fi

INSTALLED_PLUGINS_FOR_PROJECT=""
if command -v jq >/dev/null 2>&1; then
  INSTALLED_PLUGINS_FOR_PROJECT="$(claude plugin list --json 2>/dev/null \
    | jq -r --arg cwd "$PROJECT_ROOT" '.[] | select(.projectPath == $cwd) | .id' 2>/dev/null || true)"
fi

install_plugin_if_missing() {
  local plugin="$1"
  if [ "$FORCE_PLUGIN_SYNC" != "true" ] && [ -n "$INSTALLED_PLUGINS_FOR_PROJECT" ] \
    && printf '%s\n' "$INSTALLED_PLUGINS_FOR_PROJECT" | grep -qxF "$plugin"; then
    return 0
  fi
  claude plugin install "$plugin" --scope project </dev/null 2>&1 || true
}

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
# Gated on version change: the stale registration can only exist in state
# written by an older Lisa, so re-probing it on every same-version install
# spends a claude CLI spawn to re-confirm a fact that cannot have changed.
if [ "$FORCE_PLUGIN_SYNC" = "true" ] && command -v jq >/dev/null 2>&1; then
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
  # Gated: the pull is a network git fetch of the whole Lisa repo; once this
  # version's plugins are synced and the project's heal-v2 marker exists, a
  # fresh pull cannot change the outcome of the schema check below.
  if [ "$FORCE_PLUGIN_SYNC" = "true" ] || [ ! -f "$PROJECT_ROOT/.claude/$HEAL_V2_MARKER_NAME" ]; then
    claude plugin marketplace update lisa </dev/null >/dev/null 2>&1 || true
  fi

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

# Always ensure the base plugin (universal governance for all projects)
install_plugin_if_missing "lisa@lisa"

# Detect which stack plugin to install from .claude/settings.json
LISA_STACK="$(detect_lisa_stack "$SETTINGS_FILE")"

# Install typescript layer for all TS-based stacks (everything except rails)
case "$LISA_STACK" in
  rails) ;; # Rails doesn't get typescript plugin
  *)
    install_plugin_if_missing "lisa-typescript@lisa"
    ;;
esac

# Install stack-specific plugin if not plain typescript
if [ -n "$LISA_STACK" ]; then
  install_plugin_if_missing "lisa-${LISA_STACK}@lisa"
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
  "skill-creator@claude-plugins-official" \
  "atlassian@claude-plugins-official"; do
  install_plugin_if_missing "$plugin"
done

# Retire third-party plugins Lisa no longer curates. The base lisa plugin
# bundles the Sentry MCP server (plugins/src/base/.mcp.json) for every agent
# runtime, so the upstream sentry plugin registered the same server twice in
# each Claude session (issue #1955). Likewise, the Lisa-native
# parity-safety-net.sh hook screens every Bash command, so the upstream
# safety-net plugin double-screened each command; its material guards were
# absorbed into the Lisa hook (issue #1960). The merge settings templates flip
# both enabledPlugins entries to false; this removes the installs themselves.
# Version-gated like the other one-time heals so same-version runs don't spawn
# the CLI.
if [ "$FORCE_PLUGIN_SYNC" = "true" ]; then
  for retired_plugin in "sentry@claude-plugins-official" "safety-net@cc-marketplace"; do
    claude plugin uninstall "$retired_plugin" --scope project </dev/null >/dev/null 2>&1 || true
  done
fi

# Install stack-specific third-party plugins
if [ "$LISA_STACK" = "expo" ] || [ "$LISA_STACK" = "harper-fabric" ]; then
  for plugin in \
    "playwright@claude-plugins-official" \
    "posthog@claude-plugins-official"; do
    install_plugin_if_missing "$plugin"
  done
fi

# Record the fully-synced Lisa version so same-version installs skip the
# marketplace pulls and forced reinstalls above. Written last so any earlier
# failure exits (set -e) without recording a sync that did not finish.
# Always the project's OWN marker: a full sync run from a linked worktree only
# reinstalled plugins for the worktree's projectPath, so recording it against
# the primary checkout would let the primary skip the forced reinstall it
# still needs after a version bump.
if [ -n "$LISA_VERSION" ]; then
  mkdir -p "$PROJECT_ROOT/.claude" 2>/dev/null \
    && printf '%s' "$LISA_VERSION" > "$PLUGIN_SYNC_MARKER" 2>/dev/null \
    || true
fi
