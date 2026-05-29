#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
#
# PreToolUse hook (Write|Edit): block adding error-suppression directives to
# JS/TS source. Suppressing the type checker, linter, or formatter hides real
# defects instead of fixing them, so it is a documented last resort (see the
# base "ASK FIRST" governance rule). The agent should stop and get the user's
# approval rather than slip a suppression past silently.
#
# Inspects only the NEW text the tool introduces, scoped to JS/TS files, and
# matches the directive only in comment syntax (// or /*) so prose, strings,
# and identifiers that merely mention these tokens are not flagged.
# Exit code 2 blocks the tool call and surfaces stderr to Claude.
# Reference: https://docs.claude.com/en/docs/claude-code/hooks

JSON_INPUT=$(cat)

# Project rule (.claude/rules/PROJECT_RULES.md): never parse JSON in shell with
# grep/sed/cut/awk — always use jq. Fail open without jq so we never hard-block
# the agent on missing tooling.
command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')
[ -n "$FILE_PATH" ] || exit 0

# Only guard JS/TS source. Directives in other file types (docs, configs that
# document the rules, this script) are not suppressions.
case "${FILE_PATH##*.}" in
  ts | tsx | js | jsx | mjs | cjs) ;;
  *) exit 0 ;;
esac

# Resolve the new text per tool shape:
#   Write     -> tool_input.content
#   MultiEdit -> tool_input.edits[].new_string
#   Edit      -> tool_input.new_string
NEW_TEXT=$(printf '%s' "$JSON_INPUT" | jq -r '
  .tool_input as $i
  | if   ($i.content     // null) != null then $i.content
    elif ($i.edits       // null) != null then ([$i.edits[].new_string] | join("\n"))
    elif ($i.new_string  // null) != null then $i.new_string
    else "" end')

# Comment-syntax-only match: a // or /* opener, optional whitespace, then the
# suppression directive. @ts-expect-error is intentionally NOT matched — it is
# the safer alternative this hook steers toward.
DIRECTIVE_RE='(//|/\*)[[:space:]]*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)'

if printf '%s' "$NEW_TEXT" | grep -Eq "$DIRECTIVE_RE"; then
  cat >&2 <<MSG
❌ Blocked: error-suppression directive in $FILE_PATH

You are adding a @ts-ignore / @ts-nocheck / eslint-disable / biome-ignore /
prettier-ignore comment. These silence the type checker, linter, or formatter
instead of fixing the underlying problem. They are a last resort, not a default.

Fix it properly first:
  - Resolve the actual type/lint error rather than suppressing it.
  - Add the missing annotation, narrow the type, or restructure the code so the
    rule passes legitimately.
  - For a faulty dependency type, prefer a typed wrapper or module augmentation.

If — and only if — there is genuinely no other way (e.g. a known upstream bug):
  - STOP and get the user's approval before suppressing (base "ASK FIRST" rule).
  - Prefer @ts-expect-error over @ts-ignore (it fails once the error is gone).
  - Scope the disable to one line and one rule, never a whole file.
  - Include a "-- <reason>" description (eslint-comments/require-description).
MSG
  exit 2
fi

exit 0
