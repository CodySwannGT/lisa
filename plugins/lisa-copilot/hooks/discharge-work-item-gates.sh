#!/usr/bin/env bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# Discharge Deferred Work-Item Gates Hook (PostToolUse - Bash)
# =============================================================================
# Two of the five Work-Item Traceability gates live OUTSIDE the commits: gate 4
# is the `Work-Item:` line in the pull-request BODY, and gate 5 is the managed
# `[lisa-pr-link]` backlink on the item. A push cannot check either one —
# both are properties of a pull request, and the push is what makes the pull
# request possible — so until this hook existed the next thing that looked was
# CI, one cycle later (CodySwannGT/lisa#3791).
#
# This fires the moment a pull request is created or its body edited, which is
# the FIRST moment both gates are checkable. It evaluates them, and posts the
# backlink that gate 5 needs, so neither waits for a red CI run to be revealed.
#
# Exit 2 blocks and hands the output back to the agent, which is the point: a
# non-blocking notice here would be the same defect the discharge exists to
# fix — a finding delivered somewhere nobody has to act on it.
# =============================================================================
set -uo pipefail

JSON_INPUT="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0
command -v node >/dev/null 2>&1 || exit 0

COMMAND="$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$COMMAND" ] || exit 0

# `gh pr create` opens one; `gh pr edit` is the other way a body comes to carry
# — or lose — its declaration. Both change the answer to gate 4.
case "$COMMAND" in
  *"gh pr create"* | *"gh pr edit"*) ;;
  *) exit 0 ;;
esac

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$repo_root/scripts/lisa-work-item.mjs" ] || exit 0

output="$(cd "$repo_root" && node scripts/lisa-work-item.mjs discharge-pr-gates 2>&1)"
status=$?

# 0 is a clean discharge. 3 is the validator's own answer for "no pull request
# to check yet", which PostToolUse reaches on every `gh pr create` that FAILED
# — the tool call still ran, so the hook still fires. Collapsing 3 into the
# blocking arm would report a work-item violation on somebody's typo.
case "$status" in
  0 | 3) exit 0 ;;
esac

printf '%s\n' "$output" >&2
exit 2
