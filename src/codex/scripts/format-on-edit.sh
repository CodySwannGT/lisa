#!/usr/bin/env bash
# Lisa-managed Codex hook script (PostToolUse Edit|Write|apply_patch).
# Runs Prettier on every just-edited file. Resolves the target file(s) from the
# tool envelope via the shared extractor, which handles both single-file
# Edit/Write (tool_input.file_path) and multi-file apply_patch (tool_input.command).
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule (host rules, .agents/rules/): never parse JSON in shell
# with grep/sed/cut/awk — always use jq. Fail open without jq so we don't
# block the agent on missing tooling.
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
if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks post-tool format-conformance)"; then
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
