#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs RuboCop -a (safe autocorrect) on the just-edited Ruby file, then
# checks for remaining unfixable errors. Blocking — non-zero exit forces
# the agent to fix.
set -euo pipefail

JSON_INPUT="$(cat)"

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq.
command -v jq >/dev/null 2>&1 || exit 0
FILE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"

[ -n "${FILE_PATH}" ] || exit 0
[ -f "${FILE_PATH}" ] || exit 0

case "${FILE_PATH##*.}" in
  rb|rake) ;;
  *) exit 0 ;;
esac

if command -v bundle >/dev/null 2>&1 && [ -f "./Gemfile" ]; then
  RUBOCOP=(bundle exec rubocop)
elif command -v rubocop >/dev/null 2>&1; then
  RUBOCOP=(rubocop)
else
  exit 0
fi

"${RUBOCOP[@]}" -a "${FILE_PATH}" >/dev/null 2>&1 || true
"${RUBOCOP[@]}" "${FILE_PATH}"
