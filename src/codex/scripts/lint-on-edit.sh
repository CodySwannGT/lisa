#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs ESLint --fix on the just-edited file. If unfixable errors remain,
# exits non-zero so Codex sees the failure and the agent self-corrects.
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
  ts|tsx|js|jsx|mjs|cjs) ;;
  *) exit 0 ;;
esac

if [ -x "./node_modules/.bin/eslint" ]; then
  ESLINT="./node_modules/.bin/eslint"
elif command -v eslint >/dev/null 2>&1; then
  ESLINT="eslint"
else
  exit 0
fi

# Auto-fix what we can; surface anything left so the agent fixes it itself
"$ESLINT" --fix "${FILE_PATH}" >/dev/null 2>&1 || true
"$ESLINT" --quiet "${FILE_PATH}"
