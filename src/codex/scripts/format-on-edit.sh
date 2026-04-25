#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs Prettier on the just-edited file. Adapted from the Claude Code
# version; reads tool_input.file_path from stdin JSON.
#
# Codex hook stdin includes a JSON envelope; we extract `file_path` from
# `tool_input` regardless of which write-style tool fired.
set -euo pipefail

JSON_INPUT="$(cat)"

# Extract file_path from tool_input via jq if available, fall back to grep
if command -v jq >/dev/null 2>&1; then
  FILE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"
else
  FILE_PATH="$(echo "$JSON_INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)"
fi

[ -n "${FILE_PATH}" ] || exit 0
[ -f "${FILE_PATH}" ] || exit 0

case "${FILE_PATH##*.}" in
  ts|tsx|js|jsx|mjs|cjs|json|md|yaml|yml|css|scss|html) ;;
  *) exit 0 ;;
esac

# Prefer the project-local prettier; fall back to a globally installed one
if [ -x "./node_modules/.bin/prettier" ]; then
  ./node_modules/.bin/prettier --write "${FILE_PATH}" >/dev/null 2>&1 || true
elif command -v prettier >/dev/null 2>&1; then
  prettier --write "${FILE_PATH}" >/dev/null 2>&1 || true
fi
