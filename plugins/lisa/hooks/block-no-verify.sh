#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks any command containing --no-verify.
# --no-verify on git commit/push (and equivalents) bypasses pre-commit/pre-push
# hooks that exist for a reason. The fix is to address the underlying issue,
# not silence the check. See feedback_never_no_verify in user memory.
#
# Word-boundary match avoids false positives on flags like --no-verify-ssl,
# --no-verify-host, etc.
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

# Match --no-verify bounded by non-token characters (not alphanumeric, _, or -).
# This catches all syntactic positions including subshells (e.g. `(git commit --no-verify)`)
# while excluding longer flags like --no-verify-ssl, --no-verify-host, etc.
if printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])--no-verify($|[^[:alnum:]_-])'; then
  cat >&2 <<'EOF'
Blocked: --no-verify bypasses pre-commit/pre-push hooks. Fix the underlying
issue (lint error, failing test, formatting) or ask the user before bypassing.

If the user has explicitly authorized the bypass for this specific command,
re-run after they confirm.
EOF
  exit 2
fi

exit 0
