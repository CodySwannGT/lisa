#!/usr/bin/env bash
# Lisa-managed Codex hook script (PreToolUse Edit|Write|apply_patch).
# Blocks adding error-suppression directives (@ts-ignore, @ts-nocheck,
# eslint-disable, biome-ignore, prettier-ignore) to JS/TS source. Suppressing
# the type checker, linter, or formatter hides real defects — fix the
# underlying error. Suppression is a last resort: when genuinely unavoidable
# the agent should stop and get the user's approval rather than slip it past.
#
# Codex blocks the tool call when the script exits 2 with a deny message on
# stderr. apply_patch carries the whole diff as a STRING under
# tool_input.command (verified against codex-cli 0.125.0), so we walk the patch
# and inspect added (`+`) lines under JS/TS file headers. Edit/Write inspect the
# new text directly. Only comment-syntax matches count, so prose/strings that
# merely mention these tokens are not flagged.
#
# WHAT A REFUSAL HOOK OWES THAT AN ON-EDIT HOOK DOES NOT. The PostToolUse
# scripts on this surface may bail out when they cannot run: the write has
# already happened and a skipped lint is a missed report. This one decides
# whether the write happens at all, so a bail-out is a PERMIT. Every exit below
# is out of scope, judged by the declared task, or judged by the built-in.
# "Could not judge" refuses.
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule: never parse JSON with grep/sed/cut/awk — use jq.
#
# FAIL CLOSED, reversed from the `exit 0` this shipped with. Without jq neither
# the tool name, the path, nor the added lines can be read, so the hook cannot
# tell a suppression from any other write and must not permit one it did not
# inspect. Unscoped for the same reason: with no parse there is no file type to
# scope the refusal to.
if ! command -v jq >/dev/null 2>&1; then
  cat >&2 <<'MSG'
⚠ block-suppress-directives: refusing this write — it cannot be inspected.

`jq` is not installed, so the tool payload cannot be parsed and this hook cannot
tell whether the write adds an error-suppression directive. It refuses rather
than permitting an edit it was unable to check.

Install jq (`brew install jq`, `apt-get install jq`), or declare the
`suppression-residue` gate at `pre-tool` in .lisa.config.json to have your own
check decide instead.
MSG
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_extract-edit-paths.sh"

# Comment-syntax-only match: // or /* opener, optional whitespace, directive.
# @ts-expect-error is intentionally NOT matched — it is the safer alternative.
DIRECTIVE_RE='(//|/\*)[[:space:]]*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)'

# True only for JS/TS file extensions.
is_js_ts() {
  case "${1##*.}" in
    ts | tsx | js | jsx | mjs | cjs) return 0 ;;
    *) return 1 ;;
  esac
}

deny() {
  cat >&2 <<MSG
⚠ block-suppress-directives: refusing to add an error-suppression directive to ${1}.

@ts-ignore / @ts-nocheck / eslint-disable / biome-ignore / prettier-ignore
silence the type checker, linter, or formatter instead of fixing the problem.
Fix the underlying type/lint error instead — add the missing annotation, narrow
the type, or restructure the code so the rule passes.

Suppression is a last resort. If there is genuinely no other way, STOP and get
the user's approval first, prefer @ts-expect-error over @ts-ignore, scope the
disable to one line and one rule, and add a "-- <reason>" description.
MSG
  exit 2
}

# ---------------------------------------------------------------------------
# Gate façade. The project's declaration decides BEFORE the built-in judges
# anything. Full contract, and why an undeclared project sees no change at all,
# in lisa-edit-gate.sh beside this file.
#
# This surface differs from the Claude one in shape only: one invocation can
# carry several edited paths, so the declared task runs once per JS/TS path with
# LISA_EDITED_FILE set, and a failure on any path refuses the write. Codex hooks
# run with the project as the working directory, so there is no `cd` here — the
# Claude copy needs one because a PreToolUse hook there establishes none.
#
# ONE PROPERTY, so there is no all-or-nothing question here: this hook proves
# `suppression-residue` and nothing else.
# ---------------------------------------------------------------------------
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/lisa-edit-gate.sh"
if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks pre-tool suppression-residue)"; then
  # FAIL CLOSED on a missing extractor. Without it the path list is EMPTY, the
  # loop below runs zero times, and the script exits 0 having run the declared
  # task against nothing — a permit wearing the declaration's authority. The
  # built-in never reaches this helper, so the guard belongs here and not at
  # the top, where it would change what an undeclared project does.
  if ! declare -F lisa_extract_edit_paths >/dev/null 2>&1; then
    echo "⚠ block-suppress-directives: refusing this write — the declared" >&2
    echo "  suppression-residue task cannot be scoped because" >&2
    echo "  _extract-edit-paths.sh is missing beside this hook. Re-run \`lisa apply\`." >&2
    exit 2
  fi
  LISA_GATE_STATUS=0
  while IFS= read -r LISA_GATE_FILE; do
    [ -n "${LISA_GATE_FILE}" ] || continue
    is_js_ts "${LISA_GATE_FILE}" || continue
    lisa_edit_gate_run "${LISA_GATE_FILE}" "$LISA_GATE_COMMANDS" ||
      LISA_GATE_STATUS=2
  done <<LISA_GATE_PATHS
$(lisa_extract_edit_paths "$JSON_INPUT")
LISA_GATE_PATHS
  exit "$LISA_GATE_STATUS"
fi

TOOL_NAME="$(printf '%s' "$JSON_INPUT" | jq -r '.tool_name // .tool // empty')"

if [ "$TOOL_NAME" = "apply_patch" ]; then
  PATCH_TEXT="$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.command // empty')"
  [ -n "$PATCH_TEXT" ] || exit 0
  current_file=""
  while IFS= read -r line; do
    case "$line" in
      "*** Add File: "* | "*** Update File: "*)
        current_file="${line#*File: }"
        ;;
      "*** Delete File: "* | "*** Begin Patch"* | "*** End Patch"*)
        current_file=""
        ;;
      "+"*)
        [ -n "$current_file" ] || continue
        is_js_ts "$current_file" || continue
        # Strip the single leading '+' that marks an added line.
        added="${line#+}"
        if printf '%s' "$added" | grep -Eq "$DIRECTIVE_RE"; then
          deny "$current_file"
        fi
        ;;
    esac
  done <<EOF
$PATCH_TEXT
EOF
  exit 0
fi

# Edit / Write
FILE_PATH="$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"
[ -n "$FILE_PATH" ] || exit 0
is_js_ts "$FILE_PATH" || exit 0

NEW_TEXT="$(printf '%s' "$JSON_INPUT" | jq -r '
  .tool_input as $i
  | if   ($i.content    // null) != null then $i.content
    elif ($i.edits      // null) != null then ([$i.edits[].new_string] | join("\n"))
    elif ($i.new_string // null) != null then $i.new_string
    else "" end')"

if printf '%s' "$NEW_TEXT" | grep -Eq "$DIRECTIVE_RE"; then
  deny "$FILE_PATH"
fi

exit 0
