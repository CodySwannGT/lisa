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
# Refuses only directive GROWTH, never mere presence: it compares the
# directives before the write (the file on disk for Write, old_string for each
# Edit/MultiEdit pair) with those after it, and refuses when the after text
# carries one the before text does not — a new directive, another copy of one,
# or a reworded (widened) one. Keeping or removing directives is allowed.
# Scoped to JS/TS files, and matches the directive only in comment syntax
# (// or /*) so prose, strings, and identifiers that merely mention these
# tokens are not flagged.
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

# ---------------------------------------------------------------------------
# Built-in: refuse directive GROWTH, never mere presence (CodySwannGT/lisa#4492).
#
# Rewriting a file that already carried an approved, scoped disable used to be
# refused as if the agent had added it, which taught agents to dodge the hook
# rather than heed it. The judgement is BEFORE versus AFTER:
#   Write     -> before = the file on disk (nothing when it does not exist),
#                after  = tool_input.content
#   Edit      -> before = tool_input.old_string, after = tool_input.new_string
#   MultiEdit -> each edits[] pair judged the same way, on its own
# Each directive is taken from its comment opener to the end of its line, so a
# directive that is added, copied again, or reworded (a `-next-line` disable
# turned file-wide, a longer rule list) is new text, and is growth.
# ---------------------------------------------------------------------------

# Comment-syntax-only match: a // or /* opener, optional whitespace, then the
# suppression directive. @ts-expect-error is intentionally NOT matched — it is
# the safer alternative this hook steers toward.
DIRECTIVE_RE='(//|/\*)[[:space:]]*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)'

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

# The file a Write replaces, on stdout. A relative path is the project's, so it
# resolves against CLAUDE_PROJECT_DIR whichever directory this runs in. Nothing
# there is a new file (empty before). Something there that is not a readable
# regular file — a directory, a dangling link, no read permission — cannot be
# judged, so this fails and the caller refuses.
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
