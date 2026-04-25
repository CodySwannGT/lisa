#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs ESLint --fix on the just-edited file. If unfixable errors remain,
# exits non-zero so Codex sees the failure and the agent self-corrects.
set -euo pipefail

JSON_INPUT="$(cat)"

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq.
command -v jq >/dev/null 2>&1 || exit 0
FILE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"

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
