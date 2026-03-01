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
