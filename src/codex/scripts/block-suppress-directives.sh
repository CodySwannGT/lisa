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
# and inspect added (`+`) lines under JS/TS file headers. Edit/Write/MultiEdit
# refuse only directive GROWTH: the directives before the write (the file on
# disk, or each edit's old_string) are compared with those after it, so keeping
# an existing directive is allowed and adding, copying, or widening one is not.
# Only comment-syntax matches count, so prose/strings that merely mention these
# tokens are not flagged.
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

# ---------------------------------------------------------------------------
# Edit / Write / MultiEdit: refuse directive GROWTH, never mere presence
# (CodySwannGT/lisa#4492). Same semantics as the Claude TypeScript-stack hook:
#   Write     -> before = the file on disk (nothing when it does not exist),
#                after  = tool_input.content
#   Edit      -> before = tool_input.old_string, after = tool_input.new_string
#   MultiEdit -> each edits[] pair judged the same way, on its own
# Each directive is taken from its comment opener to the end of its line, so a
# directive that is added, copied again, or reworded (a `-next-line` disable
# turned file-wide, a longer rule list) is new text, and is growth.
# ---------------------------------------------------------------------------
FILE_PATH="$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')"
[ -n "$FILE_PATH" ] || exit 0
is_js_ts "$FILE_PATH" || exit 0

# The directives in $1, one per line and sorted, so the lists are multisets
# `comm` can subtract. Trailing whitespace (and a CR) is not part of one.
directives_in() {
  printf '%s\n' "$1" | grep -Eo "${DIRECTIVE_RE}.*" |
    sed 's/[[:space:]]*$//' | LC_ALL=C sort
}

# True when $2 (after) carries a directive $1 (before) does not. `comm -13`
# pairs repeated lines one-for-one, so a further copy of an existing directive
# is left over, and counts.
grows() {
  [ -n "$(LC_ALL=C comm -13 <(directives_in "$1") <(directives_in "$2"))" ]
}

# The file a Write replaces, on stdout. Codex runs hooks in the project, so a
# relative path resolves against CLAUDE_PROJECT_DIR when set, else the cwd.
# Nothing there is a new file (empty before). Something there that is not a
# readable regular file cannot be judged, so this fails and the caller refuses.
read_before() {
  local target="$FILE_PATH"
  case "$target" in
    /*) ;;
    *) target="${CLAUDE_PROJECT_DIR:-.}/$target" ;;
  esac
  [ -e "$target" ] || [ -L "$target" ] || return 0
  [ -f "$target" ] && [ -r "$target" ] || return 1
  cat -- "$target"
}

# The edit object $1: tool_input itself for Edit, edits[$1] for MultiEdit.
EDIT_AT='.tool_input | (if (.edits // null) != null then .edits[$i] else . end)'

# One string field ($2) of edit $1, empty when absent.
edit_field() {
  printf '%s' "$JSON_INPUT" |
    jq -r --argjson i "$1" --arg f "$2" "$EDIT_AT | .[\$f] // empty"
}

# True when edit $1 grows the directives. One that brings a directive with no
# old_string to compare against cannot be judged, and counts as growth.
edit_grows() {
  local new
  new="$(edit_field "$1" new_string)"
  [ -n "$(directives_in "$new")" ] || return 1
  printf '%s' "$JSON_INPUT" |
    jq -e --argjson i "$1" "$EDIT_AT | (.old_string | type) == \"string\"" \
      >/dev/null || return 0
  grows "$(edit_field "$1" old_string)" "$new"
}

# True when any edit grows. An edit count that is not a number is unjudgeable.
any_edit_grows() {
  local count i=0
  count="$(printf '%s' "$JSON_INPUT" |
    jq '.tool_input | if (.edits // null) != null then (.edits | length) else 1 end')"
  case "$count" in '' | *[!0-9]*) return 0 ;; esac
  while [ "$i" -lt "$count" ]; do
    edit_grows "$i" && return 0
    i=$((i + 1))
  done
  return 1
}

# True when the write grows the directives; Write when content is present.
write_grows() {
  local before after
  if printf '%s' "$JSON_INPUT" |
    jq -e '(.tool_input.content // null) != null' >/dev/null; then
    after="$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.content')"
    # Nothing in the new text means nothing can have grown; no read needed.
    [ -n "$(directives_in "$after")" ] || return 1
    before="$(read_before)" || return 0
    grows "$before" "$after"
    return
  fi
  any_edit_grows
}

if write_grows; then
  deny "$FILE_PATH"
fi

exit 0
