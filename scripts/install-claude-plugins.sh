#!/usr/bin/env bash
# Registers the Lisa marketplace and installs required Claude Code plugins.
# Runs as Lisa's postinstall lifecycle script.
set -euo pipefail

if ! command -v claude &>/dev/null; then exit 0; fi

PROJECT_ROOT="${npm_config_local_prefix:-${INIT_CWD:-}}"
if [ -z "$PROJECT_ROOT" ]; then exit 0; fi

LISA_DIR="$PROJECT_ROOT/node_modules/@codyswann/lisa"
if [ ! -d "$LISA_DIR" ]; then exit 0; fi

cd "$PROJECT_ROOT"

# Apply Lisa templates non-interactively
node "$LISA_DIR/dist/index.js" --yes "$PROJECT_ROOT" || true

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

# Register the Lisa marketplace pointing to this npm package
claude marketplace add "$LISA_DIR" </dev/null 2>&1 || true

# Detect which stack plugin to install from .claude/settings.json
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
LISA_PLUGIN=""
if [ -f "$SETTINGS_FILE" ]; then
  for stack in typescript expo nestjs cdk rails; do
    if grep -q "\"${stack}@lisa\"" "$SETTINGS_FILE" 2>/dev/null; then
      LISA_PLUGIN="${stack}@lisa"
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
  "playwright@claude-plugins-official" \
  "coderabbit@claude-plugins-official" \
  "sentry@claude-plugins-official" \
  "safety-net@cc-marketplace"; do
  claude plugin install "$plugin" --scope project </dev/null 2>&1 || true
done
