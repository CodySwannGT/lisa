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

# Apply Lisa templates non-interactively.
# --skip-git-check bypasses the dirty working directory check since
# package.json and the lockfile are always uncommitted during postinstall.
if ! node "$LISA_DIR/dist/index.js" --yes --skip-git-check "$PROJECT_ROOT"; then
  echo "⚠️  Warning: Lisa template application failed. Migration may be incomplete." >&2
fi

# Strip the hooks key from .claude/settings.json if .claude/hooks/ is now empty/absent
# (hooks moved to plugin.json; all .claude/hooks/*.sh scripts are deleted by lisa update)
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
HOOKS_DIR="$PROJECT_ROOT/.claude/hooks"
if [ -f "$SETTINGS_FILE" ] && command -v python3 >/dev/null 2>&1; then
  if [ ! -d "$HOOKS_DIR" ] || [ -z "$(ls -A "$HOOKS_DIR" 2>/dev/null)" ]; then
    python3 - "$SETTINGS_FILE" <<'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    d = json.load(f)
if "hooks" in d:
    del d["hooks"]
    with open(path, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
PYEOF
  fi
fi

# Install plugins only when claude CLI is available
if ! command -v claude &>/dev/null; then exit 0; fi

# The Lisa marketplace is registered via extraKnownMarketplaces in .claude/settings.json
# pointing to the GitHub repo (CodySwannGT/lisa). Built plugins are committed to the repo
# so relative paths in marketplace.json resolve correctly.

# Detect which stack plugin to install from .claude/settings.json
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
LISA_PLUGIN=""
if [ -f "$SETTINGS_FILE" ]; then
  for stack in typescript expo nestjs cdk rails; do
    # Check new format (lisa-*@lisa) first, fall back to legacy format (*@lisa)
    if grep -q "\"lisa-${stack}@lisa\"" "$SETTINGS_FILE" 2>/dev/null; then
      LISA_PLUGIN="lisa-${stack}@lisa"
      break
    elif grep -q "\"${stack}@lisa\"" "$SETTINGS_FILE" 2>/dev/null; then
      LISA_PLUGIN="lisa-${stack}@lisa"
      break
    fi
  done
fi

if [ -n "$LISA_PLUGIN" ]; then
  claude plugin install "$LISA_PLUGIN" --scope project </dev/null 2>&1 || true
fi

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
if [ "$LISA_PLUGIN" = "lisa-expo@lisa" ]; then
  for plugin in \
    "playwright@claude-plugins-official" \
    "posthog@claude-plugins-official"; do
    claude plugin install "$plugin" --scope project </dev/null 2>&1 || true
  done
fi
