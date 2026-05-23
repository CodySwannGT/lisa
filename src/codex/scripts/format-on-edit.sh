#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs Prettier on every just-edited file. Resolves the target file(s) from the
# tool envelope via the shared extractor, which handles both single-file
# Edit/Write (tool_input.file_path) and multi-file apply_patch (tool_input.command).
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq so we don't
# block the agent on missing tooling.
command -v jq >/dev/null 2>&1 || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

# Resolve the formatter once, up front.
if [ -x "./node_modules/.bin/prettier" ]; then
  PRETTIER="./node_modules/.bin/prettier"
elif command -v prettier >/dev/null 2>&1; then
  PRETTIER="prettier"
else
  exit 0
fi

while IFS= read -r FILE_PATH; do
  [ -n "${FILE_PATH}" ] || continue
  [ -f "${FILE_PATH}" ] || continue
  case "${FILE_PATH##*.}" in
    ts | tsx | js | jsx | mjs | cjs | json | md | yaml | yml | css | scss | html) ;;
    *) continue ;;
  esac
  "$PRETTIER" --write "${FILE_PATH}" >/dev/null 2>&1 || true
done <<EOF
$(lisa_extract_edit_paths "$JSON_INPUT")
EOF

exit 0
