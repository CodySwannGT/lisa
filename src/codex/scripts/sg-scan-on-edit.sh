#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs ast-grep scan against the project, reporting only errors involving
# the just-edited file. Blocking — non-zero exit forces the agent to fix.
set -euo pipefail

JSON_INPUT="$(cat)"

if command -v jq >/dev/null 2>&1; then
  FILE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"
else
  FILE_PATH="$(echo "$JSON_INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)"
fi

[ -n "${FILE_PATH}" ] || exit 0
[ -f "${FILE_PATH}" ] || exit 0

case "${FILE_PATH##*.}" in
  ts|tsx|js|jsx|mjs|cjs|rb) ;;
  *) exit 0 ;;
esac

if [ -x "./node_modules/.bin/ast-grep" ]; then
  AST_GREP="./node_modules/.bin/ast-grep"
elif command -v ast-grep >/dev/null 2>&1; then
  AST_GREP="ast-grep"
elif command -v sg >/dev/null 2>&1; then
  AST_GREP="sg"
else
  exit 0
fi

[ -f "./sgconfig.yml" ] || exit 0

"$AST_GREP" scan "${FILE_PATH}" 2>&1
