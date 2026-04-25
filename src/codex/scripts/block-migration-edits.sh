#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Edit|Write|apply_patch).
# Blocks edits to TypeORM migration files. Use `bun run migration:generate`
# to regenerate from entity diffs instead — hand-written migrations drift
# from entity metadata and break the schema/migration contract.
#
# Codex blocks the tool call when stdout has hookSpecificOutput.permissionDecision
# set to "deny", or when the script exits non-zero with a deny message.
#
# Tool envelope shapes (Codex CLI 0.125.0):
#   Edit / Write     → tool_input.file_path        (single string)
#   apply_patch      → tool_input.command          (["apply_patch", "<patch>"])
#
# The patch text encodes target file paths via "*** Update File: <path>" /
# "*** Add File: <path>" / "*** Delete File: <path>" directives. We must
# extract every such path so apply_patch can't sneak past this guard.
set -euo pipefail

JSON_INPUT="$(cat)"

if ! command -v jq >/dev/null 2>&1; then
  # Without jq we can't reliably parse — fail open (allow the edit). This
  # matches the project rule against grep/sed/cut/awk-based JSON parsing.
  exit 0
fi

# Determine which tool fired. Codex puts the tool name at .tool_name on
# every PreToolUse envelope; falling back to .tool just in case.
TOOL_NAME="$(echo "$JSON_INPUT" | jq -r '.tool_name // .tool // empty')"

# Collect every candidate path the tool intends to write. Newline-separated.
CANDIDATE_PATHS=""
case "$TOOL_NAME" in
  apply_patch)
    # Pull the full patch string out of tool_input.command[1], then extract
    # every "*** {Update,Add,Delete} File: <path>" header line. jq handles
    # the JSON; we use bash-native string splitting (NOT grep/cut on JSON)
    # to walk the patch text line-by-line.
    PATCH_TEXT="$(echo "$JSON_INPUT" | jq -r '.tool_input.command[1] // empty')"
    if [ -n "${PATCH_TEXT}" ]; then
      while IFS= read -r line; do
        case "$line" in
          "*** Update File: "*|"*** Add File: "*|"*** Delete File: "*)
            CANDIDATE_PATHS+="${line#*: }"$'\n'
            ;;
        esac
      done <<<"${PATCH_TEXT}"
    fi
    ;;
  *)
    # Edit / Write / anything else: single file under tool_input.file_path
    SINGLE_PATH="$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"
    [ -n "${SINGLE_PATH}" ] && CANDIDATE_PATHS="${SINGLE_PATH}"
    ;;
esac

[ -n "${CANDIDATE_PATHS}" ] || exit 0

# Walk every candidate; deny on the first migration match.
while IFS= read -r FILE_PATH; do
  [ -n "${FILE_PATH}" ] || continue
  case "${FILE_PATH}" in
    */migrations/*[0-9]*-*.ts)
      cat <<EOF >&2
⚠ block-migration-edits: refusing to modify ${FILE_PATH}.

TypeORM migrations must be regenerated from entity diffs:
  bun run migration:generate -- src/database/migrations/<descriptive-name>

Hand-written migrations drift from entity metadata and break the schema
contract. Modify the entity, run the generator, then commit the result.
EOF
      exit 2
      ;;
  esac
done <<<"${CANDIDATE_PATHS}"

exit 0
