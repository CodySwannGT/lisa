#!/usr/bin/env bash
# Reads all .md files from the plugin's rules/ directory and injects them
# into Claude context at session/subagent start.
set -euo pipefail

ROOT="${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
RULES_DIR="$ROOT/rules"

[ -d "$RULES_DIR" ] || exit 0

for rule in "$RULES_DIR"/*.md; do
  [ -f "$rule" ] || continue
  printf '\n<lisa-phaser-rule path="%s">\n' "$rule"
  cat "$rule"
  printf '\n</lisa-phaser-rule>\n'
done
