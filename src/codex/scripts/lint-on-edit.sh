#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs oxlint on every just-edited JS/TS file. Full ESLint remains enforced at
# the commit/CI chokepoint via the project lint scripts.
# Resolves target file(s) via the shared extractor (Edit/Write + apply_patch).
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq.
command -v jq >/dev/null 2>&1 || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

if [ -x "./node_modules/.bin/oxlint" ]; then
  OXLINT="./node_modules/.bin/oxlint"
elif command -v oxlint >/dev/null 2>&1; then
  OXLINT="oxlint"
else
  exit 0
fi

STATUS=0
while IFS= read -r FILE_PATH; do
  [ -n "${FILE_PATH}" ] || continue
  [ -f "${FILE_PATH}" ] || continue
  case "${FILE_PATH##*.}" in
    ts | tsx | js | jsx | mjs | cjs) ;;
    *) continue ;;
  esac
  "$OXLINT" --quiet "${FILE_PATH}" || STATUS=1
done <<EOF
$(lisa_extract_edit_paths "$JSON_INPUT")
EOF

exit "$STATUS"
