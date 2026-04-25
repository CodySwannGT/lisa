#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs ast-grep scan against the project, reporting only errors involving
# the just-edited file. Blocking — non-zero exit forces the agent to fix.
set -euo pipefail

JSON_INPUT="$(cat)"

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq.
command -v jq >/dev/null 2>&1 || exit 0
FILE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"

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
