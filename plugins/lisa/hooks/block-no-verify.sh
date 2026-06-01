#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks commands that bypass git's verification hooks.
# Bypassing pre-commit/pre-push hooks (which exist for a reason) is blocked in
# all of its forms; the fix is to address the underlying issue, not silence the
# check. See feedback_never_no_verify in user memory.
#
# Blocked bypass vectors:
#   1. the --no-verify long flag (any subcommand, any position, incl. subshells);
#   2. HUSKY=0 / HUSKY_SKIP_HOOKS=... — disables husky-managed git hooks;
#   3. core.hooksPath pointed at /dev/null or set empty — disables ALL git hooks.
#
# Word-boundary matching avoids false positives on longer flags (--no-verify-ssl,
# --no-verify-host) and on a legit custom hooks path (core.hooksPath=.husky).
#
# The short `-n` form is intentionally NOT matched (see block-no-verify.agy.sh):
# grep cannot distinguish a real -n option from -n in commit-message prose or an
# unrelated piped command, and -n is far more common than --no-verify.
set -euo pipefail

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
if [ -z "$command_str" ]; then
  exit 0
fi

# Each pattern is bounded by non-token characters so longer flags
# (--no-verify-ssl) and legit values (core.hooksPath=.husky, HUSKY=1) don't match,
# while every syntactic position is caught (incl. subshells, e.g. `(git commit --no-verify)`).
if printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])--no-verify($|[^[:alnum:]_-])' \
  || printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])HUSKY=0($|[^[:alnum:]])' \
  || printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])HUSKY_SKIP_HOOKS=' \
  || printf '%s' "$command_str" | grep -Eq 'core\.hooksPath([[:space:]]*=)?[[:space:]]*/dev/null' \
  || printf '%s' "$command_str" | grep -Eq 'core\.hooksPath[[:space:]]*=[[:space:]]*($|[[:space:];&|"'\''])'; then
  cat >&2 <<'EOF'
Blocked: this command bypasses pre-commit/pre-push hooks (--no-verify, HUSKY=0,
or core.hooksPath disabling). Fix the underlying issue (lint error, failing
test, formatting) or ask the user before bypassing.

If the user has explicitly authorized the bypass for this specific command,
re-run after they confirm.
EOF
  exit 2
fi

exit 0
