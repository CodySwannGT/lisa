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
set -uo pipefail

JSON_INPUT="$(cat)"

# Project rule: never parse JSON with grep/sed/cut/awk — use jq. Fail open.
command -v jq >/dev/null 2>&1 || exit 0

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
