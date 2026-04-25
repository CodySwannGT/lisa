#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs Prettier on the just-edited file. Reads tool_input.file_path from
# stdin JSON.
#
# Note on apply_patch: Codex's apply_patch tool envelope exposes the patch
# under tool_input.command (an array), not tool_input.file_path. This script
# only formats single-file Edit/Write tool calls. apply_patch fires get
# silently skipped (FILE_PATH empty) — that's acceptable here because the
# next save/edit will still run the formatter, and the user can always run
# `prettier --write` against modified files manually.
set -euo pipefail

JSON_INPUT="$(cat)"

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq so we don't
# block the agent on missing tooling.
command -v jq >/dev/null 2>&1 || exit 0
FILE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"

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
