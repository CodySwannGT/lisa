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
#
# WHAT A REFUSAL HOOK OWES THAT AN ON-EDIT HOOK DOES NOT. The five PostToolUse
# scripts may bail out when they cannot run: the write has already happened and
# a skipped lint is a missed report. This one decides whether the write happens
# at all, so a bail-out is a PERMIT — it lets through exactly the text it exists
# to stop, while reporting success. Every exit below is therefore one of three
# things and never a fourth: out of scope (nothing to judge), judged by the
# project's declared task, or judged by the built-in. "Could not judge" refuses.

JSON_INPUT=$(cat)

# Project rule (host rules, .agents/rules/): never parse JSON in shell with
# grep/sed/cut/awk — always use jq.
#
# FAIL CLOSED, reversed from the `exit 0` this shipped with. Without jq the
# payload cannot be read at all: not the path, not the file type, not the new
# text. Permitting there is the one branch that let a suppression through while
# the hook reported success, and it could not even say which write it had waved
# past. The refusal is deliberately unscoped for the same reason — with no
# parse there is no file type to scope it to. This is the same shape the
# sibling on-edit hook already ships for a missing `oxlint`: fail loudly rather
# than silently skip.
if ! command -v jq >/dev/null 2>&1; then
  cat >&2 <<'MSG'
❌ Blocked: block-suppress-directives cannot inspect this write.

`jq` is not installed, so the tool payload cannot be parsed — this hook cannot
tell whether the write adds an error-suppression directive. It refuses rather
than permitting an edit it was unable to check.

Install jq (`brew install jq`, `apt-get install jq`), or declare the
`suppression-residue` gate at `pre-tool` in .lisa.config.json to have your own
check decide instead.
MSG
  exit 2
fi

FILE_PATH=$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')
[ -n "$FILE_PATH" ] || exit 0

# Only guard JS/TS source. Directives in other file types (docs, configs that
# document the rules, this script) are not suppressions.
case "${FILE_PATH##*.}" in
  ts | tsx | js | jsx | mjs | cjs) ;;
  *) exit 0 ;;
esac

# Where this script lives, resolved BEFORE any `cd`. `$0` is the path the
# harness invoked, and the façade helper ships beside it.
LISA_HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

# ---------------------------------------------------------------------------
# Gate façade. The project's declaration decides BEFORE the built-in judges
# anything. Full contract, and why an undeclared project sees no change at all,
# in lisa-edit-gate.sh beside this file.
#
# THE WORKING DIRECTORY IS PART OF THE WIRING HERE, which is why this hook was
# left out of the change that wired the five on-edit ones. Those hooks already
# `cd "$CLAUDE_PROJECT_DIR"` to run a tool against the tree; this one acts on
# the payload and never establishes a directory at all. The helper resolves
# .lisa.config.json and the gate registry RELATIVE to the current directory, so
# without the `cd` it would read whatever directory the harness happened to
# launch in and report "nothing declared" for a project that had declared.
#
# The `cd` is safe for the built-in below because the built-in reads only the
# payload and the absolute path inside it — nothing it does depends on the
# working directory. That is what keeps an undeclared project on exactly the
# command, and exactly the exit status, it had before.
#
# ONE PROPERTY, so there is no all-or-nothing question here: this hook proves
# `suppression-residue` and nothing else.
# ---------------------------------------------------------------------------
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] &&
  [ -f "$LISA_HOOK_DIR/lisa-edit-gate.sh" ] &&
  cd "$CLAUDE_PROJECT_DIR" 2>/dev/null; then
  # shellcheck source=/dev/null
  . "$LISA_HOOK_DIR/lisa-edit-gate.sh"
  if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks pre-tool suppression-residue)"; then
    # The declared task's own exit status decides the write: non-zero refuses,
    # exactly as the built-in's match does. `lisa_edit_gate_run` exits 2 on the
    # first failure, which is this surface's refusal status.
    lisa_edit_gate_run "$FILE_PATH" "$LISA_GATE_COMMANDS"
    exit $?
  fi
fi

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
