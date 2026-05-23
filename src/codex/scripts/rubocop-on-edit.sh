#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs RuboCop -a (safe autocorrect) on every just-edited Ruby file, then checks
# for remaining unfixable errors. Blocking — a non-zero exit on any file forces
# the agent to fix. Resolves target file(s) via the shared extractor
# (Edit/Write + apply_patch).
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq.
command -v jq >/dev/null 2>&1 || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

if command -v bundle >/dev/null 2>&1 && [ -f "./Gemfile" ]; then
  RUBOCOP=(bundle exec rubocop)
elif command -v rubocop >/dev/null 2>&1; then
  RUBOCOP=(rubocop)
else
  exit 0
fi

STATUS=0
while IFS= read -r FILE_PATH; do
  [ -n "${FILE_PATH}" ] || continue
  [ -f "${FILE_PATH}" ] || continue
  case "${FILE_PATH##*.}" in
    rb | rake) ;;
    *) continue ;;
  esac
  "${RUBOCOP[@]}" -a "${FILE_PATH}" >/dev/null 2>&1 || true
  "${RUBOCOP[@]}" "${FILE_PATH}" || STATUS=1
done <<EOF
$(lisa_extract_edit_paths "$JSON_INPUT")
EOF

exit "$STATUS"
