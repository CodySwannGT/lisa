#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs ast-grep scan on every just-edited source file (TypeScript/JS or Ruby),
# reporting only errors involving those files. Blocking — a non-zero exit on any
# file forces the agent to fix. Resolves target file(s) via the shared extractor
# (Edit/Write + apply_patch).
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule (host rules, .agents/rules/): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq.
command -v jq >/dev/null 2>&1 || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

# ---------------------------------------------------------------------------
# Gate façade. The project's declaration decides BEFORE any tool is resolved.
# Full contract, and why an undeclared project sees no change at all, in
# lisa-edit-gate.sh beside this file.
#
# This surface differs from the Claude one in shape only: one invocation can
# carry several edited paths, so the declared task runs once per path with
# LISA_EDITED_FILE set, and a failure on any path is the script's status.
#
# All-or-nothing across the properties this script proves: a single invocation
# that proves more than one stands down only when EVERY one is declared, or it
# would silently stop proving the others.
# ---------------------------------------------------------------------------
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/lisa-edit-gate.sh"
if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks post-tool structural-rules)"; then
  LISA_GATE_STATUS=0
  while IFS= read -r LISA_GATE_FILE; do
    [ -n "${LISA_GATE_FILE}" ] || continue
    lisa_edit_gate_run "${LISA_GATE_FILE}" "$LISA_GATE_COMMANDS" ||
      LISA_GATE_STATUS=1
  done <<LISA_GATE_PATHS
$(lisa_extract_edit_paths "$JSON_INPUT")
LISA_GATE_PATHS
  exit "$LISA_GATE_STATUS"
fi


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

STATUS=0
while IFS= read -r FILE_PATH; do
  [ -n "${FILE_PATH}" ] || continue
  [ -f "${FILE_PATH}" ] || continue
  case "${FILE_PATH##*.}" in
    ts | tsx | js | jsx | mjs | cjs | rb | rake) ;;
    *) continue ;;
  esac
  "$AST_GREP" scan "${FILE_PATH}" 2>&1 || STATUS=1
done <<EOF
$(lisa_extract_edit_paths "$JSON_INPUT")
EOF

exit "$STATUS"
